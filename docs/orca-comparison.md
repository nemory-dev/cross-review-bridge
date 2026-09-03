# Orca vs. Cross Review Bridge: 코드·프로세스 비교와 고도화 제안

이 문서는 Stably AI의 [Orca](https://github.com/stablyai/orca)와 Cross Review Bridge를 실제 코드의 상태 모델, 리뷰 전달 과정, 장애 복구 방식으로 비교한다.

## 0. 조사 범위와 근거 수준

- 조사일: **2026-09-02 (KST)**
- Orca 기준: `stablyai/orca` commit [`058e618`](https://github.com/stablyai/orca/tree/058e618bb4b29f2d3b8284a8a402b2d7dcfac063)
- Cross Review Bridge 기준: 현재 작업 트리(기준 commit `4b0932a`, 미커밋 변경 포함)
- Orca 공식 저장소를 shallow clone하여 소스와 테스트를 직접 검색했다.

근거 표시는 다음과 같다.

- **[코드 확인]**: 구현 또는 테스트에서 직접 확인했다.
- **[공식 문서]**: 공식 README/문서에서 확인했다.
- **[분석]**: 확인된 코드를 바탕으로 한 해석이다.
- **[제안]**: Cross Review Bridge에 적용할 아이디어다.

> Orca는 빠르게 변경되는 프로젝트다. 아래 내용은 위 commit의 스냅샷이다.

---

## 1. 결론 먼저

두 프로젝트는 직접적인 대체재보다 **서로 다른 계층**에 있다.

- **Orca**는 agent 프로세스, terminal, worktree, task DAG, 메시지, 장애 복구와 GUI까지 소유하는 **Agent Development Environment(ADE) 겸 orchestration runtime**이다.
- **Cross Review Bridge(CRB)**는 이미 실행 중인 서로 다른 AI host가 리뷰 요청과 결과를 교환하도록 돕는 **headless review protocol/queue**다.

| 목적 | 더 적합한 쪽 | 이유 |
| --- | --- | --- |
| Codex·Claude를 직접 실행하고 병렬 작업을 관리 | Orca | agent 실행, terminal readiness, worktree, dispatch lifecycle을 소유한다. |
| 여러 AI 앱 사이에서 리뷰 요청을 느슨하게 교환 | CRB | 특정 IDE가 아니라 CLI/MCP와 review record를 경계로 삼는다. |
| 동시성·재시작·중복 완료가 중요한 자동화 | 현재는 Orca | SQLite transaction, dispatch identity, duplicate/stale report 방어가 있다. |
| 리뷰 목적·질문·가이드·결론 형식을 보존 | CRB | `reviewType`, `reviewGoal`, `reviewGuide`, `reviewQuestions`가 domain에 포함된다. |
| 사람이 diff line에 note를 남기고 agent에게 수정 요청 | Orca | line-scoped note와 agent terminal 전달 UX가 구현돼 있다. |
| 기존 Codex/Claude 사용 방식을 유지하며 작은 도구로 시작 | CRB | 모델 프로세스와 GUI를 소유하지 않는다. |

CRB는 Orca 전체를 복제하면 안 된다. "작고 독립적인 리뷰 프로토콜"은 유지하면서 다음 원리를 벤치마크하는 것이 좋다.

1. JSON read-modify-write를 transaction 가능한 저장소로 교체한다.
2. review와 review attempt/lease를 분리한다.
3. `review_id + attempt_id`로 늦게 도착한 결과를 차단한다.
4. 제출 당시 Git revision과 diff를 불변 artifact로 고정한다.
5. polling 외에 durable event와 bounded wait를 제공한다.
6. 자유 텍스트와 함께 구조화된 finding/verdict도 저장한다.

---

## 2. 먼저 바로잡아야 할 오해: Orca의 "리뷰"는 두 종류다

### 2.1 Agent-to-agent 검토: 범용 orchestration을 리뷰 용도로 사용

Orca orchestration은 리뷰 전용 `Review` entity를 만들지 않는다. coordinator가 범용 `Run -> Task -> Dispatch -> Worker`를 만들고 task spec에 "이 변경을 검토하라"고 적어 Claude/Codex worker를 실행한다. **[코드 확인]**

```text
Coordinator agent
  |
  | run-create / task-create("이 코드를 검토하라")
  v
Orca orchestration DB
  |
  | worker-start --agent claude|codex
  v
Agent terminal + optional Git worktree
  |
  | injected preamble + task spec
  | heartbeat / ask / escalation
  v
worker_done(outcome, summary, files, reportPath)
  |
  v
Coordinator가 결과를 종합하거나 다음 작업을 dispatch
```

`worker-start`는 coordinator/Run/Task 소유권 검증, worktree 생성·재사용, agent terminal 생성, `tui-idle` 대기, task/dispatch ID가 든 preamble 전달, 시작 단계와 side effect 기록을 수행한다. **[코드 확인]**

근거: [`orchestration-workers.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/rpc/methods/orchestration-workers.ts), [`preamble.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/preamble.ts)

Orca 문서의 `review-only worker`는 범용 worker에게 부여한 **역할/소유권 규칙**이다. 별도의 review request schema나 verdict state machine을 뜻하지 않는다. `worker_done`은 finding을 보고할 뿐 coordinator의 파일 수정 권한까지 의미하지 않는다고 skill guide가 규정한다. **[코드·공식 문서 확인]**

### 2.2 Annotate AI Diff: 사람이 남긴 line note를 agent에게 전달

이 기능은 CRB와 다른 흐름이다.

```text
Human reviewer
  |
  | modified line에 note 작성
  v
DiffComment(filePath, lineNumber, body, diffIdentity)
  |
  | worktree metadata에 저장
  v
"Send notes to" existing/new agent
  |
  | terminal readiness 확인 + guarded prompt send
  v
Agent가 코드를 수정
```

`DiffComment`에는 파일, line range, review scope, diff identity, 전송 시각이 포함된다. note는 deterministic prompt로 변환되어 기존 또는 새 agent에 전달된다. 전달 중 note가 수정됐다면 예전 snapshot을 보냈다는 이유로 새 note를 삭제하지 않는다. **[코드 확인]**

근거:

- [`diff-comment-types.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/shared/diff-comment-types.ts)
- [`diff-comments-format.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/shared/diff-comments-format.ts)
- [`ReviewNotesSendMenuContent.tsx`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/renderer/src/components/editor/ReviewNotesSendMenuContent.tsx)
- [`active-agent-note-send.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/renderer/src/lib/active-agent-note-send.ts)
- [`diffComments.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/renderer/src/store/slices/diffComments.ts)

즉, 이것은 **AI A의 답변을 AI B가 평가해 verdict를 반환하는 기능**이 아니라 **사람의 code review note를 agent에게 수정 지시로 전달하는 기능**이다.

---

## 3. Cross Review Bridge의 실제 과정

CRB는 agent를 직접 실행하지 않는다. source host와 reviewer host가 같은 local store를 공유한다. **[코드 확인]**

```text
Codex(source)
  |
  | submit_review: subject + goal + guide + questions + bounded context
  v
reviews.json: pending
  |
  | claim_review --format prompt
  v
Claude가 자기 session에서 실제 검토
  |
  | complete_review(result)
  v
reviews.json: completed
  |
  | get_review
  v
Codex가 결과 확인
```

구현상 특징은 다음과 같다.

- `PLAN_AND_PROPOSAL`, `CODE_DIFF`, `GENERAL` type을 구분한다.
- goal, guide, 질문 목록을 review record에 저장한다.
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/*`를 bounded하게 자동 수집한다.
- 추가 plan/context 문서는 project root와 symlink escape를 검사한 뒤 읽는다.
- prompt가 severity, 수정 이유, `accept|revise|reject` 결론을 요구한다.
- 기본 구현은 모델 API나 agent process를 직접 호출하지 않는다.

근거: [`store.js`](../src/store.js), [`context.js`](../src/context.js), [`prompt.js`](../src/prompt.js), [`mcp-server.js`](../src/mcp-server.js), [`cli.js`](../src/cli.js)

### 기존 문서에서 과장됐던 부분

- **"MCP 표준 준수"**: 공식 SDK가 아니라 `initialize`, `tools/list`, `tools/call` 중심의 최소 stdio JSON-RPC surface를 직접 구현한다. 전체 spec compliance가 검증됐다고 표현할 수 없다.
- **"ADR 자동 수집"**: ADR은 자동 탐색하지 않고 `--context-docs`로 명시했을 때만 읽는다.
- **"Zero-overhead"**: GUI/runtime이 없다는 의미에서는 가볍지만 저장, polling, prompt token 비용은 존재한다.
- **"토큰 절약"**: 직접 API fan-out을 하지 않지만 reviewer host의 구독/사용량은 소비된다. 측정 전에는 설계 가설이다.
- **"검토 품질이 뛰어남"**: prompt 구조와 실제 defect detection 품질은 다르다. benchmark 전에는 우위를 주장할 수 없다.

---

## 4. 코드 수준 직접 비교

| 항목 | Orca | Cross Review Bridge | 해석 |
| --- | --- | --- | --- |
| 핵심 entity | Run, Task, Dispatch, Worker, Message, Question, Gate | Review와 단일 Result | Orca는 실행 lifecycle, CRB는 review semantics 중심이다. |
| agent 실행 | terminal/agent를 생성·재사용 | 실행하지 않음 | Orca는 end-to-end, CRB는 host adapter가 필요하다. |
| 작업 격리 | current/new child/new top-level worktree | 전달된 text와 원 project context | 코드 변경 병렬 작업은 Orca가 안전하다. |
| 입력 | 자유 형식 Task spec | type/goal/guide/questions/subject/context | CRB가 review 의도를 더 명시적으로 보존한다. |
| 결과 | outcome + 요약 + optional artifact path | 자유 텍스트; prompt만 verdict 요구 | CRB store는 verdict를 검증하지 않는다. |
| multi-turn | durable message, thread, blocking ask/reply | submit 한 번, complete 한 번 | clarification loop는 Orca가 강하다. |
| 상태 | task와 dispatch를 분리 | review 하나의 상태 | CRB는 claim attempt와 review lifecycle이 섞여 있다. |
| identity | task + dispatch + capability/terminal identity | review ID + reviewer 문자열 | CRB는 stale reviewer 결과를 막기 어렵다. |
| 저장 | SQLite WAL, transaction, index | JSON 전체 read-modify-write + temp rename | rename은 파일 무결성에는 도움되나 lost update를 막지 못한다. |
| 중복 처리 | duplicate `worker_done` idempotency | 재-complete 시 기존 결과 덮어쓰기 가능 | 자동화 전에 보강해야 한다. |
| stale result | 이전 dispatch가 retry를 완료하지 못하게 검증 | attempt/retry identity 없음 | 장시간 review와 재시도에 취약하다. |
| dependency | Task 완료 시 dependent Task를 `ready`로 승격 | 없음 | review → fix → re-review를 직접 조합해야 한다. |
| liveness | heartbeat, wait, escalation, worker state | pending list polling | reviewer crash와 지연을 구분하기 어렵다. |
| 사람 승인 | decision gate와 question/reply | 결과 확인 후 수동 결정 | 최소 verdict 상태가 필요하다. |
| context | 실제 worktree/repo + Task spec | bounded instruction/context를 prompt에 내장 | Orca는 최신 repo, CRB는 명시적 제한이 장점이다. |
| diff note | file/line/diff identity entity | `CODE_DIFF`도 subject text | line finding 구조화가 벤치마크 포인트다. |
| 원격 | SSH/federated dispatch | local JSON 경로 전제 | CRB는 현재 single-machine 도구다. |
| 관측 | desktop/mobile, terminal, diff, task 상태 | CLI/MCP JSON | Orca가 강하지만 구현 비용도 크다. |

### 4.1 저장과 동시성

Orca는 SQLite에 `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`을 설정한다. worker report는 `BEGIN IMMEDIATE` transaction에서 task/dispatch 관계, active 상태, duplicate, stale dispatch를 검증한 뒤 task와 worker를 함께 갱신한다. **[코드 확인]**

근거: [`orchestration-db.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/db/orchestration-db.ts), [`worker-report-settlement.ts`](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts)

CRB는 전체 `reviews.json`을 읽고 수정한 뒤 임시 파일을 rename한다. 한 writer에서는 partial file 위험을 줄이지만, 두 process가 같은 이전 snapshot을 읽으면 마지막 rename이 앞선 변경을 덮어쓸 수 있다. `claimReview()`의 pending 조회와 claimed 저장도 cross-process atomic operation이 아니어서 두 reviewer가 같은 review를 claim할 수 있다. **[코드 확인·분석]**

Android로 비유하면 `SharedPreferences`를 여러 process가 각자 읽고 전체를 다시 쓰는 문제와 비슷하다. temp rename은 안전한 파일 교체이지 database의 compare-and-set이 아니다.

### 4.2 상태와 소유권

Orca는 Task와 Dispatch를 분리한다. 같은 Task가 retry되면 새 dispatch ID가 생기고, 늦게 끝난 이전 worker가 현재 Task를 완료하지 못한다. **[코드 확인]**

CRB에서는 현재 다음 전이가 가능하다. **[코드 확인]**

- claim하지 않은 `pending` review를 바로 complete
- claimedBy와 다른 reviewer 문자열로 complete
- completed review를 다시 complete하여 결과 덮어쓰기
- completed review를 cancel
- claim lease, timeout, retry attempt 없음

수동 MVP에서는 단순함이 장점이지만 auto-claim worker를 추가하는 순간 정합성 문제가 된다.

### 4.3 Prompt와 context trust boundary

CRB의 project root 제한과 context 크기 제한은 좋은 출발점이다. 반면 instruction, context, subject를 하나의 Markdown prompt에 넣으므로 다음 위험이 남는다. **[분석]**

- subject/context의 명령을 reviewer가 상위 instruction처럼 따르는 prompt injection
- subject의 triple backtick이 outer code fence를 깨는 delimiter confusion
- 문자 수 기반 앞부분 절단으로 중요한 diff 후반부 누락
- Git commit/diff hash가 없어 어떤 version을 검토했는지 증명하기 어려움

Orca는 특정 worktree에서 실제 repo를 읽게 해 artifact freshness가 좋다. 다만 같은 worktree를 쓰면 review-only가 prompt 규칙일 뿐 read-only filesystem 격리는 아니므로 reviewer가 수정할 가능성은 남는다. **[코드 확인·분석]**

---

## 5. 각각의 장단점

### Orca의 장점

1. reviewer 실행까지 소유해 자동 전달할 수 있다.
2. task와 attempt 성격의 dispatch를 분리하고 duplicate/stale completion을 막는다.
3. heartbeat, escalation, outcome unknown, stopped/abandoned로 장애를 상태화한다.
4. durable ask/reply로 multi-turn coordination이 가능하다.
5. worktree로 병렬 agent의 파일 충돌을 줄인다.
6. dependency와 decision gate로 review → fix → re-review를 구성할 수 있다.
7. diff line note, source control, terminal 상태가 한 UX에 있다.

### Orca의 단점

1. Electron 앱, terminal runtime, worktree, SQLite, federation 등 도입 표면이 크다.
2. 리뷰는 범용 Task의 사용법이라 review type/finding/verdict가 core에서 강제되지 않는다.
3. Orca 밖의 AI 앱끼리 작은 inbox만 공유하려는 경우에는 과하다.
4. task가 commit/diff snapshot을 명시하지 않으면 재현성이 자동 보장되지는 않는다.
5. review-only는 역할 규칙이지 강제 read-only sandbox가 아니다.

### Cross Review Bridge의 장점

1. review가 1급 domain object이며 목적, 유형, 질문, context와 결과가 모인다.
2. target이 열린 문자열이고 CLI/MCP만 구현하면 새 host를 붙일 수 있다.
3. model credential이나 agent process를 소유하지 않는다.
4. Node.js runtime dependency 없이 핵심 흐름이 작고 이해하기 쉽다.
5. repo 전체가 아니라 명시적이고 bounded한 context를 전달한다.
6. GUI 없이 shell, skill, MCP에서 사용할 수 있다.

### Cross Review Bridge의 단점

1. submit 이후 reviewer host가 claim하고 모델을 실행해야 한다.
2. multi-process concurrency에 안전하지 않다.
3. claim ownership, lease, retry identity가 없다.
4. 불가능해야 할 complete/cancel 전이를 허용한다.
5. commit SHA, diff hash, immutable snapshot이 없다.
6. question/reply, heartbeat, bounded wait가 없다.
7. result는 임의 문자열이며 machine-readable finding을 검증하지 않는다.
8. queue age, 충돌, 처리 시간, 실패 원인을 집계할 event schema가 없다.
9. untrusted context 표시, secret scanning, retention, file permission 정책이 부족하다.

---

## 6. Cross Review Bridge에 반영할 요소

### P0: 자동화 전에 반드시 필요한 것

#### 6.1 Transaction store와 atomic claim

**[제안]** JSON을 SQLite로 교체한다. Orca schema 전체가 아니라 다음 최소 구조면 된다.

```text
reviews
  id, source, target, type, goal, guide, status, artifact_id

review_attempts
  id, review_id, reviewer, status, lease_expires_at
  claimed_at, completed_at, result_raw, verdict

review_events
  sequence, review_id, attempt_id, type, payload, created_at

artifacts
  id, repo_root_alias, base_sha, head_sha, diff_hash, content
```

atomic claim은 조건부 update 후 영향받은 row가 정확히 1개인 reviewer만 성공해야 한다. SQLite WAL, busy timeout, transaction, migration, DB file permission도 함께 설계한다.

#### 6.2 Review와 Attempt 분리

Android WorkManager의 `WorkSpec`과 실행 attempt처럼 "무엇을 검토할지"와 "누가 이번에 실행 중인지"를 나눈다.

```text
Review rev_1
  +-- Attempt att_1 (Claude, lease expired)
  +-- Attempt att_2 (Codex, completed)
```

complete는 `review_id + attempt_id`를 받아야 한다. 같은 완료 재전송은 idempotent success, 이전 attempt의 늦은 결과는 `stale_attempt`로 처리한다.

#### 6.3 엄격한 상태 전이

```text
pending -> claimed -> completed
   |          |
   |          +-> expired -> pending(requeue) 또는 failed
   +-> cancelled

completed/cancelled -> terminal state
```

- claim owner/attempt가 아닌 complete를 거절한다.
- completed result를 덮어쓰지 않는다. 재검토는 새 revision/attempt로 기록한다.
- mutation에 optional idempotency key를 받는다.

#### 6.4 불변 Git artifact

**[제안]** `xreview submit --type code --git-diff`와 MCP 동등 기능을 추가한다.

저장할 최소 provenance:

- base/head SHA, staged/unstaged/commit range
- diff content 또는 안전한 snapshot path와 SHA-256 hash
- dirty worktree 여부
- instruction/context hash와 truncation manifest

실행 시 repo가 바뀌면 저장 artifact를 사용하거나 `artifact_drift`를 명시해야 한다.

### P1: 실제 cross-review loop 완성

#### 6.5 Durable event와 bounded wait

`xreview watch <id> --timeout 10m`과 MCP bounded wait를 추가한다. cursor로 재연결 후 이어받을 수 있어야 한다.

event 예: `review_submitted`, `attempt_claimed`, `lease_renewed`, `review_questioned`, `review_replied`, `attempt_completed`, `attempt_expired`, `review_cancelled`.

#### 6.6 질문·답변 thread

범용 orchestration 전체 대신 review 범위의 clarification만 구현한다.

```text
Reviewer -> question(review_id, attempt_id, body)
Source/User -> reply(question_id, body)
Reviewer -> resume and complete
```

attempt 종료 시 질문도 close하고 timeout 후 같은 question ID로 resume할 수 있어야 한다.

#### 6.7 구조화된 finding

raw Markdown은 보존하면서 다음 구조를 선택적으로 저장한다.

```json
{
  "verdict": "revise",
  "findings": [
    {
      "severity": "P1",
      "title": "Concurrent claim can duplicate work",
      "file": "src/store.js",
      "line": 140,
      "body": "...",
      "suggestion": "..."
    }
  ]
}
```

parser 실패 시 raw result를 버리지 말고 `structured_parse_failed` event를 남긴다.

#### 6.8 Review → Fix → Re-review

full DAG engine보다 작은 revision loop를 먼저 만든다.

```text
review revision 1 -> findings -> source fixes
  -> revision 2(resolved finding IDs) -> reviewer verifies
```

finding에 `open|accepted|dismissed|resolved|reopened` 상태를 두면 review 중심 차별성이 생긴다.

### P2: 사용성 검증 후 선택 적용

- **Optional agent adapter**: `manual`, 기존 `terminal`, 허용된 `subprocess`, `external` adapter를 core 밖에 둔다.
- **Optional worktree/read-only mode**: code review에만 `--workspace snapshot|worktree|current`를 제공하고 예상 밖 수정은 policy violation으로 기록한다.
- **Multi-reviewer/synthesis**: 같은 immutable artifact를 독립 검토하고 minority P0/P1을 다수결로 버리지 않는다. model/harness provenance는 확인 못 했으면 `unverified`로 표시한다.
- **TUI/dashboard**: query와 event model이 안정된 뒤 만든다.

### 그대로 복제하지 않을 Orca 요소

1. Electron GUI 전체
2. 범용 Task DAG 전체
3. SSH federation 전체
4. agent account/credential 관리
5. 모든 리뷰에서 worktree 강제

배울 것은 코드 양이 아니라 identity, attempt 분리, transaction, stale result 방어, liveness 관측이다.

---

## 7. 구현 전후 benchmark

### 정확성·복구

| 시나리오 | 성공 기준 |
| --- | --- |
| 50개 process가 한 review를 동시 claim | 성공 attempt 정확히 1개 |
| claim 직후 reviewer 종료 | lease 만료 후 안전하게 requeue |
| 같은 complete 10회 재전송 | 결과 1개, 나머지는 idempotent duplicate |
| att_1 timeout 후 att_2 시작, att_1 결과 도착 | `stale_attempt` 거절, att_2 불변 |
| DB write 중 process 종료 | 마지막 committed event까지 일관성 유지 |
| wait client 재접속 | cursor 이후 event만 중복 없이 수신 |
| submit 후 working tree 변경 | 저장 artifact 검토 또는 명시적 drift 오류 |

### 리뷰 품질

알려진 correctness/security/concurrency/test defect가 든 golden plan/diff를 준비해 같은 모델 조건에서 기본 prompt와 structured prompt를 비교한다. defect recall, false positive, severity accuracy, actionable suggestion 비율, minority critical finding 보존율을 측정한다. 모델은 비결정적이므로 여러 회 실행해 평균과 분산을 기록한다.

### 성능·운영

- submit/claim/complete p50·p95·p99 latency
- queue 1천/1만/10만 건에서 list/claim latency
- prompt/context byte와 truncation rate
- completion latency, lease expiry, storage busy/error/retry count

---

## 8. 운영 로그·메트릭

각 mutation 로그에는 다음을 넣되 review 본문은 기본적으로 넣지 않는다.

```text
event, review_id, attempt_id, source, target,
previous_status, next_status, duration_ms,
artifact_hash, idempotency_key, error_code
```

권장 메트릭:

- `reviews_pending_total{target}`
- `review_oldest_pending_seconds{target}`
- `review_claim_conflicts_total`
- `review_attempt_lease_expired_total{target}`
- `review_completion_seconds{type,target}`
- `review_stale_completion_total`
- `review_context_truncated_total{kind}`
- `review_artifact_drift_total`
- `review_storage_errors_total{operation}`
- `review_findings_total{severity,verdict}`

```text
Queue health dashboard
  |- pending 수 / 가장 오래된 요청
  |- claimed 수 / lease 만료 예정
  |- source -> target별 처리 시간
  |- stale·duplicate·storage error
  `- unresolved P0/P1 findings
```

Android의 ANR dashboard처럼 전체 성공률만 보면 안 된다. queue depth가 낮아도 가장 오래된 review가 영구 claimed라면 사용자 경험은 실패한 것이다.

---

## 9. 권장 구현 순서

```text
Phase 1: Trustworthy Queue
  SQLite + migration + transaction
  Review/Attempt/Event + lease + idempotency
        |
Phase 2: Reproducible Review
  immutable Git artifact + structured finding
  prompt trust boundary 보강
        |
Phase 3: Review Round Trip
  bounded wait + question/reply
  finding resolution + re-review revision
        |
Phase 4: Optional Automation
  agent adapter + optional worktree
  multi-reviewer + TUI/dashboard
```

첫 목표는 "Orca처럼 많은 기능"이 아니라 다음 문장으로 잡는 것을 권장한다.

> 여러 AI host가 같은 code/plan artifact를 중복이나 유실 없이 검토하고, 어떤 reviewer attempt가 어떤 finding을 냈는지 재현할 수 있는 로컬 review protocol.

---

## 10. 주요 근거

### Orca 공식 소스·문서

- [README](https://github.com/stablyai/orca/tree/058e618bb4b29f2d3b8284a8a402b2d7dcfac063#readme)
- [package.json — Electron 확인](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/package.json)
- [Orchestration state model](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/types.ts)
- [SQLite initialization](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/db/orchestration-db.ts)
- [Worker start](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/rpc/methods/orchestration-workers.ts)
- [Dispatch preamble](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/preamble.ts)
- [Worker report transaction](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts)
- [Decision gate](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/main/runtime/orchestration/db/decision-gates/decision-gate-store.ts)
- [Diff review note](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/shared/diff-comment-types.ts)
- [Review note delivery](https://github.com/stablyai/orca/blob/058e618bb4b29f2d3b8284a8a402b2d7dcfac063/src/renderer/src/components/editor/ReviewNotesSendMenuContent.tsx)
- [Worktrees 공식 문서](https://www.onorca.dev/docs/model/worktrees)
- [Orchestration 공식 문서](https://www.onorca.dev/docs/cli/orchestration)

### Cross Review Bridge 소스

- [Review store](../src/store.js)
- [Context collector](../src/context.js)
- [Prompt renderer](../src/prompt.js)
- [MCP server](../src/mcp-server.js)
- [CLI](../src/cli.js)
- [Architecture](architecture.md)

---

## 오늘 기억해야 하는 핵심

- Orca의 agent review는 전용 review engine이 아니라 범용 orchestration의 사용 사례다.
- Annotate AI Diff는 human-to-agent 수정 요청이며 CRB의 agent-to-agent 검토와 다르다.
- CRB의 차별점은 review semantics와 느슨한 host 결합이지만 현재 JSON queue는 동시성·attempt·recovery 보장이 부족하다.
- 먼저 벤치마크할 것은 GUI가 아니라 transaction, attempt identity, stale result 방어, durable event다.

## 다음에 공부하면 좋은 주제

- SQLite WAL과 `BEGIN IMMEDIATE`
- lease/visibility timeout 기반 work queue
- idempotency와 effectively-once 처리
- event cursor 기반 long polling
- immutable Git artifact와 content-addressed storage
- LLM prompt injection과 untrusted context boundary

## 실무에서 직접 확인해볼 것

- `reviews.json` 동시 claim에서 실제 성공 수
- reviewer 종료 후 claimed review의 고립 여부
- 동일 complete 재전송 시 결과 덮어쓰기
- submit 후 diff 변경 시 reviewer가 보는 version
- context truncation을 source/reviewer가 모두 인지하는지
