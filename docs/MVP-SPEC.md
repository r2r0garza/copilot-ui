# Bridgit Agent Workbench — MVP Specification

Status: **accepted for implementation planning**  
Canonical revision: `mvp-spec/2`  
Workbench Protocol version: `1`  
Database schema version: `1`  
Supported targets: `win32-x64`, `darwin-arm64`  
Supported VS Code range: `1.130.x`

This document and the normative contract annexes named in Section 18 form the
canonical source of truth for the Bridgit Agent Workbench MVP. The files in
`docs/manifests/` are machine-readable projections or normative machine
contracts as identified there. If canonical prose and a projection disagree,
the canonical prose wins and the Specification Acceptance Gate fails until the
projection is regenerated. A normative machine contract is instead required to
agree exactly with its owning decision annex.

The specification assembles every closed decision in the Wayfinder map
`.wayfinder/issues/WF-001-vscode-agent-workbench-spec.md`. It does not reopen
those decisions. Section 17 records how the original blocker set was resolved
and Section 18 fixes the precedence of the resulting specification package.

## 1. Product contract

Bridgit is a single-user, local-first desktop VS Code extension for one open,
single-folder Git repository. It provides:

- interactive, durable Chat Sessions;
- durable autonomous Tasks that can decompose work into routed Subtasks;
- repository-defined Agents and Skills using native VS Code/Copilot formats;
- extension-owned MCP integration, Memory, authority, recovery, diagnostics,
  and orchestration; and
- one full-editor Workbench opened from a single-action sidebar launcher.

The Workbench operates only while its VS Code Extension Host is alive. Durable
state permits recovery from a known checkpoint after restart; it does not make
execution remote or continuously available.

### Invariants

| ID | Invariant |
| --- | --- |
| `INV-AUTHORITY` | Model output cannot grant authority, commit operational state, bypass policy, or establish completion. |
| `INV-ONE-TASK` | At most one top-level Task owns the Active Task Slot. |
| `INV-ONE-WRITER` | At most one repository-mutating execution is active globally. |
| `INV-WEBVIEW` | The Webview owns presentation state only; authoritative state lives in the extension host. |
| `INV-DURABILITY` | Recovery begins from committed state and reconciles uncertain effects before retry. |
| `INV-BOUNDARY` | Repository-confined effects remain inside the canonical Repository Boundary. |
| `INV-IMMUTABLE-HISTORY` | Attempts, audits, graph revisions, and established Chat history are append-only or superseded, never rewritten. |
| `INV-EXPLICIT-MEMORY` | Memory changes require an exact proposal and explicit confirmation. |
| `INV-NO-SECRET` | Secrets do not enter model context, schemas, audit, diagnostics, or inherited command environments. |
| `INV-NO-WAIVER` | Every mandatory gate check passes with required evidence; skips and waivers block. |

## 2. Scope and exclusions

The Repository Boundary is the canonical primary repository plus explicitly
Approved Linked Roots. Git is the only sharing mechanism. There is no backend,
sync service, telemetry service, hosted orchestration, or vendor support
backend.

Excluded from the MVP are multi-user collaboration; cloud sync; remote Task
execution; multiple or multi-root workspaces; execution outside approved roots;
parallel writers; worktree isolation; configurable resource-source locations;
Marketplace distribution; Linux, Intel macOS, Windows ARM, VS Code for Web,
Remote SSH, WSL, Dev Containers, and remote Extension Hosts; destructive Git;
direct credential retrieval; automatic publishing; and organization-controlled
VDI resource budgets or user budget dashboards.

## 3. Architecture

The product is a feature-oriented TypeScript modular monolith in the desktop
Extension Host.

```text
Workbench Webview
      │ versioned, validated Workbench Protocol
      ▼
Protocol gateway → application layer → feature interfaces
                                      │
                                      ▼
                         deterministic Runtime kernel
                                      │ ports
                                      ▼
 SQLite | vscode.lm | repository/Git | Tools | MCP | SecretStorage | notifications
```

Feature modules own Tasks, Chats, Agents, Resources, execution authority,
Memory, and attention. Cross-feature workflows use declared application
interfaces; features do not import one another's internals. The Webview may
share protocol types but cannot import domain or Runtime code.

The Runtime validates all Agent choices against lifecycle, Task Contract, graph,
Resource Snapshot, authority, lock, and operation history. Agents retain
reasoning authority to interpret Goals, decompose work, route, select calls,
react to results, propose graph revisions, and assess apparent completion.

### Prescribed scaffold

```text
src/
├── extension.ts
├── protocol/
├── runtime/
├── features/{tasks,chats,agents,resources,execution-authority,memory,attention}/
├── ports/
├── adapters/{sqlite,vscode-lm,repository,tools,mcp,secrets,notifications}/
└── webview/
tests/{unit,contract,integration,scenarios,e2e}/
```

### Workbench Protocol contract

The Workbench Protocol is a closed same-release JSON contract. The Extension
Host binds one live Webview instance through a handshake carrying protocol,
release, Webview-instance, workspace, and projection identities. A replacement
Webview supersedes the former instance. Reconstruction uses one authoritative
snapshot at a committed workspace sequence followed by a gapless ordered event
stream; a gap, collision, or invalidation requires resnapshot rather than client
inference.

Every request has distinct Request and Operation identities, a canonical
fingerprint, correlation and causation identities, expected aggregate versions,
and one exact command/query discriminator. Exact Operation replay returns the
recorded result without another effect. Identity reuse with different content,
stale versions, malformed or oversized input, unknown fields, wrong release or
instance, and unauthorized or guard-rejected operations have deterministic
side-effect-free errors.

The exact handshake/control schemas, shared values, 22 query identities, 60
command identities, lifecycle and projection event catalogs, payload families,
limits, validation order, error envelope, and contract-suite obligations are
the normative
[Workbench Protocol annex](../.wayfinder/issues/WF-020-lock-workbench-protocol-contract.md).
Implementations MUST generate fake and production protocol adapters from one
schema source and MUST NOT rename or collapse a catalog identity.

### Normative requirements

#### NR-ARC-001
The implementation MUST be one feature-oriented TypeScript modular monolith
running in a desktop VS Code Extension Host.

#### NR-ARC-002
The Webview MUST communicate with the host only through a versioned, validated
command-and-event protocol and MUST reconstruct authoritative state after reload.

#### NR-ARC-003
The Webview MUST NOT own authoritative domain or durable execution state.

#### NR-ARC-004
Feature modules MUST own their domain internals and coordinate across declared
application interfaces.

#### NR-ARC-005
The Runtime MUST deterministically enforce lifecycle, authority, boundary,
locking, operation, and completion policy before effects or state transitions.

#### NR-ARC-006
The implementation MUST expose a headless Runtime harness accepting the same
application commands as the Webview and replaceable ports for time, identity,
models, Tools, filesystem, Git, MCP, secrets, notifications, authority, user
responses, and crash points.

#### NR-ARC-007
The Workbench Protocol MUST implement exactly the version-1 handshake, control,
query, command, event, payload, ordering, idempotency, rejection, and
reconstruction contracts in the normative Protocol annex from one generated
schema authority shared by fake and production adapters.

## 4. Resource discovery and model selection

Repository Agents are direct `.github/agents/*.agent.md` files. Their stable,
case-insensitive-unique identity is the filename stem and uses only letters,
digits, `.`, `_`, and `-`. Native frontmatter is accepted without
Workbench-only fields. `description` and Markdown instructions are required.
Unknown future fields warn; a known unsupported field that changes safety or
isolation makes the Agent unavailable. Preview hooks make an Agent non-runnable.
Only `target: vscode` or an absent target runs locally.

The bundled Agents are `orchestrator`, `memory-manager`, `skill-creator`, and
`agent-creator`. Only a Repository Agent named `orchestrator` may replace a
bundled identity.

Skills are direct `.github/skills/<name>/SKILL.md` files using the native Skill
contract. Every valid Skill is discoverable; content loads progressively after
selection. `context: fork` is visible but unavailable.

`.vscode/mcp.json` is the single MCP source. The Workbench independently
implements stable stdio, Streamable HTTP, and SSE clients, predefined variables,
the three native input types, and OAuth. User interaction initiates inputs,
commands, and authorization. `sandboxEnabled: true` and preview
enterprise-managed OAuth are unavailable.

Models are enumerated through `vscode.lm`. Selection precedence is explicit
Chat/Task choice, Agent `model`, then Workbench Auto. Auto is an
extension-defined per-request resolver. Every attempt records the requested and
effective model. Missing consent, quota, availability, or provider capability
is represented durably; no model or Agent is silently substituted.

#### NR-RES-001
The Runtime MUST discover only the canonical shallow Agent, Skill, Memory, and
MCP locations fixed above and isolate an invalid resource from unrelated valid
resources unless the top-level MCP JSON is malformed.

#### NR-RES-002
Agent parsing MUST enforce the identity, native-field, size, UTF-8 YAML, target,
collision, and runnable-state rules decided in WF-005.

#### NR-RES-003
Skill parsing MUST enforce the native name, description, invocation, and
availability rules and load bodies progressively.

#### NR-RES-004
Tool catalogs MUST preserve Workbench, extension, and MCP origins and MUST NOT
substitute or broaden an explicit native `tools` allowlist.

#### NR-RES-005
MCP configuration, trust, interactive input, authentication, unsupported
features, and server isolation MUST follow the contract above.

#### NR-RES-006
Each model or Tool execution MUST pin an immutable Resource Snapshot; later
executions use the latest validated resources without hot-swapping an active
attempt.

#### NR-MOD-001
Model selection MUST follow explicit selection, Agent preference, then
Workbench Auto, and MUST record the effective model for every attempt.

#### NR-MOD-002
The Runtime MUST classify consent, authorization, availability, quota,
disappearance, stream, and provider failures without silently falling back from
an explicit selection.

## 5. Agent selection and routing

The Runtime first filters hard eligibility from native delegation authorization,
invocation rules, validity, availability, target, and known resources. The
Orchestrator then selects semantically by positive objective coverage, resource
fit, and a recorded one-sentence rationale. Ties use specificity, resource fit,
Repository Agent preference, then Agent Identity.

No suitable Agent creates an Agent Capability Gap. The Agent Creator proposes a
Repository Agent; nothing is written without approval. A user override bypasses
semantic suitability for one Assignment Attempt but never hard eligibility.
Three similar overrides for one Agent trigger an update proposal and reset the
cycle after approval or rejection.

Delegated Subagents always receive `decline_assignment(reason,
unmet_requirements)`. One automatic reroute is permitted; a second decline or
remaining gap enters `waiting-for-routing`. Assignment Attempts remain
append-only.

#### NR-ROUTE-001
The Runtime MUST establish Agent Eligibility before the Orchestrator performs
semantic Agent Selection.

#### NR-ROUTE-002
Selection MUST record candidates, chosen Agent, Resource Snapshot, and concrete
fit rationale and MUST apply the settled deterministic tie-breakers.

#### NR-ROUTE-003
An Agent Capability Gap MUST enter `waiting-for-routing` and MUST NOT cause an
unsuitable assignment or unapproved Agent-file write.

#### NR-ROUTE-004
A routing override MUST apply to one eligible Assignment Attempt and the
three-similar-mismatch proposal cycle MUST remain explicit and audited.

#### NR-ROUTE-005
Capability Decline MUST terminate the current attempt, preserve unmet
requirements, permit at most one automatic reroute, and never count ordinary
operational failure as routing evidence.

## 6. Task lifecycle

A versioned user-confirmed Task Contract contains Goal, testable success
criteria, scope and safety constraints, initial Agent/model preferences, Task
Dependencies, Repository Boundary, and Task authority. Admission proposes a
dependency only when success requires a named artifact or repository state from
another Task. Each edge is independently confirmed or denied; denials remain
recorded until materially new evidence appears.

Task states are `admitting`, `queued`, `preparing`, `running`, `quiescing`,
`paused`, `waiting-for-routing`, `waiting-for-dependency-confirmation`,
`externally-blocked`, `recovering`, `verifying`, `succeeded`, `failed`, and
`cancelled`.
Subtask states are `pending`, `ready`, `running`, `waiting-for-routing`,
`succeeded`, `failed`, `superseded`, and `cancelled`. Assignment Attempt states
are `selected`, `running`, `succeeded`, `declined`, `failed`, `interrupted`,
`outcome-unknown`, and `cancelled`.

The Subtask graph is a success-only DAG. Revisions may append Subtasks and
edges or supersede pending work within the confirmed contract. Running and
completed work is immutable. There are at most three concurrent Assignment
Attempts, only one of which may be Write-capable.

The active Task holds the Repository Write Lock while preparing/running,
verifying, or quiescing and releases it in every non-executing state. It retains
the Active Task Slot after acquisition throughout its active nonterminal states;
admission and queued states own no slot. Before active execution resumes from a
non-executing state, Repository Reactivation rereads disk and classifies drift.
Conflicting or unclassifiable drift enters
`externally-blocked:repository-conflict`.

Pause and cancel quiesce. Force-stop marks unsettled operations
`outcome-unknown`. Transient operations receive at most three attempts.
Mutations retry only when reconciliation proves non-application or provider
idempotency. Completion requires successful required Subtasks, no unresolved
dependencies or outcomes, and a Completion Check. Three unsuccessful repair
cycles require user intervention.

Task Continuation (`preparing|running|verifying`) and Quiescence Disposition are
durable data, not states. The Runtime follows the exhaustive transition,
classification, guard, effect, event, lease, rejection, and recovery matrices
in the normative
[Lifecycle annex](../.wayfinder/issues/WF-019-define-lifecycle-transition-contracts.md).
Every accepted transition has one stable Domain Transition Event identity and
increments its aggregate version exactly once. Every invalid transition is
side-effect-free except the single sanitized deduplicated Rejection Record
permitted after application dispatch.

#### NR-TASK-001
Admission MUST persist a versioned, explicitly confirmed Task Contract before a
Task enters the queue.

#### NR-TASK-002
Task Dependency proposals MUST use the named-artifact success test, store each
decision and rationale independently, reject cycles, and preserve denied
evidence until it materially changes.

#### NR-TASK-003
The scheduler MUST allow only one Active Task Slot owner and start the earliest
ready Task by stable submission order while skipping blocked queued Tasks.

#### NR-TASK-004
Task Graph Revisions MUST preserve a success-only acyclic graph, immutable
running/completed history, and the confirmed Task Contract boundary.

#### NR-TASK-005
The scheduler MUST run no more than three Assignment Attempts concurrently and
no more than one Write-capable attempt.

#### NR-TASK-006
Repository Write Lock acquisition, release, and Chat interaction MUST obey the
state contract above, independently of Active Task Slot ownership.

#### NR-TASK-007
Repository Reactivation MUST reread disk and classify drift before a Task leaves
any non-executing state.

#### NR-TASK-008
Pause and cancellation MUST quiesce safely, preserve completed effects, persist
outcomes and checkpoints, and release the write lock.

#### NR-TASK-009
Operation retry MUST use stable Operation Keys and MUST NOT replay an uncertain
mutation before conclusive reconciliation.

#### NR-TASK-010
Activation recovery MUST interrupt formerly running attempts, reconcile
operations, restore the last checkpoint, reactivate the repository, revalidate
resources and authority, and resume only when safe.

#### NR-TASK-011
Completion MUST require all required Subtasks to succeed, no unresolved
dependency or operation, and a Task-Contract Completion Check, with no more than
three repair cycles before intervention.

#### NR-TASK-012
Task, Subtask, Assignment Attempt, lease, operation, compatibility, migration,
and recovery behavior MUST implement every canonical state classification,
transition row, guard, atomic effect, event identity, rejection reason, and
terminal-state prohibition in the normative Lifecycle annex.

## 7. Chat lifecycle

A Chat Session has one identity, one linear history, and one fixed Agent.
Empty sessions are drafts until first Send. Requested model may change between
Response Attempts. The submitted turn commits before external work. Retry
creates a new immutable attempt on the same turn.

Interruption never auto-resumes model or Tool activity. Completed records and
partial output remain visible; unfinished prose is excluded from retry context
by default. Editing or continuing earlier history creates a Conversation Fork.
Trash is recoverable and never cascades. Permanent deletion removes only the
named Session's private records and warns about retained forks, repository
effects, and promoted Memory.

Context uses raw recent history, the latest versioned Conversation Summary,
Session Ledger, and pinned context. Summary generation occurs only during
user-initiated Send preparation or explicit action. Ledger entries preserve
provenance and may be active, superseded, or disputed.

Multiple sessions may run attempts concurrently, one attempt per Session.
Repository-mutating Chat calls serialize globally. While a Task holds the write
lock, Chat stays interactive with read-only Tools; denied mutations are not
queued for later.

Response Attempt states are `preparing`, `running`, `waiting-for-approval`,
`succeeded`, `blocked`, `failed`, `cancelled`, and `interrupted`. Terminal retry
always creates a new Attempt for the same durable turn; no Attempt resumes.
Unknown Tool outcomes belong to the Durable Operation, never to a Response
Attempt state. The exact Response Attempt transitions and correlated operation,
approval, capacity, and recovery facts are fixed by the Lifecycle annex.

#### NR-CHAT-001
A durable Chat Session MUST have one fixed Agent, linear immutable history, and
per-attempt requested and effective model provenance.

#### NR-CHAT-002
The Runtime MUST commit a submitted turn before external work and MUST create a
new immutable Response Attempt for every retry.

#### NR-CHAT-003
Interrupted or cancelled attempts MUST preserve completed Tool records,
repository effects, partial visible output, and uncertain outcomes without
automatic continuation or rollback.

#### NR-CHAT-004
Earlier-point continuation and native handoff MUST create non-cascading
Conversation Forks rather than mutate established history.

#### NR-CHAT-005
Trash and permanent deletion MUST follow the recoverability, confirmation,
non-cascade, retained-effect, and privacy-redaction rules above.

#### NR-CHAT-006
Conversation Summary generation and regeneration MUST be versioned, visible,
provenance-preserving, and limited to user-initiated preparation or action.

#### NR-CHAT-007
Session Ledger updates MUST preserve provenance, status, user-correction
authority, and the successful-attempt boundary for inferred entries.

#### NR-CHAT-008
Chat concurrency and mutation MUST obey one active attempt per Session, global
write serialization, and invocation-time Repository Write Lock enforcement.

#### NR-CHAT-009
Every Response Attempt transition MUST implement the exact state, guard, atomic
effect, event, capacity, approval, interruption, and retry contract in the
normative Lifecycle annex, including the absence of automatic continuation and
of an `outcome-unknown` Response state.

## 8. Execution authority and repository safety

Repository-confined Tools accept repository-relative paths, reject absolute,
drive-relative, UNC, device, and parent-traversal paths, canonicalize existing
targets, validate move source and destination, and do not create links. Linked
Root authority binds repository link path and canonical target; retargeting
invalidates it.

All commands and opaque-effect Tools are Ambient. Chat uses one-time, session,
or bounded Auto authority. Task authority is fixed at admission and execution
never prompts to broaden it. Arbitrary shell is a separate affirmative grant.
Task external capability is a single admission-time Allow or Deny decision over
the already trusted eligible resources. New or changed resources remain out of
scope.

Structured Git observation is available. Local stage/commit requires Local
Commit Authority. Branch switching, stash, history rewrite, destructive cleanup,
remote mutation, push, and publish are prohibited. Safe Git cannot invoke hooks,
signers, credential helpers, or external diff drivers.

Every Tool request, including denial, creates an immutable sanitized Tool Audit
Record. Unknown effects append reconciliation evidence.

#### NR-AUTH-001
Repository-confined Tools MUST enforce canonical path containment for every
source and destination and MUST reject traversal, unapproved links, and link
creation.

#### NR-AUTH-002
Ambient authority MUST be explicitly bounded by Chat Session or confirmed Task
Contract and MUST never become global or permanent.

#### NR-AUTH-003
Task execution MUST NOT interrupt for broader authority; uncovered capability
MUST be unavailable or block/fail according to lifecycle policy.

#### NR-AUTH-004
Command Family, Arbitrary Shell, external capability, MCP trust, and Extension
Tool authority MUST remain separate fingerprint-bound decisions.

#### NR-AUTH-005
Git operations MUST enforce the observation, Local Commit Authority, prohibited
operation, and no-implicit-helper contract above.

#### NR-AUTH-006
Secret-Minimized Execution MUST keep secret values out of model context, Tool
schemas, inherited environments, audit, diagnostics, and errors.

#### NR-AUTH-007
Every requested Tool invocation MUST create an immutable Tool Audit Record with
context, snapshot, Operation Key, sanitized inputs, authority, timing, outcome,
affected path tokens/endpoints, and result reference.

## 9. Memory

Memory files are direct Markdown files in
`.github/memories/{project,personal}/`. Identity is `(scope,id)` and filenames
are lowercase kebab-case. Required frontmatter is `id`, `title`, `description`,
`tags`, `created-at`, and `updated-at`. Files are at most 4,000 Unicode
characters; there are at most 50 active Memories; title is at most 80
characters, description 160, and tags eight.

Personal Memory is disabled if its directory is not effectively ignored or any
file is tracked. The Runtime offers an explicit ignore action but does not edit
Git silently.

Only the Memory Manager proposes and only the Runtime commits changes. A
proposal includes exact final content, scope, operation, provenance, warnings,
and diff. Confirmation binds its hash. Drift requires a refreshed proposal.
Conflicts are proactive, neither scope has blanket priority, and conflicted
guidance is excluded until resolved. Retrieval is hybrid relevance with exact
identity first and freshness only as a tiebreaker. Consolidation is same-scope
and explicitly confirmed.

#### NR-MEM-001
Memory discovery and validation MUST enforce canonical locations, identity,
frontmatter, timestamps, content, size, field, and 50-entry limits.

#### NR-MEM-002
Personal Memory MUST remain disabled while its directory is not effectively
Git-ignored or contains tracked files.

#### NR-MEM-003
Memory MUST NOT change automatically; only an exact confirmed Memory Change
Proposal may be committed by the Runtime through the protected Memory Manager
workflow.

#### NR-MEM-004
Memory claims MUST retain private versioned provenance and MUST be revalidated
for staleness, conflict, source drift, target drift, and confirmation-hash drift
before commit.

#### NR-MEM-005
Memory Conflict handling MUST preserve both sources, exclude disputed guidance,
avoid blanket scope precedence, and require an explicit resolution proposal.

#### NR-MEM-006
Memory retrieval MUST filter invalid/conflicted entries, rank exact identity
first then hybrid relevance, preserve scope labels, and record retrieved
versions in the Resource Snapshot.

#### NR-MEM-007
Consolidation MUST be same-scope, capacity-safe, provenance-preserving, and
explicitly confirmed without automatic deletion.

#### NR-MEM-008
Memory writes MUST obey the Repository Write Lock and recover through durable
intent, Operation Key, reconciliation, and no blind replay.

## 10. Workbench, accessibility, and attention

The full-editor Workbench has Tasks, Chats, Activity, Agents, Memory, and
Settings. Tasks is the operational home. The sidebar has exactly one product
action, **Open Workbench in Editor**, plus passive Task status.

The Webview uses document semantics, one main region, a skip link, native
controls, composite list navigation, linear Task sections, and a navigable Chat
transcript. It never uses `role="application"`. Background work never moves
focus. Focus restoration, Command Palette commands, reduced motion, text status,
high contrast, and 200% zoom are mandatory.

One polite live region announces meaningful, deduplicated state changes, never
streaming or routine activity. Attention Requests are durable, versioned,
non-focus-stealing, badge-counted until resolved, and notified at most once per
version. Important notifications are suppressed when the focused Workbench
already shows the Notice and coalesced per Task within 30 seconds.

#### NR-UI-001
The sidebar and full-editor Workbench MUST implement the six-area information
architecture and single-action launcher contract.

#### NR-UI-002
The Webview MUST meet WCAG 2.2 AA with native document semantics, keyboard-only
core flows, visible focus, composite navigation, and no focus traps.

#### NR-UI-003
The Webview MUST honor reduced motion, high contrast, theme tokens, 200% zoom,
non-color state labels, and accessible text alternatives.

#### NR-UI-004
Announcements MUST use one polite, coalesced live region and MUST exclude
streaming, routine activity, timers, and duplicate state updates.

#### NR-UI-005
Destructive actions, Task cancellation, permanent deletion, reset, authority,
and Memory confirmations MUST use the settled proportional confirmation rules.

#### NR-UI-006
Attention Requests, badge counts, Workbench Notices, and VS Code notifications
MUST follow the settled event matrix, visibility suppression, version
deduplication, restart behavior, and 30-second Task coalescing rule.

## 11. Persistence, migration, and recovery

One operational SQLite database lives under workspace-specific
`ExtensionContext.storageUri`. It is authoritative for Tasks, Chats, attempts,
dependencies, graph revisions, checkpoints, approvals, operations, audit,
private Memory provenance, migrations, and recovery metadata. Large private
artifacts are referenced. Accepted commands atomically commit state plus durable
event/audit. `workspaceState` stores only small UI metadata and SecretStorage
stores credentials.

The version-1 logical model is a normalized 59-table current-state store with
append-only history, not a pure event-sourced store. `domain_events` is the
ordered durable fact stream; each owning aggregate table is authoritative for
current state. The normative
[logical SQLite contract](manifests/sqlite-contract.v1.json) enumerates every
table, column, key, check, trigger obligation, typed artifact reference, index,
retention rule, recovery action, and command transaction class.

All 60 Protocol commands are classified exactly once. Ordinary accepted
state-changing commands use `BEGIN IMMEDIATE` and atomically record protocol
idempotency, current state, aggregate version, ordered Domain Event, required
audit/attention facts, and the replayable result. Effectful commands use
intent-before-effect: transaction A commits immutable intent, Operation Key,
authority, and initial audit; no SQL transaction spans the external effect;
transaction B commits known outcome or reconciliation/barrier state with audit,
caller state/checkpoint, and events.

Durable Operation states are `intent-recorded`, `executing`, `retry-wait`,
`reconciling`, `outcome-unknown`, `succeeded`, `failed`, and `cancelled`.
Workspace Compatibility Gate states are `checking`, `migration-required`,
`migrating`, `recovery-required`, `newer-schema-refused`, and `compatible`.
Migration Attempt states are `preparing`, `backing-up`, `applying`, `verifying`,
`reopening`, `succeeded`, `failed`, and `interrupted`. Their exact transitions
and event identities remain owned by the Lifecycle annex.

The SQLite adapter owns one writer and bounded read-only connections, enables
foreign keys, disables trusted schema, uses WAL and `synchronous=FULL`, applies
a five-second busy timeout, and permits bounded pre-handoff retries only.
Ordinary activation runs `quick_check` and `foreign_key_check`; migration,
restore, and suspected corruption run full integrity and foreign-key checks.

SQLite contains only bounded metadata. Prompts, model output, diffs, file
bodies, potentially content-bearing Tool payloads, checkpoint bodies, Memory
replacement bytes, and support/migration evidence use immutable private
Artifacts identified by opaque ID, adapter-generated relative key, SHA-256,
length, type, and classification. Artifact writes are fsynced, verified, and
atomically renamed before a typed database reference commits. Cleanup deletes
only expired files absent from the complete typed-reference union.

Trash is visibility, not deletion. Authoritative Task/Chat history survives
Trash. A Chat cannot be permanently deleted while an Attempt is active, an
operation is reconciling or outcome-unknown, evidence is pinned, or a surviving
fork still references shared history. Forks survive source Trash and deletion
only after shared history is materialized or their reference disappears.

Schema evolution is forward-only. Activation completes compatibility and
migration before writable services. One restorable pre-upgrade backup is made
before an ordered transactional chain. Integrity and restart reopening precede
backup replacement. Older code refuses writes to newer schema. Failed migration
preserves live database and backup; retry, restore, or fresh database requires
explicit action.

#### NR-DB-001
The extension MUST keep one workspace-specific SQLite authority store and MUST
keep repository resources, UI metadata, credentials, and large artifacts in
their specified separate stores.

#### NR-DB-002
Every accepted state-changing command MUST transactionally persist current
state and its corresponding durable event or audit record.

#### NR-DB-003
External effects MUST commit durable intent and Operation Key before handoff and
observed result plus checkpoint after return.

#### NR-DB-004
Activation MUST gate writable services on schema compatibility, migration,
integrity, and recovery.

#### NR-DB-005
Migration MUST be direct-from-any-prior, forward-only, transactional,
backup-protected, integrity-checked, and explicitly recovered on failure.

#### NR-DB-006
Older code encountering a newer schema MUST refuse writes and offer only the
settled compatible-code or explicit-backup-restore paths.

#### NR-DB-007
The generated version-1 SQLite schema MUST match every table, column, key,
check, trigger obligation, index, lifecycle, and retention rule in the
normative logical SQLite contract under live-schema introspection.

#### NR-DB-008
Every version-1 Protocol command and recovery action MUST use exactly its
declared transaction class, atomically pair accepted current-state changes with
their event/audit facts, and place every uncertain external effect behind
Durable Operation reconciliation.

#### NR-DB-009
SQLite MUST contain no credential value, raw secret, absolute host path, or
unbounded content-bearing payload; private Artifacts MUST satisfy typed
reference, containment, checksum, crash, retention, and orphan-cleanup rules.

## 12. Diagnostics and support

Diagnostics are local, structured, metadata-first, sanitized, and non-telemetric.
Authoritative records remain authoritative; append-only Diagnostic Events
explain them; Health Snapshot is derived; Activity, Output, and bundles are
projections.

Health checks are stable-ID, read-only, and side-effect-free with
`healthy|degraded|blocked|unknown`, impact, evidence, and next action. Operational
Incidents record stable code, severity, action requirement, causal references,
before/after state, outcome knowledge, retry state, safe exception, fingerprint,
and redaction account.

Ordinary diagnostics retain 30 days or 50 MiB, whichever comes first. Pinned
blocker evidence remains until resolution plus 30 days. Support Bundles are
user-created ZIPs, preview content-bearing additions exactly, tokenize host and
repository identity, contain a checksum and redaction report, and are never
stored in the repository, retained, uploaded, or sent automatically.

#### NR-DIAG-001
Diagnostic Events, Health Snapshots, Activity, Output, and Support Bundles MUST
remain sanitized projections and MUST NOT become an alternate authority store.

#### NR-DIAG-002
Health checks MUST implement the fixed categories, stable states, evidence,
impact, next action, and side-effect-free behavior.

#### NR-DIAG-003
Unexpected failures and recovery blockers MUST create or update one durable
Operational Incident with the settled causal and sanitized evidence.

#### NR-DIAG-004
Diagnostic retention and clearing MUST enforce 30-day/50-MiB ordinary limits and
resolution-plus-30-day pinning without deleting authoritative records.

#### NR-DIAG-005
Support Bundle creation MUST be local, user-initiated, previewed,
identity-tokenized, checksummed, redaction-reported, and never automatically
retained or transmitted.

#### NR-DIAG-006
Diagnostics MUST link to guarded recovery workflows but MUST NOT mutate
operational state, retry Tools, edit audit, weaken redaction, or broaden
authority.

## 13. Packaging and release

Each SemVer release, beginning `0.1.0`, has one `v<version>` source tag and two
target-specific internal VSIXs from the same commit. Each contains bundled host
and Webview assets, metadata/notices, and matching native SQLite runtime.
GitHub Releases are canonical; binaries do not enter Git.

Activation is use-triggered by command/view or Webview restoration, never `*`
or `onStartupFinished`. Protocol and schema versions are independent monotonic
integers. Protocol compatibility is only within one release; mismatched
Webviews are rejected without side effects and reload.

#### NR-PKG-001
Every release MUST produce exactly `win32-x64` and `darwin-arm64` VSIXs from one
tagged commit and publish both atomically to one GitHub Release.

#### NR-PKG-002
The packages MUST use lazy activation and MUST include only the declared
production host, Webview, metadata, notices, and target SQLite assets.

#### NR-PKG-003
Extension, schema, and protocol versions MUST follow the settled independent
versioning and same-release protocol compatibility rules.

#### NR-PKG-004
The release gate MUST block unless both targets pass the complete packaged
matrix, content allowlist, SBOM/license, secret/path/source scans, SHA-256,
vulnerability, migration, recovery, accessibility, and deterministic model
checks.

## 14. Verification contract

The machine-readable verification projection is
`docs/manifests/verification.json`. Every mandatory check declares layer,
requirements, Threat Cases, targets/profiles, setup, fixture, stimulus, oracle,
prohibited outcomes, failure/cleanup behavior, and evidence.

Verification is layered across unit/invariant, port contract, integration,
headless scenario, Webview, packaged VS Code, accessibility, recovery,
adversarial security, migration, and supply chain. All use synthetic fixtures.
The deterministic model provider registers through real stable `vscode.lm` in
an Extension Development Host and is excluded from production packages.

Requirement and check coverage is 100%. Critical Verification Kernel state and
guard branches are completely exercised and mutation-tested with no unexplained
behavior-changing survivor. Every declared Durability Boundary gets fault
injection; every Threat Case control gets a negative check. A Conclusive Run has
no failure, skip, quarantine, flaky-only pass, missing evidence, unsupported
not-applicable, or inconclusive outcome.

#### NR-VER-001
Every Normative Requirement MUST link bidirectionally to an owning component,
invariant, mandatory Verification Check, and required evidence.

#### NR-VER-002
Every mandatory Verification Check MUST declare all fields prescribed in
WF-018 and MUST resolve to `pass` with evidence for a Conclusive Run.

#### NR-VER-003
Every Durability Boundary MUST have deterministic fault injection and every
Threat Case control MUST have adversarial negative verification.

#### NR-VER-004
The fourteen Acceptance Scenarios MUST run through the headless profile and the
packaged subset MUST run on both Supported Targets.

#### NR-VER-005
Critical Verification Kernels MUST have complete state/guard branch exercise
and mutation testing with no unexplained behavior-changing survivor.

#### NR-VER-006
Every Verification Manifest and retained artifact MUST use synthetic fixtures
and pass secret, real-content, absolute-path, username, machine-identity, and
repository-identity sanitation.

## 15. Acceptance scenarios

The canonical scenario identities are `AS-01` through `AS-14` in
`docs/manifests/verification.json`. They cover, in order: resource isolation;
Chat lifecycle; Chat Tool authority and reconciliation; Task admission; Task
graph execution; Task queue/dependencies; pause/restart/reactivation; exhaustive
durability crashes; Chat under Task lock; blocked dependency and operation
conditions; Memory lifecycle; keyboard/attention; migration/downgrade recovery;
and Webview reconstruction.

These are grouped journeys, not substitutes for atomic requirement coverage.

## 16. Specification Acceptance Gate

The gate consists of:

1. structural validation of stable identities, bidirectional links, mandatory
   fields, references, boundary/control/scenario coverage, target/profile
   coverage, placeholders, contradictions, and unowned decisions;
2. semantic review for atomicity, ambiguity, consistency, observability, valid
   oracles, cross-feature agreement, and concealed design choices; and
3. one accountable human's acceptance of the exact revision after the
   unresolved-item count reaches zero.

`npm run validate:spec` performs the structural portion and writes no files. The
semantic result, complete blocker review, and accountable acceptance are
recorded in `docs/manifests/specification-gate.json`. Revision `mvp-spec/2`
passes with zero unresolved items and has a Specification Acceptance Record.

## 17. Specification blocker review

All six original blockers are resolved and retained in the gate manifest as an
auditable review history.

| Original blocker | Classification | Final disposition |
| --- | --- | --- |
| `GAP-001` Workbench Protocol catalog and schemas | Unresolved decision | Resolved by the closed Workbench Protocol decision and integrated as the normative Protocol annex plus `NR-ARC-007`. |
| `GAP-002` logical SQLite schema and transaction matrix | Unresolved decision | Resolved by the closed logical SQLite decision and integrated through the normative machine contract plus `NR-DB-007`–`009`. |
| `GAP-003` exhaustive lifecycle transition contracts | Unresolved decision | Resolved by the closed Lifecycle decision and integrated as the normative Lifecycle annex plus `NR-TASK-012` and `NR-CHAT-009`. |
| `GAP-004` complete Threat Cases | Mechanical spec defect | Fixed in `verification.json`; every control, residual risk, and negative check is explicit. |
| `GAP-005` enumerated Durability Boundaries | Mechanical spec defect | Fixed in `verification.json`; every logical commit and external handoff is registered. |
| `GAP-006` executable scenario fixtures and precise oracles | Mechanical spec defect | Fixed in `verification.json`; all fourteen journeys have deterministic setup, steps, oracles, prohibited outcomes, cleanup, and evidence. |

None is missing factual evidence or out-of-scope implementation work. The
relevant current platform facts were resolved by the research decisions, and
the specification contracts now choose every public, durable, recovery, and
verification behavior required before implementation planning. The unresolved
item count is zero.

## 18. Decision provenance and precedence

Normative content comes from the closed decisions WF-002 through WF-021 and the
vocabulary in `CONTEXT.md`. The exhaustive later contracts refine the earlier
behavior without reopening it:

1. WF-019 owns canonical lifecycle state, transition, guard, effect, rejection,
   lease, and recovery matrices.
2. WF-020 owns Protocol transport identities, envelopes, payloads, ordering,
   reconstruction, idempotency, and validation while preserving WF-019 event
   identities.
3. WF-021 owns logical persistence shape and transaction boundaries while
   preserving WF-019 lifecycle and WF-020 command/event identities.

The following are normative contract annexes:

- [Lifecycle transition contract](../.wayfinder/issues/WF-019-define-lifecycle-transition-contracts.md)
- [Workbench Protocol contract](../.wayfinder/issues/WF-020-lock-workbench-protocol-contract.md)
- [Logical SQLite decision](../.wayfinder/issues/WF-021-lock-sqlite-schema-transaction-map.md)
- [Machine-readable logical SQLite contract](manifests/sqlite-contract.v1.json)

Where WF-018's verification matrix differs from WF-014, WF-018 is the later
verification-specific refinement: release-blocking screen-reader evidence is
Narrator on Windows and VoiceOver on macOS; Linux/Orca is outside the Supported
Target gate.

No requirement comes from incidental prototype styling. Variant B fixes
information architecture only.
