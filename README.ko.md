# Cross Review Bridge 한국어 가이드

Codex, Claude Code, Antigravity, Gemini 같은 여러 AI 도구의 답변을 서로 검토하게 만들기 위한 로컬 MCP/CLI 브릿지입니다.

예를 들어 이런 작업을 쉽게 하려는 도구입니다.

- Codex가 낸 마지막 답변을 Claude에게 검토시키기
- Claude Code가 만든 계획을 Codex 관점에서 다시 검토하기
- 나중에 Antigravity나 Gemini 기반 도구가 나오면 같은 방식으로 리뷰 요청 보내기

중요한 점: 이 도구는 기본적으로 OpenAI, Anthropic, Google API를 직접 호출하지 않습니다. 리뷰 요청을 내 컴퓨터에 저장하고, 각 AI 앱이 자기 로그인 세션/구독 사용량으로 리뷰하도록 돕는 로컬 브릿지입니다.

## 한 줄 요약

Cross Review Bridge는 여러 AI 앱이 함께 쓰는 "로컬 리뷰함"입니다.

```text
Codex가 리뷰 요청을 넣음
        ↓
Cross Review Bridge가 내 컴퓨터에 저장
        ↓
Claude Code가 리뷰 요청을 열고 피드백 작성
        ↓
Codex가 같은 리뷰함에서 피드백 확인
```

## 이 도구가 하는 일

- 리뷰 요청을 로컬 큐에 저장합니다.
- 리뷰 대상 AI가 요청을 가져갈 수 있게 합니다.
- 리뷰 결과를 다시 저장합니다.
- 원래 세션에서 리뷰 결과를 확인할 수 있게 합니다.
- 프로젝트별 지침 파일을 함께 수집해 리뷰어가 맥락을 더 잘 이해하게 합니다.

## 이 도구가 하지 않는 일

- AI 모델을 직접 호출하지 않습니다.
- OpenAI/Anthropic/Gemini API 비용을 자동으로 발생시키지 않습니다.
- Codex 앱이나 Claude 앱의 로그인 토큰을 훔쳐 쓰지 않습니다.
- 브라우저를 자동 조작하지 않습니다.
- `answer.md`, `feedback.md` 같은 파일을 자동으로 만들거나 삭제하지 않습니다.

모델 사용은 리뷰를 실제로 수행하는 앱 안에서 발생합니다. 예를 들어 Claude Code가 리뷰를 하면 Claude Code의 로그인/구독 사용량이 소모됩니다.

## 설치

내장 `node:sqlite` 모듈을 사용하므로 Node.js 24 이상이 필요합니다. 런타임 의존성은 여전히 0개입니다.

```bash
git clone <your-repo-url> cross-review-bridge
cd cross-review-bridge
npm test
npm link
```

`npm link`를 실행하면 전역에서 `xreview` 명령을 사용할 수 있습니다.

```bash
xreview --help
```

## Codex와 Claude Code에 연결하기

Codex에 MCP 서버를 등록합니다.

```bash
codex mcp add cross-review-bridge -- node /absolute/path/to/cross-review-bridge/src/mcp-server.js
```

Claude Code에 MCP 서버를 전역 등록합니다.

```bash
claude mcp add --scope user cross-review-bridge -- node /absolute/path/to/cross-review-bridge/src/mcp-server.js
```

Codex Skill과 Claude Code 명령 템플릿도 설치할 수 있습니다.

```bash
mkdir -p ~/.codex/skills/cross-review ~/.claude/commands ~/.claude/agents
cp integrations/codex/SKILL.md ~/.codex/skills/cross-review/SKILL.md
cp integrations/claude/commands/*.md ~/.claude/commands/
cp integrations/claude/agents/*.md ~/.claude/agents/
```

설정 후에는 기존에 열려 있던 Codex 또는 Claude Code 세션을 새로 열거나 재시작하는 것이 좋습니다.

## 가장 쉬운 사용법

리뷰할 내용이 짧으면 자연어 문장을 그대로 넘기면 됩니다. Codex에서 요청하면 기본으로 Claude에게 보내고, Claude에서 `--source claude`로 요청하면 기본으로 Codex에게 보냅니다.

```bash
xreview review "리뷰받고 싶은 답변이나 계획 내용"
```

Claude에서 Codex로 보내려면:

```bash
xreview review --source claude "리뷰받고 싶은 답변이나 계획 내용"
```

필요할 때만 옵션을 추가합니다.

- `--source codex`: Codex에서 만든 요청입니다. 생략하면 기본값입니다.
- `--source claude`: Claude에서 만든 요청입니다. 기본 리뷰 대상이 Codex가 됩니다.
- `--target <name>`: 기본 리뷰 대상을 덮어씁니다.
- `--goal`: 리뷰 목적을 직접 지정합니다.
- `--guide`: 리뷰할 때 특히 봐야 할 기준을 직접 지정합니다.

Claude Code 쪽에서는 다음 명령으로 리뷰 요청을 가져옵니다.

```bash
xreview claim --target claude --reviewer claude-code --format prompt
```

그러면 Claude가 검토할 수 있는 프롬프트가 출력됩니다. Claude가 리뷰를 작성한 뒤 결과를 저장합니다.

```bash
xreview complete <review-id> \
  --reviewer claude-code \
  --result "여기에 Claude의 리뷰 결과를 넣습니다."
```

원래 Codex 쪽에서는 결과를 확인합니다.

```bash
xreview show <review-id>
```

## 긴 답변은 파일로 넘기기

AI 답변이 길면 명령에 직접 넣기 어렵습니다. 이때는 답변을 파일에 저장한 뒤 `--subject-file`을 사용합니다.

예를 들어 `answer.md`라는 파일에 리뷰받을 답변을 저장했다면:

```bash
xreview submit \
  --source codex \
  --subject-file answer.md
```

리뷰 결과가 길면 `feedback.md`라는 파일에 저장한 뒤:

```bash
xreview complete <review-id> \
  --reviewer claude-code \
  --result-file feedback.md
```

## 리뷰 유형 및 고급 옵션 (계획 및 제안 리뷰)

리뷰 유형(`--type plan`, `--type code`, `--type general`), 검토 대상 계획 문서(`--plan-file`), 관련 맥락/ADR 문서(`--context-docs`), 집중 검토 질문(`--question`)을 지정하여 정교한 교차 리뷰를 수행할 수 있습니다.

```bash
# AI가 세운 기술 계획 및 아키텍처 제안 교차 리뷰 (Plan Critic & Red Teaming)
xreview submit \
  --type plan \
  --target claude \
  --subject "예산 사전예약 아키텍처 제안" \
  --plan-file docs/MASTER_PLAN.md \
  --context-docs docs/decisions.md \
  --question "기존 토큰 reservation과 충돌하는가?" \
  --question "롤백 정산 누락 케이스가 있는가?"

# 코드 변경 사항(Diff) 스펙 및 계약 검증 리뷰
xreview submit \
  --type code \
  --target codex \
  --subject-file diff.patch
```

`--plan-file` 및 `--context-docs`로 지정된 파일은 `cross-review-bridge`가 프로젝트 루트 보안 범위(Path Traversal 방지) 및 최대 글자 수 내에서 파일의 **실제 내용(content)**을 읽어와 리뷰 프롬프트의 코드 블록으로 포함시킵니다.

## answer.md와 feedback.md에 대한 중요한 설명

`answer.md`와 `feedback.md`는 예시 파일명일 뿐입니다.

- `xreview`가 `answer.md`를 자동으로 만들지 않습니다.
- `xreview`가 `feedback.md`를 자동으로 만들지 않습니다.
- `xreview`가 이 파일들을 자동으로 삭제하지 않습니다.
- `--subject-file answer.md`는 "이미 존재하는 answer.md 파일에서 리뷰 대상을 읽어라"는 뜻입니다.
- `--result-file feedback.md`는 "이미 존재하는 feedback.md 파일에서 리뷰 결과를 읽어라"는 뜻입니다.

임시 파일로만 사용했다면 리뷰 완료 후 직접 삭제하면 됩니다.

```bash
rm answer.md feedback.md
```

단, 실제 리뷰 기록은 별도 파일에 저장됩니다.

```text
~/.cross-review-bridge/reviews.db
```

이 파일은 리뷰 히스토리이므로 자동 삭제되지 않습니다.

## 리뷰 규칙

리뷰가 조용히 사라지거나 덮어써지지 않도록 큐가 다음 규칙을 강제합니다.

- 리뷰는 claim한 뒤에만 complete할 수 있습니다.
- claim한 리뷰어만 complete할 수 있습니다. `claim`과 `complete`에 같은 `--reviewer` 값을 넘기세요.
- 완료된 결과는 변경할 수 없습니다. 다시 검토받으려면 재-complete가 아니라 새 리뷰를 제출하세요.
- 완료된 리뷰는 취소할 수 없습니다.
- 리뷰 본문은 120,000자로 제한됩니다. 초과분은 잘라내지 않고 거부합니다. 중간에서 잘린 diff는 존재하지 않는 코드에 대한 리뷰를 만들기 때문입니다.

검토 대상 내용은 리뷰어 프롬프트에 코드펜스로 감싸 삽입되며 신뢰할 수 없는 자료로 표시됩니다. 리뷰어에게는 그 안의 내용을 지시가 아니라 데이터로 다루라고 안내합니다.

## 프로젝트 맥락을 어떻게 반영하나요?

특정 프로젝트 폴더에서 리뷰 요청을 만들면, Cross Review Bridge는 다음 정보를 함께 수집합니다.

- 현재 프로젝트 루트
- 현재 작업 디렉터리
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.cursor/rules/*.md`
- git branch
- git status 요약

그래서 리뷰어가 단순히 답변만 보는 것이 아니라, 프로젝트 지침과 맥락을 함께 보고 검토할 수 있습니다.

다른 프로젝트 폴더 기준으로 맥락을 수집하고 싶으면 `--cwd`를 사용합니다.

```bash
xreview submit \
  --cwd /path/to/project \
  --source codex \
  --subject-file answer.md \
  --goal "프로젝트 지침에 맞는지 검토"
```

## 저장 위치

리뷰는 SQLite 데이터베이스에 저장됩니다.

```text
~/.cross-review-bridge/reviews.db
```

여러 호스트가 이 파일을 함께 쓰기 때문입니다. Codex MCP 서버, Claude MCP 서버, CLI는 서로 다른 프로세스이며 같은 저장소에 씁니다. 모든 쓰기는 `BEGIN IMMEDIATE` 트랜잭션 안에서 이뤄지므로 두 리뷰어가 같은 리뷰를 가져가는 일이 없고, 경합하는 프로세스는 실패하는 대신 잠금을 기다립니다.

이전 버전을 쓰셨다면 첫 실행 시 같은 폴더의 `reviews.json`을 데이터베이스로 자동 이관합니다. JSON 파일은 지우지 않고 그대로 두므로 되돌릴 수 있습니다.

다른 위치를 쓰고 싶으면 환경 변수를 설정합니다.

```bash
export CROSS_REVIEW_HOME=/path/to/review-state
```

명령마다 저장 파일을 직접 지정할 수도 있습니다.

```bash
xreview pending --store /tmp/reviews.db
```

## 자주 쓰는 명령

Codex에서 Claude로 리뷰 요청 보내기:

```bash
xreview review "리뷰받고 싶은 답변이나 계획"
```

Claude에서 Codex로 리뷰 요청 보내기:

```bash
xreview review --source claude "리뷰받고 싶은 답변이나 계획"
```

대기 중인 리뷰 보기:

```bash
xreview pending
```

Claude가 처리할 대기 리뷰만 보기:

```bash
xreview pending --target claude
```

리뷰 요청 가져오기:

```bash
xreview claim --target claude --reviewer claude-code --format prompt
```

리뷰 결과 저장:

```bash
xreview complete <review-id> --reviewer claude-code --result "리뷰 결과"
```

리뷰 상세 보기:

```bash
xreview show <review-id>
```

리뷰 프롬프트 다시 출력:

```bash
xreview prompt <review-id>
```

리뷰 취소:

```bash
xreview cancel <review-id> --reason "더 이상 필요 없음"
```

## 추천 워크플로우

Codex에서 이렇게 요청합니다.

```text
방금 답변을 Claude에게 리뷰 요청해줘.
목적: 설계 타당성 검토
가이드: 실패 케이스, 보안/비용 리스크, 과한 추상화 중심으로 봐줘.
```

Claude Code에서는 이렇게 처리합니다.

```text
/xreview-poll
```

또는 직접:

```bash
xreview claim --target claude --reviewer claude-code --format prompt
```

Claude가 리뷰를 작성한 뒤 결과를 저장하고, Codex에서 다시 확인합니다.

```bash
xreview show <review-id>
```

## 비용 모델

기본 구조에서는 별도 API 비용이 발생하지 않습니다.

이유는 Cross Review Bridge가 모델 API를 직접 호출하지 않기 때문입니다. 대신 리뷰를 실제로 수행하는 앱이 자기 로그인 세션이나 구독 사용량을 사용합니다.

예:

- Claude Code가 리뷰하면 Claude Code/Claude 계정 사용량이 소모됩니다.
- Codex가 리뷰하면 Codex/ChatGPT 계정 사용량이 소모됩니다.
- 나중에 Antigravity가 리뷰하면 Antigravity 쪽 사용량이 소모됩니다.

단, 나중에 사용자가 API adapter를 직접 추가한다면 그 adapter는 별도 API 비용을 발생시킬 수 있습니다. 기본 MVP는 그런 방식이 아닙니다.

## 보안 주의사항

리뷰 요청에는 민감한 정보가 들어갈 수 있습니다.

주의해야 할 예:

- 답변 안에 들어간 API key
- 토큰, 비밀번호, 인증 정보
- 회사 내부 문서 내용
- 고객 정보
- 비공개 프로젝트 지침

`~/.cross-review-bridge/reviews.db` 파일은 리뷰 기록입니다. 민감한 내용이 들어갈 수 있으므로 공개 저장소에 올리거나 다른 사람에게 공유하지 마세요.

자세한 내용은 [docs/security.md](docs/security.md)를 참고하세요.

## 새로운 도구로 확장하기

리뷰 대상은 고정된 목록이 아니라 문자열입니다.

```text
claude
codex
antigravity
gemini
custom:<name>
```

새 도구를 추가하려면 그 도구가 다음 흐름만 수행하면 됩니다.

1. 자기 target의 리뷰 요청을 가져옵니다.
2. 리뷰 프롬프트를 읽고 검토합니다.
3. 리뷰 결과를 다시 저장합니다.

자세한 구조는 [docs/architecture.md](docs/architecture.md)를 참고하세요.

## 개발자용 명령

테스트:

```bash
npm test
```

문법 체크:

```bash
npm run check
```

이 프로젝트는 현재 런타임 의존성 없이 시작합니다. 나중에 공식 MCP SDK를 추가하더라도, 기본 원칙은 유지해야 합니다.

기본 원칙:

- 모델 API 직접 호출 없음
- 앱 로그인 토큰 접근 없음
- 로컬 저장 우선
- 프로젝트 맥락은 제한적으로만 수집
