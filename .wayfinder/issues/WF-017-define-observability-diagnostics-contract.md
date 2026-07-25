---
id: WF-017
title: Define the operational diagnostics and supportability contract
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
---

## Question

Which structured logs, health signals, diagnostic exports, audit views, privacy
redactions, retention rules, support workflows, and failure evidence must the
MVP expose so users and builders can understand and recover from operational
problems without leaking repository content or secrets?

## Resolution

### Evidence model and privacy boundary

The MVP uses local, structured, metadata-first diagnostics. It does not create a
second archive of repository or conversation content and does not send
telemetry.

Operational evidence has four distinct layers:

1. Authoritative Task, Chat, checkpoint, operation, approval, and audit records
   remain the source of truth for execution and recovery.
2. Diagnostic Events are append-only, structured, sanitized observations that
   explain operational changes and link to authoritative record identities.
3. A Health Snapshot is a derived point-in-time view of current dependencies,
   integrity conditions, and recovery blockers.
4. Activity, diagnostic details, the VS Code output channel, and exports are
   human-facing projections; none is an independent source of truth.

Default Diagnostic Evidence may retain lifecycle transitions, stable event and
error codes, timing, component and release identifiers, correlation and
causation identities, authority outcomes, operation identities, affected
repository-relative paths, and hashes or size summaries. It excludes full
prompts, model output, file contents, diffs, Tool payloads, command output,
secrets, and absolute host paths. Existing user-visible Chat history and private
operation artifacts remain only in their authoritative stores.

Free-form console text is not recovery or support evidence. A
`Bridgit Diagnostics` VS Code output channel may mirror the current extension
host session's sanitized Diagnostic Events for builders, but it uses the same
redaction contract, captures no richer data, and has no separate persistence.

### Health contract

The Runtime derives a Health Snapshot on activation, after recovery, and when
the user explicitly refreshes diagnostics. Every check has a stable check
identity, one of `healthy`, `degraded`, `blocked`, or `unknown`, an observation
time, user impact, sanitized evidence links, and a concrete next action.

The fixed MVP checks cover:

- package and environment: extension version, Supported Target, declared VS
  Code compatibility, and Workbench Protocol match;
- storage: database availability and integrity, schema and migration state,
  backup availability, and free-space failures;
- Runtime: recovery state, stale leases, pending reconciliation, Unknown
  Operation Outcomes, and Repository Write Lock state;
- repository: canonical-root availability, Approved Linked Root validity, Git
  availability, and repository conflicts;
- models and resources: `vscode.lm` availability and counts of valid, invalid,
  or unavailable Agents, Skills, Tools, Memories, and MCP resources;
- security dependencies: SecretStorage availability, MCP configuration and
  trust validity, and authority-policy readiness; and
- attention: unresolved recovery and action-required conditions whose notices
  might otherwise be missed.

Health checks are read-only and side-effect-free. They do not start MCP
servers, invoke models, contact providers, request authority, or read repository
contents merely to establish health. A dependency remains `unknown` until it is
observed through normal authorized use or an explicit user-run connection test.

### Activity and audit views

The Activity area provides a concise chronological narrative of Tasks, Chats,
recovery, permissions, migrations, and failures. Each item may expand into
structured diagnostic details and sanitized evidence links. Users may filter by
time, severity, component, Task or Chat, Agent, event code, Operation Key, and
outcome.

Related entries form a navigable causal chain from Task through Subtask,
Assignment Attempt, Response or model/Tool operation, Tool Audit Record, and
reconciliation. Tool audit details expose the authority decision, sanitized
inputs and result summary, affected path tokens, declared endpoints, timing,
terminal outcome, and append-only corrections.

Expected denials, cancellations, and ordinary pauses are outcomes rather than
system errors. A failure or blocked state offers `View diagnostics`,
`Copy incident ID`, and `Create Support Bundle`. The MVP exposes neither raw
SQLite tables nor a generic raw-log console.

### Operational Incidents and failure evidence

Every unexpected failure or recovery blocker creates or updates one durable
Operational Incident. Its required evidence is:

- stable Incident ID and machine-readable error code;
- `warning`, `error`, or `critical` severity, with a separate
  `actionRequired` flag;
- time, component, release, Supported Target, and correlation and causation
  identities;
- references to relevant Task, Chat, attempt, Durable Checkpoint, Resource
  Snapshot, Tool Audit Record, and Operation Key records;
- state immediately before and after the failure;
- an operation outcome of known, not applied, applied, or unknown;
- retryability, attempts already made, user impact, and the next safe action;
- sanitized exception class and safe message, source-mapped Workbench stack
  frames, and a stack fingerprint; and
- an account of fields redacted or dropped.

Raw exceptions are sanitized before persistence. When sanitization cannot
establish safety, only the error code, component, and fingerprint are retained.
If the extension host terminates before recording a failure, startup recovery
derives the incident from the last committed checkpoint and outstanding durable
operation intents. It never infers that an unrecorded effect succeeded.

### Retention

Authoritative Task, Chat, approval, checkpoint, and Tool Audit Records follow
the lifecycle of their owning object and are never removed by diagnostic
cleanup.

Ordinary Diagnostic Events use a per-workspace rolling limit of 30 days or
50 MiB, whichever limit is reached first. Evidence associated with an
unresolved recovery blocker, Unknown Operation Outcome, failed migration, or
repository conflict is Pinned Diagnostic Evidence and remains protected until
resolution, then remains for a further 30 days. Health Snapshots are generated
on demand and are not retained as history.

Users may clear ordinary diagnostics immediately. Clearing Pinned Diagnostic
Evidence requires a named warning. Removing authoritative operational data
continues to require the existing strongly confirmed Workbench-data reset.

### Support Bundle

Support is local and user initiated. A Support Bundle is a `.zip` saved through
a file dialog and contains:

- a plain-language incident summary and generation time;
- package and environment compatibility metadata;
- the current Health Snapshot;
- a bounded incident timeline of Diagnostic Events and linked audit metadata;
- migration, recovery, and integrity outcomes; and
- a schema/version manifest, redaction report, and bundle checksum.

By default, absolute paths, usernames, machine identifiers, repository
identity, endpoints, and repository-relative filenames become stable
bundle-local tokens. File extensions and evidence relationships may remain.
Secrets are never exportable.

The user may explicitly select transcript excerpts, Tool inputs or results,
diffs, or file snippets for one bundle. Every content-bearing item receives an
exact pre-save preview. Inclusion is not reusable consent. The Workbench never
writes a bundle into the repository by default, retains it, uploads it, or sends
it automatically.

### Support and recovery boundary

The Diagnostics area may open the owning Task or Chat, navigate causal evidence,
copy an Incident ID, rerun safe health checks, and create a Support Bundle.
Critical or action-required incidents use the established Attention Request and
Workbench Notice contract.

State-changing recovery actions such as reconciliation, backup restoration,
migration retry, resume, cancel, and reset are links into their existing guarded
workflows and confirmations. Diagnostics itself cannot mutate operational state,
replay Tools, edit or delete audit history, weaken redaction, broaden authority,
or offer a generic operation-retry action. The MVP has no vendor support
backend.

The clarified domain language is recorded in
[CONTEXT.md](../../CONTEXT.md).
