# Cross Review Bridge

Korean guide: [README.ko.md](README.ko.md)

Local MCP and CLI bridge for cross-reviewing AI assistant answers across Codex, Claude Code, Antigravity, Gemini, and future AI tools.

The bridge does **not** call OpenAI, Anthropic, Google, or any model API by default. It stores review requests locally so each AI host can perform the review with its own logged-in app/session/subscription.

## Why

When working with multiple AI coding tools, you often want to ask:

- "Review the last Codex answer with Claude."
- "Ask Codex to critique this Claude Code plan."
- "Send this proposal to another model and bring the feedback back here."

Doing that manually means copying the answer, opening another app, pasting a review prompt, copying feedback back, and asking the original agent to react. Cross Review Bridge turns that into a local queue.

## What This Is Not

- Not a model router.
- Not an API proxy.
- Not a way to reuse hidden app login tokens.
- Not a browser automation tool.

By default, it uses local files only. Any model usage happens inside the app or agent that claims the review.

## Install

Requires Node.js 24 or newer, for the built-in `node:sqlite` module. The project still has zero runtime dependencies.

```bash
git clone <your-repo-url> cross-review-bridge
cd cross-review-bridge
npm test
npm link
```

After `npm link`, the CLI is available as:

```bash
xreview --help
```

## Register With Codex And Claude Code

Register the MCP server with Codex:

```bash
codex mcp add cross-review-bridge -- node /absolute/path/to/cross-review-bridge/src/mcp-server.js
```

Register the MCP server with Claude Code for all projects:

```bash
claude mcp add --scope user cross-review-bridge -- node /absolute/path/to/cross-review-bridge/src/mcp-server.js
```

Install optional Codex and Claude helper templates:

```bash
mkdir -p ~/.codex/skills/cross-review ~/.claude/commands ~/.claude/agents
cp integrations/codex/SKILL.md ~/.codex/skills/cross-review/SKILL.md
cp integrations/claude/commands/*.md ~/.claude/commands/
cp integrations/claude/agents/*.md ~/.claude/agents/
```

Restart existing Codex or Claude Code sessions after adding new MCP servers, skills, commands, or agents.

## Quick Start

There are two ways to submit text for review:

1. Put short text directly in the command.
2. Put long text in a file and pass the file path with `--subject-file`.

If you are not comfortable with temporary files yet, start with `xreview review "..."`.

### Option A: No Extra Files

Submit a short review request from the source tool:

```bash
xreview review "Here is the answer or plan I want reviewed."
```

By default, Codex submissions target Claude. Claude submissions can target Codex by setting the source:

```bash
xreview review --source claude "Here is the answer or plan I want reviewed."
```

Claim it from the reviewer tool:

```bash
xreview claim --target claude --reviewer claude-code --format prompt
```

After the reviewer writes feedback, complete the review:

```bash
xreview complete <review-id> \
  --reviewer claude-code \
  --result "Here is the review feedback."
```

Back in the original tool:

```bash
xreview show <review-id>
```

### Option B: Using Files For Long Text

For long answers, it is easier to save the answer in a file first:

```bash
xreview submit \
  --source codex \
  --subject-file answer.md
```

Then claim it from the reviewer tool:

```bash
xreview claim --target claude --reviewer claude-code --format prompt
```

Paste the prompt into Claude Code or have Claude Code run it directly. If the feedback is long, save it to a file and complete the review:

```bash
xreview complete <review-id> \
  --reviewer claude-code \
  --result-file feedback.md
```

### Option C: Review Types & Advanced Options (Plan & Proposal Review)

You can specify the review type (`plan` for `PLAN_AND_PROPOSAL`, `code` for `CODE_DIFF`, `general`), include proposed plan files, context/ADR documents, and specific review questions:

```bash
# Submit a technical plan or architecture proposal for cross-review (Plan Critic & Red Teaming)
xreview submit \
  --type plan \
  --target claude \
  --subject "Budget Reservation Architecture Proposal" \
  --plan-file docs/architecture_plan.md \
  --context-docs docs/adr-001.md,docs/spec.md \
  --question "Does this conflict with existing token reservation?" \
  --question "Are there unhandled rollback/settlement edge cases?"

# Submit a code diff for spec & contract validation
xreview submit \
  --type code \
  --target codex \
  --subject-file diff.patch
```

When `--plan-file` or `--context-docs` are specified, `cross-review-bridge` automatically captures their actual file content (with root boundary checks and max character limits) and embeds them directly into the markdown review prompt.

Back in the original tool:

```bash
xreview show <review-id>
```

Important: `answer.md` and `feedback.md` are just example file names.

- `xreview` does not create `answer.md` automatically.
- `xreview` does not create `feedback.md` automatically.
- `xreview` does not delete those files automatically.
- `--subject-file answer.md` means "read the review subject from this existing file."
- `--result-file feedback.md` means "read the review result from this existing file."

If you create temporary files only for one review, you can delete them yourself after the review is completed:

```bash
rm answer.md feedback.md
```

The actual review queue is stored separately in:

```text
~/.cross-review-bridge/reviews.db
```

That queue file is not automatically deleted, because it is the review history.

## Review Rules

The queue enforces a few rules so a review cannot be silently lost or overwritten:

- A review must be claimed before it can be completed.
- Only the reviewer that claimed it can complete it. Pass the same `--reviewer` to `claim` and `complete`.
- A completed result is immutable. For another round, submit a new review instead of re-completing.
- A completed review cannot be cancelled.
- The review subject is capped at 120,000 characters. Oversized input is rejected rather than truncated, because a diff cut in half produces a review of code that does not exist.

Review material is embedded in the reviewer prompt inside fenced blocks and labelled as untrusted, and the reviewer is told to treat it as data rather than instructions.

## Beginner Mental Model

Think of Cross Review Bridge as a local inbox.

```text
Codex writes a review request
        ↓
Cross Review Bridge stores it in a local inbox
        ↓
Claude Code opens the inbox and writes feedback
        ↓
Codex reads the feedback from the same inbox
```

The bridge itself does not think, call models, or spend API money. The AI app that reads and reviews the request uses its own normal logged-in session or subscription.

## MCP Server

Run the MCP server over stdio:

```bash
cross-review-bridge
```

It exposes these tools:

- `submit_review`
- `list_reviews`
- `claim_review`
- `complete_review`
- `get_review`
- `render_review_prompt`
- `cancel_review`

Example MCP server command:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/cross-review-bridge/src/mcp-server.js"]
}
```

## Project Context

When a review request is submitted from a project directory, the bridge captures bounded project context:

- `projectRoot`
- `cwd`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.cursor/rules/*.md`
- Git branch and short status, when available

This lets the reviewer see project-specific instructions without copying the whole repository.

Use `--cwd` to override the context directory:

```bash
xreview submit --cwd /path/to/project --source codex --subject-file answer.md
```

## Storage

Reviews live in a SQLite database:

```text
~/.cross-review-bridge/reviews.db
```

SQLite is used because several hosts share this file: a Codex MCP server, a Claude MCP server, and the CLI are separate processes writing the same store. Writes run inside a `BEGIN IMMEDIATE` transaction, so two reviewers cannot claim the same review, and a competing process waits for the lock instead of failing.

If you used an earlier version, the first run imports `reviews.json` from the same directory into the database. The JSON file is left in place, so nothing is lost if you want to go back.

Override it with:

```bash
export CROSS_REVIEW_HOME=/path/to/review-state
```

Or per command:

```bash
xreview pending --store /tmp/reviews.db
```

## Suggested Workflow

Codex asks Claude to review the last answer:

```text
Submit my last answer to the cross-review bridge.
Target: claude
Goal: Check whether this design is practical.
Guide: Prioritize missing failure cases, security risks, and unnecessary complexity.
```

Claude Code claims and reviews:

```text
Use xreview claim --target claude --format prompt, review the request, then complete it with xreview complete.
```

Codex pulls the feedback:

```text
Fetch the completed review and summarize which points should be applied.
```

## Security Model

The bridge stores user-provided review subjects and captured project instruction files locally. It does not send data to external APIs by itself.

Be careful with:

- Secrets accidentally included in an answer.
- Proprietary project instructions.
- Sensitive data in review subjects.
- Sharing `~/.cross-review-bridge/reviews.db`.

See [docs/security.md](docs/security.md).

## Extending To New Tools

Targets are plain strings:

```text
claude
codex
antigravity
gemini
custom:<name>
```

To add a new host, create a small adapter or instruction template that can:

1. Claim reviews for its target.
2. Render the review prompt.
3. Complete the review with feedback.

See [docs/architecture.md](docs/architecture.md).

## Development

```bash
npm test
npm run check
```

This project intentionally starts with zero runtime dependencies. If an official MCP SDK dependency is added later, keep the no-API-call-by-default security model.
