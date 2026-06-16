---
description: Claim and review the next Cross Review Bridge request for Claude.
argument-hint: "[target]"
---

Run:

```bash
xreview claim --target "${1:-claude}" --reviewer claude-code --format prompt
```

Review the rendered prompt critically. Do not modify project files unless the user explicitly asks.

After writing the review, save it through:

```bash
xreview complete <review-id> --reviewer claude-code --result-file /tmp/xreview-feedback.md
```

