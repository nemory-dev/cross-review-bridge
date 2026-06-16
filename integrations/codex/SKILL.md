---
name: cross-review
description: Use when the user wants to send the current or previous assistant answer, plan, proposal, or review request to another AI tool such as Claude, Codex, Antigravity, or Gemini for feedback through Cross Review Bridge.
---

# Cross Review

Use the local `xreview` CLI or Cross Review Bridge MCP tools to submit and retrieve review requests.

## Submit A Review

When the user says things like:

- "방금 답변 Claude에게 리뷰 보내줘"
- "이 계획을 Codex 관점에서 다시 봐줘"
- "Send this answer to Antigravity for feedback"

Submit the answer/proposal being discussed with:

```bash
xreview review --source codex "<answer or selected text>"
```

By default, Codex submissions target Claude. Override with `--target <target>` only when the user asks for a different reviewer.

If the text is long, write it to a temporary file and use:

```bash
xreview review --source codex --subject-file /tmp/xreview-subject.md
```

## Retrieve Feedback

Use:

```bash
xreview pending
xreview show <review-id>
```

When feedback is available, summarize:

- Must apply
- Worth considering
- Can ignore
- Open questions

Do not blindly apply reviewer feedback. Explain tradeoffs.
