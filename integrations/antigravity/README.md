# Antigravity (AGY) Integration Guide

This guide explains how to register and use `cross-review-bridge` with Google Antigravity (AGY / Antigravity IDE).

---

## 1. Registering MCP Server in Antigravity

Antigravity supports Model Context Protocol (MCP) servers via `.agents/mcp_config.json` (workspace scope) or `~/.gemini/config/mcp_config.json` (global user scope).

Add `cross-review-bridge` to your MCP configuration file:

```json
{
  "mcpServers": {
    "cross-review-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/cross-review-bridge/src/mcp-server.js"
      ]
    }
  }
}
```

Replace `/absolute/path/to/cross-review-bridge` with the actual path on your filesystem (e.g., `C:/Users/username/Documents/cross-review-bridge/src/mcp-server.js`).

---

## 2. Standard MCP Tools Provided

Once registered, Antigravity agents can invoke the following standard MCP tools:

- `submit_review`: Submit an assistant answer, plan, or code diff for cross-review by another host (Claude, Codex, Antigravity, etc.).
  - Parameters:
    - `target`: `'claude'` | `'codex'` | `'antigravity'`
    - `subject`: Summary or main text of the answer/proposal.
    - `reviewType`: `'PLAN_AND_PROPOSAL'` | `'CODE_DIFF'` | `'GENERAL'`
    - `proposedPlanFile`: Path to proposed plan file (e.g. `.ctx-local/MASTER_PLAN.md`).
    - `contextDocuments`: Array of context file paths (e.g. `[".ctx-local/decisions.md"]`).
    - `reviewQuestions`: Array of specific review questions for the reviewer agent.
- `list_reviews`: List review requests in queue by status or target.
- `claim_review`: Claim pending review for a host.
- `get_review`: Fetch details for a claimed/pending review.
- `render_review_prompt`: Generate a reviewer-ready markdown prompt.
- `complete_review`: Attach completed review feedback.

---

## 3. Workflow Example: Antigravity & Claude/Codex Collaboration

```text
[Antigravity Agent]
  │  1. Generates architecture proposal / plan
  │  2. Calls `submit_review` with reviewType: "PLAN_AND_PROPOSAL"
  ▼
[cross-review-bridge Queue]
  │  3. Captures document contents & stores payload locally
  ▼
[Claude Code / Codex Agent]
  │  4. Claims review & renders prompt via `render_review_prompt`
  │  5. Critically reviews proposal (Red Teaming / Plan Critic)
  │  6. Submits feedback via `complete_review`
  ▼
[Antigravity Agent]
  │  7. Reads feedback via `get_review` & refines implementation plan
```
