---
id: WF-021
title: Lock the logical SQLite schema and transaction map
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
  - WF-016
  - WF-017
  - WF-018
  - WF-019
---

## Question

What exact logical SQLite schema, integrity constraints, query indexes, artifact
references, and application-command transaction boundaries persist the settled
MVP domain and recovery guarantees?

The resolution must:

- enumerate version-1 tables and columns for workspace metadata, Tasks,
  contracts and dependencies, Subtasks and graph revisions, Assignment and
  Response Attempts, Chat turns/forks/summaries/ledgers, Resource Snapshots,
  authority, operations/checkpoints, Tool audit, Memory provenance/proposals,
  attention, diagnostics/incidents, migrations, backups, and leases/locks;
- define primary, foreign, unique, check, and append-only constraints plus
  deletion, Trash, retention, and surviving-fork behavior;
- separate inline metadata from private large-artifact references and define
  artifact identity, checksum, lifecycle, and orphan cleanup;
- identify indexes required by recovery, scheduling, Activity/causal lookup,
  retention, unresolved attention, and operation reconciliation;
- map every state-changing application command and recovery action to its
  atomic state/event/audit writes using the lifecycle identities from WF-019;
- define transaction modes, busy handling, connection ownership, integrity
  checks, and crash behavior without changing the settled migration contract;
  and
- provide machine-verifiable schema and transaction metadata for contract,
  migration, recovery, and fault-injection checks.

## Acceptance criteria

- Every authoritative record named by the canonical specification has one
  storage owner and an explicit lifecycle.
- Database constraints reject impossible cross-record and lifecycle states
  wherever SQLite can enforce them deterministically.
- Every accepted state-changing command atomically pairs current-state changes
  with its durable event or audit record.
- Recovery, reconciliation, scheduling, retention, migration, and causal audit
  queries have explicit keys and indexes.
- No credential value, raw secret, or unbounded content-bearing payload is
  stored in SQLite.

## Resolution

### Schema authority and storage boundary

The recommended version-1 contract is accepted. Its exact machine-readable
table, column, constraint, index, command, recovery, artifact, and verification
metadata lives in
[the logical SQLite contract](../../docs/manifests/sqlite-contract.v1.json).
That manifest is normative alongside this resolution; generated DDL and
transaction tests must agree with it rather than maintaining an independent
handwritten schema.

One SQLite database per workspace is the authoritative operational store. It
uses normalized current-state rows plus immutable history; it is not a pure
event-sourced store. `domain_events` is the ordered durable fact stream used for
projection, causal audit, and replay checks, while the owning aggregate table is
the authoritative current state. An accepted aggregate transition increments
its version and appends its exact WF-019/WF-020 event in the same transaction.
Neither may commit alone.

The version-1 schema has 59 tables, grouped by one storage owner:

- workspace and protocol: `workspace`, `application_operations`;
- private content: `artifacts`;
- Tasks: `tasks`, `task_contracts`, `task_dependencies`,
  `dependency_requests`, `task_graph_revisions`, `subtasks`,
  `subtask_dependencies`, `task_blockers`, `task_amendments`,
  `repair_cycles`, `unsatisfiable_determinations`, and
  `assignment_attempts`;
- Chat: `chat_sessions`, `chat_turns`, `response_attempts`, `chat_outputs`,
  `chat_summaries`, `chat_ledger_entries`, and `chat_context_pins`;
- Resources and authority: `resource_snapshots`,
  `resource_snapshot_entries`, `authority_reviews`, `authority_grants`,
  `linked_roots`, and `mcp_trust`;
- durable execution: `durable_operations`,
  `operation_execution_attempts`, `operation_barriers`,
  `reconciliation_evidence`, `durable_checkpoints`,
  `tool_audit_records`, and `tool_audit_corrections`;
- Memory: `memory_proposals`, `memory_proposal_sources`,
  `memory_proposal_targets`, `memory_provenance`, and `memory_conflicts`;
- user action and support: `attention_requests`, `terminal_outcomes`,
  `diagnostic_events`, `diagnostic_pins`, and `operational_incidents`;
- lifecycle and concurrency: `domain_events`,
  `lifecycle_event_identities`, `rejection_records`, `active_task_slot`,
  `repository_write_lock`, `assignment_capacity_leases`,
  `chat_mutation_capacity`, `recovery_runs`, and `recovery_steps`; and
- compatibility: `workspace_compatibility_gate`, `migration_attempts`,
  `migration_steps`, `backups`, and `recovery_actions`.

Each authoritative record has exactly one owner in that list. Cross-feature
records reference an owner by immutable identity but cannot mutate it. Foreign
keys default to `RESTRICT`; there is no business-data cascade. Whole-workbench
reset is the only privileged bulk-destruction path.

### Relational integrity

Stable opaque text IDs are primary keys. Aggregate versions are positive
integers and advance by exactly one. Time is canonical UTC RFC3339, hashes are
lowercase SHA-256, booleans are checked integers, and every JSON field is
canonical bounded JSON validated against a named closed schema before SQL.

SQLite checks, partial unique indexes, and guarded triggers reject:

- unknown canonical lifecycle states and illegal WF-019 transitions;
- terminal timestamps that disagree with terminal state;
- self or cyclic Task and Subtask dependencies;
- graph supersession of a started or terminal Subtask;
- more than one queued ordinal, active Task, Repository Write Lock, active
  Response Attempt per Chat, or open deduplicated intervention;
- more than three selected/running Assignment Attempts or more than one
  Write-capable Assignment Attempt;
- a Repository Write Lock without the same Active Task Slot owner and a valid
  execution phase;
- Chat mutation capacity while the Task write lock exists;
- terminal Task success without its Completion Check and with any unresolved
  dependency, routing request, blocker, operation, or unknown outcome;
- terminal Task failure without an Unsatisfiable Determination;
- aggregate mutation without exactly one matching ordered Domain Transition
  Event in the transaction;
- lifecycle identity reuse with a different fingerprint; and
- update or deletion of append-only contracts, graph revisions, attempts,
  operation attempts/evidence, checkpoints, events, rejections, audit records,
  provenance, migration history, and completed protocol operations.

Where SQLite cannot express a polymorphic or external invariant as a declarative
foreign key, a closed adapter command and transaction trigger perform the guard;
the contract suite must fault the command if the guard and resulting rows
disagree.

### Artifact boundary

SQLite stores only identity, lifecycle, bounded summaries, hashes, counters,
timestamps, repository-relative path tokens, and sanitized closed metadata.
Prompts, model output, diffs, file bodies, potentially content-bearing Tool
inputs/results, checkpoint bodies, Memory replacement bytes, migration/support
evidence, and Support Bundles live as immutable private artifacts beneath
workspace storage.

An Artifact is identified by an opaque ID and adapter-generated private relative
key plus SHA-256, length, media type, classification, creation time, and
verification time. Artifact creation writes and fsyncs a temporary file,
verifies its hash and size, atomically renames it, and only then commits a typed
foreign-key reference. Reads re-check containment, size, and checksum. A crash
before the reference commit leaves only an orphan candidate.

Startup recovery, and then at most one daily pass, removes temporary files older
than 24 hours and immutable artifacts whose complete typed-reference union is
empty and whose retention time has elapsed. Referenced, pinned, or backup
artifacts are never candidates. Credentials and raw secrets stay in
SecretStorage or provider-owned flows; the database may contain only opaque
handles and non-revealing fingerprints.

### History, Trash, forks, and retention

Trash changes visibility, not authority. Task and Chat operational history,
approvals, checkpoints, operations, and Tool audit survive Trash. Permanent Chat
deletion requires terminal Attempts, no reconciling or outcome-unknown
operation, no pinned diagnostic evidence, and no surviving fork reference.

A fork is an independent Chat aggregate that references immutable source items
through its fork point and survives source Trash. Source permanent deletion is
`RESTRICT` until shared history is materialized into every surviving fork or
those forks are deleted. Summaries and Ledger corrections append replacements;
they never rewrite their source.

Ordinary Diagnostic Events expire after 30 days or when their workspace total
first exceeds 50 MiB, oldest unpinned evidence first. Evidence pinned by an open
incident, unknown operation, failed migration, or repository conflict survives
resolution for at least 30 additional days. Diagnostic cleanup never removes
authoritative Task, Chat, authority, operation, checkpoint, or audit records.

### Query keys

The 26 required indexes in the companion contract cover:

- Task queue and Subtask readiness scheduling;
- reverse dependency unblocking and DAG reconstruction;
- nonterminal Task, Assignment, Response, Durable Operation, Migration, and
  Recovery Step lookup;
- operation-parent, attempt, barrier-scope, and Memory provenance
  reconciliation;
- Chat item reconstruction and Activity ordering;
- aggregate, workspace-sequence, correlation, and causation event lookup;
- Tool audit lookup;
- unresolved Attention and Incident lookup;
- diagnostic retention and owner timelines; and
- artifact orphan cleanup.

Every listed index has a named recovery, scheduling, Activity/causal, retention,
attention, or reconciliation query. Schema verification must reject an
unexplained index or a required query without its index.

### Command transaction map

All 60 WF-020 commands occur exactly once in the companion `commandMap`.
Commands are assigned to six boundaries:

1. `stateEvent`: one `BEGIN IMMEDIATE` transaction validates compatibility,
   authority, lifecycle, and expected versions; records the completed protocol
   operation; changes owned current state; appends ordered event/audit facts;
   stores the replayable result; and commits.
2. `intentBeforeEffect`: transaction A commits the immutable Durable Operation
   intent, Operation Key, authority decision, and initial audit before any
   external handoff. Transaction B commits the observed known outcome or the
   reconciliation/barrier state, audit correction, caller state/checkpoint, and
   events. No SQLite transaction is held across the effect.
3. `externalPreparation`: proposal, preview, or interaction state commits;
   native UI, discovery, or health work runs outside SQL; returned metadata or
   failure commits in a fresh `stateEvent` transaction.
4. `readOnlyExternal`: source-opening commands cause no authoritative SQLite
   state or Domain Event.
5. `compatibilityExternal`: migration, restore, fresh-database creation, and
   compatibility recheck run while Runtime writes are disabled and return only
   to `checking`, never directly to `compatible`.
6. `destructiveReset`: the Runtime closes, records exact confirmation, moves the
   live database and artifact root to private recoverable Trash, creates and
   verifies a fresh store, and deletes old data only after reopen succeeds.

An exact repeated protocol Operation ID and fingerprint returns the stored
`application_operations` result without another state change, event, audit,
notification, or effect. A fingerprint collision rejects without mutation.

### Recovery and migration transactions

Activation records one Recovery Run and its deterministic ordered worklist
before changing affected aggregates. Each recovery step is a short
`BEGIN IMMEDIATE` transaction keyed by run, aggregate, and step. Exact committed
replay is a no-op. Operation classification commits the evidence, operation
state, barrier change, audit correction, Domain Event, and diagnostic fact
together. Checkpoint restoration commits either a valid continuation or an
explicit blocker; it never guesses.

The settled forward-only migration contract remains unchanged. A verified
pre-upgrade backup precedes one exclusive transaction containing the entire
ordered direct migration chain and target integrity verification. Migration
step identities and checksums are immutable. A failed uncommitted chain rolls
back. A reopen failure after verified commit preserves both migrated live data
and backup and enters explicit recovery. Backup restore and fresh creation are
filesystem replacement operations with separate durable recovery evidence, not
fictional cross-file SQL transactions.

### Connection, busy, and crash contract

The SQLite adapter owns one extension-host writer connection and a bounded pool
of read-only connections. Foreign keys are on, `trusted_schema` is off,
WAL journaling is used, and durability is `synchronous=FULL`. Queries read one
committed snapshot. Application writes use `BEGIN IMMEDIATE`; no model, Tool,
MCP, filesystem, native dialog, or notification work occurs while the
transaction is open.

The busy timeout is five seconds. Reads may retry with bounded jitter. A write
transaction may retry at most three times only before external handoff, then
returns `temporarily-unavailable`. No transaction or effect is blindly replayed
after an uncertain handoff.

Ordinary activation runs `quick_check` and `foreign_key_check`. Migration and
restore run full `integrity_check` and `foreign_key_check` before and after the
boundary. A failed integrity, schema, or lease invariant keeps the compatibility
gate non-writable and opens one deduplicated Operational Incident.

### Verification contract

Generation and migration tests must introspect the live database and compare
every table, column, key, check, trigger, and index with the companion contract.
They must also prove exact coverage of every WF-019 state/event and every
WF-020 state-changing command; enumerate the artifact reference union; and
reject unauthorized mutation of append-only history.

Fault injection occurs before and after every row write and commit, before and
during effect handoff, before and after outcome commit, and during every
recovery and migration step. The matrix includes busy/locked, disk full, short
artifact write, checksum mismatch, corrupt page, foreign-key/trigger rejection,
host termination, stale lease, and migration reopen failure. The only permitted
result is a wholly committed state/event/audit boundary or its total absence,
with every uncertain effect behind reconciliation.
