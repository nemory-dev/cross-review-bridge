# Claude Review Template

Use this when Claude Code or Claude App is the reviewer.

```text
Claim the next cross-review request for target `claude`.

Review it critically:
- Identify concrete issues before style suggestions.
- Check whether the answer follows captured project instructions.
- Look for over-engineering, missing edge cases, failure recovery gaps, and security/cost risks.
- Do not modify files unless explicitly asked.
- End with `accept`, `revise`, or `reject`.

After writing the review, complete the request in Cross Review Bridge.
```

