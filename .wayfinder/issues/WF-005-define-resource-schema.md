---
id: WF-005
title: Define the repository agent-resource schema
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by: []
---

## Question

What are the canonical schemas, validation rules, precedence rules, identities, and
discovery behavior for repository agents, bundled internal agents, skills, MCP
servers, and personal/project memories, including the exact agent frontmatter
contract for `name`, `title`, `description`, `tools`, `skills`, `mcp`,
`user-invocable`, and any future-compatible fields?

## Resolution

### Compatibility boundary

The Workbench Runtime reads the same repository Agent, Skill, and MCP artifacts
as VS Code, but executes them independently because the stable VS Code API does
not expose the Native Agent Runtime to extensions. Compatibility therefore means
using native file formats and semantics without adding Workbench-only
frontmatter fields. Unknown future native fields produce warnings rather than
invalidating a resource. A known unsupported field that materially changes
execution safety or isolation makes that resource unavailable instead of being
silently ignored.

### Agents

- Discover only direct `.github/agents/*.agent.md` files for the MVP.
- The filename minus `.agent.md` is the stable Agent Identity and fallback
  display name. The identity may contain only letters, numbers, `.`, `_`, and
  `-`. Identities that differ only by case are conflicting and invalid.
- The native optional `name` field changes display text only. The Workbench
  additionally requires a non-empty native `description` and non-empty Markdown
  instructions.
- Accept native VS Code/Copilot fields and meanings: `name`, `description`,
  `argument-hint`, `tools`, `agents`, `model`, `user-invocable`,
  `disable-model-invocation`, deprecated `infer`, `target`, `handoffs`,
  `hooks`, `mcp-servers`, and `metadata`. Do not add `title`, `skills`, `mcp`,
  `schema-version`, or extension-prefixed fields.
- Omitted `user-invocable` means `true`; omitted
  `disable-model-invocation` means `false`. Deprecated `infer` is accepted with
  a warning and supplies legacy values only where the replacement fields are
  absent.
- Omitted or wildcard `agents` permits all otherwise model-invocable Agents,
  `[]` permits none, and an explicit list permits only its targets. An explicit
  target follows native behavior and may authorize an Agent whose
  `disable-model-invocation` is `true`.
- Model precedence is: an explicit Chat/Task selection, then the Agent's native
  `model` preference or ordered fallback list, then Workbench Auto. The
  effective model is always visible and recorded.
- An absent `target` or `target: vscode` is locally runnable.
  `target: github-copilot` and unknown future targets remain visible but are not
  locally runnable.
- `argument-hint` supplies empty-input placeholder guidance. Native `handoffs`
  render in Chat with native `prompt`, `send`, target-Agent, and model behavior;
  they do not participate in autonomous Task execution.
- Agents containing preview `hooks` remain visible but non-runnable until the
  Workbench implements the stabilized hook lifecycle. Cloud-only `mcp-servers`
  and `metadata` are retained in the file but ignored locally with an
  informational diagnostic.
- Parse one UTF-8 YAML mapping. Reject duplicate keys, aliases, anchors, merge
  keys, custom tags, multiple YAML documents, and non-string map keys.
  Frontmatter is capped at 32 KiB, Agent Instructions at 30,000 Unicode
  characters, and the complete file at 256 KiB.
- Bundled Agents use the same manifest contract. A Repository Agent with
  identity `orchestrator` replaces the Bundled Orchestrator. Collisions with
  `memory-manager`, `skill-creator`, or `agent-creator` are invalid.

### Skills

- Discover only `.github/skills/<skill-name>/SKILL.md` for the MVP.
- Follow the stable native VS Code Agent Skill contract unchanged: required
  matching `name` and `description`, plus native optional `argument-hint`,
  `user-invocable`, and `disable-model-invocation`, with native name and
  description limits.
- Every Agent can discover every valid Skill. Skill bodies and supporting files
  load progressively only after user invocation or model selection from
  metadata.
- A Skill declaring experimental `context: fork` remains visible but
  unavailable until the Workbench implements stabilized forked execution.

### Tools

- Keep three distinct catalogs in configuration and diagnostics: Workbench
  Tools, language-model Tools registered by other extensions, and MCP Tools
  grouped by server. Preserve each origin's identity, status, permissions, and
  lifecycle. Flatten the selected tools only when constructing the
  `vscode.lm` request.
- Native `tools` semantics apply. Omission selects all tools currently available
  to the Workbench, `[]` selects none, and an explicit list selects only named
  tools or tool sets, including MCP patterns such as `<server>/*`.
- A requested tool unavailable to the Workbench is omitted with a prominent
  capability warning. The Workbench never substitutes another tool or broadens
  an explicit allowlist.

### MCP

- `.vscode/mcp.json` is the single canonical repository MCP configuration. VS
  Code and the Workbench read it independently; the Workbench owns the client
  needed to expose MCP tools to its `vscode.lm` loop.
- Support stable `stdio`, Streamable HTTP, and SSE server forms, native
  predefined variables, all three input types (`promptString`, `pickString`,
  and `command`), and standard OAuth. Interactive input, commands, and
  authorization start only from a user action; unresolved Task requirements
  become externally blocked. Secrets and tokens live in `SecretStorage`.
- A server declaring native `sandboxEnabled: true` is unavailable because the
  Workbench cannot reuse VS Code's sandbox. Preview enterprise-managed OAuth is
  likewise unavailable. Native MCP `dev.watch` and `dev.debug` are ignored with
  warnings in the MVP.
- Validate and connect servers independently. One invalid or unsupported server
  does not prevent other servers from working; malformed top-level JSON
  invalidates the complete MCP configuration.

### Memories

- Memory is explicitly Workbench-owned because VS Code's preview local Memory
  store is not exposed through the stable extension API.
- Discover direct Markdown files beneath
  `.github/memories/project/` and `.github/memories/personal/`. Nested and
  unrelated files are ignored.
- A Memory's identity is `(scope, id)`, so the same ID may exist in both scopes.
  Store one Memory per `<id>.md`; IDs are lowercase kebab-case and must match
  the filename.
- Require frontmatter fields `id`, `title`, `description`, `tags`,
  `created-at`, and `updated-at`, followed by non-empty Markdown content.
  Timestamps are UTC RFC 3339; `created-at` is immutable and `updated-at`
  changes with metadata or content.
- The complete Memory file, including frontmatter, is capped at 4,000 Unicode
  characters. Across both scopes there may be at most 50 active Memories.
  Titles are capped at 80 characters, retrieval descriptions at 160
  characters, and tags at eight short values. The Memory Manager consolidates
  before creating a fifty-first entry.
- Before every turn or subtask, every Agent receives compact, separate Personal
  and Project Memory Indexes containing scope-qualified ID, title, retrieval
  description, tags, and update time. Agents retrieve selected memory content
  on demand. Read-only index and retrieval access is a Runtime context facility
  independent of the native `tools` allowlist.
- Only the Bundled Memory Manager may durably create, update, consolidate, or
  remove Memories.
- Personal Memory is disabled unless `.github/memories/personal/` is
  effectively ignored by Git and contains no tracked files. The Workbench shows
  a blocking privacy diagnostic and offers an explicit ignore-rule action; it
  never silently edits Git state or stores personal data in a tracked path.

### Discovery and future sources

Watch canonical locations and parse changed resources into immutable versions.
Replace registry entries atomically, surface invalid edits as the current state,
and never change the snapshot used by an already-running model or tool call.
Chat and Task lifecycles define their next resource-snapshot boundary.

Additional Resource Sources are a future Workbench Settings feature. The MVP
uses only the fixed shallow repository locations above.

The shared domain language established during this decision is recorded in
[CONTEXT.md](../../CONTEXT.md).
