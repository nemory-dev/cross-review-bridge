---
description: Submit text or the current answer to Cross Review Bridge.
argument-hint: "[target] [goal/guide]"
---

Use the `xreview` CLI to submit the relevant answer, plan, or proposal to Cross Review Bridge.

By default, Claude submissions target Codex. Ask for a target only if the user wants a reviewer other than Codex.

Prefer:

```bash
xreview review --source claude --subject-file /tmp/xreview-subject.md
```

Return the created review ID and tell the user which target should claim it.
