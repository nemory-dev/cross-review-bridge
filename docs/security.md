# Security

Cross Review Bridge is local-first and model-free by default, but it can still store sensitive data because users may submit assistant answers that contain secrets or proprietary context.

## Guarantees

- The bridge does not call OpenAI, Anthropic, Google, or other model APIs by default.
- The bridge does not read hidden app login tokens.
- The bridge does not automate browsers.
- Review data is stored locally unless the user copies or syncs it elsewhere.

## Sensitive Data Risks

Review requests may contain:

- API keys or tokens pasted into an answer.
- Internal architecture details.
- Customer data.
- Project instruction files.
- Git status information.

Do not commit or share the review store:

```text
~/.cross-review-bridge/reviews.db
```

## Project Context Bounds

The context collector captures only known instruction files and git summary metadata. It does not recursively read source code.

Captured instruction files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.cursor/rules/*.md`

## Public Project Guidance

If you publish this project or share examples:

- Use synthetic review text.
- Do not include real review stores.
- Do not include private project instructions.
- Keep API adapters opt-in and clearly labeled as billable.

