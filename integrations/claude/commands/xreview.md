---
description: Submit text or the current answer to Cross Review Bridge.
argument-hint: "[target] [goal/guide]"
---

Use the `xreview` CLI to submit the relevant answer, plan, or proposal to Cross Review Bridge.

Ask for the target if missing. Use `claude`, `codex`, `antigravity`, or another explicit target.

Prefer:

```bash
xreview submit --target "$TARGET" --source claude --subject-file /tmp/xreview-subject.md --goal "$GOAL" --guide "$GUIDE"
```

Return the created review ID and tell the user which target should claim it.

