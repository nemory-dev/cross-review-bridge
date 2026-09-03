# Architecture

Cross Review Bridge is a local queue shared by multiple AI hosts.

```text
Source host
  -> submit_review
  -> local store
  -> reviewer host claim_review/render_review_prompt
  -> reviewer host performs model work in its own session
  -> complete_review
  -> source host get_review
```

## Components

### CLI

`src/cli.js` is for humans, shell scripts, Claude Code commands, and Codex skills.

### MCP Server

`src/mcp-server.js` provides a minimal stdio JSON-RPC MCP server. It exposes queue operations as tools and does not call model APIs.

### Store

`src/store.js` manages review lifecycle state:

- `pending`
- `claimed`
- `completed`
- `cancelled`

The store is a local SQLite database (`node:sqlite`, WAL journal). Several hosts
share it as separate processes, so every mutation runs inside a `BEGIN IMMEDIATE`
transaction: a select-then-update pair cannot interleave with another writer's, and
`busy_timeout` makes a competing process wait rather than fail.

Lifecycle transitions are enforced rather than advisory. A review must be claimed
before completion, only the claiming reviewer may complete it, and completed or
cancelled reviews are terminal.

A pre-existing `reviews.json` in the same directory is imported once on first open
and then left in place.

### Context Collector

`src/context.js` discovers project roots and captures bounded instruction files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.cursor/rules/*.md`

This keeps reviewers aligned with the source project without copying the entire repository.

### Prompt Renderer

`src/prompt.js` turns a review request into a reviewer-ready Markdown prompt.

## Design Constraints

- No hidden login token access.
- No model API calls by default.
- No browser automation by default.
- Project context must be explicit and bounded.
- Targets must remain open-ended strings for future tools.

## Future Adapters

Adapters should stay thin. A host adapter only needs to:

1. Claim a target queue item.
2. Ask its native AI session to review the rendered prompt.
3. Complete the queue item with the review text.

Good future candidates:

- Claude Code hook adapter.
- Codex skill adapter.
- Antigravity/Gemini adapter.
- Optional API adapter for users who explicitly want API billing.

