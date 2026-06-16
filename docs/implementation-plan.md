# Cross Review Bridge Implementation Plan

> **For agentic workers:** Build this task-by-task. Keep the bridge model-free by default: the MCP server and CLI move review requests between tools, while Codex, Claude Code, Antigravity, or future hosts perform the review using their own logged-in subscription/session.

**Goal:** Create a reusable local bridge for answer-level cross-review between AI coding/chat tools.

**Architecture:** A zero-dependency Node.js package provides a CLI, a minimal MCP stdio server, a JSON-backed local review store, project-context collection, and prompt rendering. Integrations for Codex and Claude are distributed as templates, not automatically installed.

**Tech Stack:** Node.js ESM, Node built-in test runner, JSON file storage, JSON-RPC stdio MCP protocol.

---

## File Structure

- `src/store.js`: review persistence and lifecycle state transitions.
- `src/context.js`: project root detection and bounded project instruction collection.
- `src/prompt.js`: reviewer prompt construction.
- `src/cli.js`: user-facing CLI commands.
- `src/mcp-server.js`: MCP stdio server exposing review queue tools.
- `test/*.test.js`: Node test coverage for core behavior.
- `templates/*`: reviewer and integration templates.
- `README.md`: install, usage, security model, and extension guide.

## Tasks

### Task 1: Review Store

- [x] Write failing tests for create, claim, complete, and list behavior.
- [x] Implement JSON-backed review store with atomic writes.
- [x] Verify store tests pass.

### Task 2: Project Context

- [x] Write failing tests for project root detection and instruction file capture.
- [x] Implement bounded context collection for AGENTS.md, CLAUDE.md, GEMINI.md, and `.cursor/rules/*.md`.
- [x] Verify context tests pass.

### Task 3: Prompt Rendering

- [x] Add prompt renderer that includes goal, guide, subject, project metadata, and instruction excerpts.
- [x] Verify prompt output in tests through store/CLI flows.

### Task 4: CLI

- [x] Implement `submit`, `pending`, `claim`, `complete`, `show`, `cancel`, and `prompt`.
- [x] Keep command output script-friendly JSON by default where useful.

### Task 5: MCP Server

- [x] Implement minimal stdio JSON-RPC methods: `initialize`, `tools/list`, and `tools/call`.
- [x] Expose queue operations as MCP tools.

### Task 6: Documentation and Templates

- [x] Write README with install, usage, host integration, security, and extension guidance.
- [x] Add Codex skill and Claude command templates.

