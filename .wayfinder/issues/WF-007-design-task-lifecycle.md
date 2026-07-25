---
id: WF-007
title: Define the durable autonomous-task lifecycle
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-003
  - WF-004
  - WF-006
---

## Question

What persistent state machine, dependency-graph model, queue discipline, retry and
idempotency rules, pause/stop semantics, completion criteria, recovery protocol,
and write-lock behavior allow one active main task to run its sequential or
parallel subtasks to completion after crashes or restarts? Include the
`waiting-for-routing` behavior established by Agent Selection: the Task retains
the single active-task slot, cancellation preserves completed repository edits,
and the lifecycle must decide whether the repository write lock remains held
while no Agent is running.

How does Task admission compare a newly submitted top-level Task with running and
queued Tasks, present suspected success dependencies for user confirmation or
denial, store one edge per prerequisite, detect later dependency changes or
cycles, and schedule the earliest ready Task when an earlier queued Task remains
blocked?

## Resolution

### Task contract and admission

Every admitted Task is governed by a versioned, user-confirmed Task Contract:
the Goal, explicit testable success criteria, scope and safety constraints,
initial Agent or model preferences, and confirmed top-level Task Dependencies.
The Orchestrator may derive missing criteria and propose dependencies, but the
user confirms the complete contract before the Task enters the queue.

Admission compares the proposed contract with running and queued Task Contracts
and their expected artifacts. It proposes a Task Dependency only when the new
Task's success requires a named artifact or repository state that another Task
is expected to produce. Shared files, possible conflicts, related subject matter,
and preferred execution order do not qualify. Each proposed edge carries its
rationale and is confirmed or denied independently. A denial is retained with
the evidence that prompted it and is not proposed again without materially new
evidence.

A queued Task may be edited by returning it to `admitting`, rerunning dependency
analysis, and creating a new contract version. An active Task may be amended
only after it reaches `paused`; the amendment preserves completed history,
supersedes incompatible pending work, and triggers fresh planning and Repository
Reactivation. A materially different Goal requires cancellation and a new Task.

### Durable records and state layers

SQLite current state is authoritative. Task, Subtask, dependency, graph revision,
Assignment Attempt, operation, checkpoint, and effective-resource records are
updated transactionally with an append-only audit event. Large artifacts are
stored beneath extension storage and referenced from SQLite. This is not a fully
event-sourced design: recovery reads authoritative current records rather than
replaying the complete event log.

Before an external side effect, the Runtime commits its intent and stable
Operation Key. Afterward it commits the observed result and next Durable
Checkpoint. Model and tool history required for continuation is checkpointed
explicitly; partial streamed output is not a checkpoint.

Status is separated into three layers:

- Task: `admitting`, `queued`, `preparing`, `running`, `quiescing`, `paused`,
  `waiting-for-routing`, `waiting-for-dependency-confirmation`,
  `externally-blocked`, `verifying`, and terminal `succeeded`, `failed`, or
  `cancelled`.
- Subtask: `pending`, `ready`, `running`, `waiting-for-routing`, and terminal
  `succeeded`, `failed`, `superseded`, or `cancelled`.
- Assignment Attempt: `selected`, `running`, and terminal `succeeded`,
  `declined`, `failed`, `interrupted`, `outcome-unknown`, or `cancelled`.

Active Task Slot ownership is stored independently of Task status. A dependency
confirmation during admission owns no slot; the same wait discovered by an
active Task retains its slot.

### Graph evolution and scheduling

The Subtask graph is a directed acyclic graph with one edge meaning:
the prerequisite Subtask must succeed before the dependent becomes ready.
Scheduler restrictions are not encoded as fake dependencies. Conditional
branches, optional work, and repair paths are represented by later Task Graph
Revisions.

Within the Task Contract, the Orchestrator may autonomously append Subtasks and
edges or supersede pending Subtasks. Running and completed Subtasks remain
immutable history. Every revision is versioned, durable, and audited; a revision
that creates a cycle is rejected. New scope, success criteria, permissions, or
authority require user confirmation.

At most three Assignment Attempts may run concurrently. Only one may be
write-capable; up to three independent read-only or model-only Attempts may run.
A Subtask is write-capable whenever any of its allowed resources can mutate the
repository, regardless of whether its Agent predicts that it will write.
Provider throttling or resource limits may lower concurrency dynamically.

Top-level Tasks use stable submission order among ready work. When no Task owns
the Active Task Slot, the scheduler starts the earliest ready Task and skips
queued Tasks with unresolved dependencies or confirmations. The user may reorder
the queue, but order never overrides readiness. A failed or cancelled
prerequisite leaves dependents blocked until the user removes or replaces the
edge or cancels the dependent Task.

If later evidence suggests a new top-level dependency, a queued Task enters
`waiting-for-dependency-confirmation`. A running Task first quiesces at a safe
boundary, then waits. Each edge is again confirmed or denied with rationale. An
edge that would create a cycle is rejected and requires revising an existing
dependency.

### Repository lock and reactivation

The active Task holds the Repository Write Lock while executing, verifying, or
quiescing. It releases the lock in every Non-executing Task State, including
`paused`, `waiting-for-routing`, `waiting-for-dependency-confirmation`,
`externally-blocked`, and interrupted/recovering conditions. Releasing the lock
does not release the Active Task Slot, so a queued Task cannot start merely
because the active Task is waiting. Chat may regain repository mutation while
the lock is released.

Before leaving any Non-executing Task State, the Runtime performs Repository
Reactivation: reread the repository from disk, compare it with the last durable
baseline, and never trust earlier in-memory context. Unrelated Repository Drift
refreshes affected Agent context automatically. Drift that invalidates
assumptions but does not conflict creates a Task Graph Revision for affected
unfinished work. Overlapping, graph-invalidating, or unclassifiable drift places
the Task in externally blocked `repository-conflict` until the user reconciles
it.

Parallel mutating Subtasks, file-level leases, and worktree isolation are not
part of the MVP.

### Pause, stop, retry, and idempotency

Pause and stop both use Task Quiescence: stop admitting new work, request
cancellation of active model and tool calls, allow non-cancellable operations to
settle, commit their outcomes, checkpoint, and release the Repository Write
Lock. Pause then enters resumable `paused`; stop enters terminal `cancelled`.
Neither rolls back completed repository edits.

A force-stop may abandon the wait for settlement, but every uncertain in-flight
operation becomes `outcome-unknown`. Related work cannot continue until
Operation Reconciliation proves that the mutation was applied, was not applied,
or remains unknown.

Read-only and explicitly idempotent operations may retry with the same Operation
Key. A model call may restart from the last Durable Checkpoint; partial stream
output is discarded. A mutation may retry only when reconciliation proves it
was not applied. Mutations with unknown outcomes are never replayed blindly.
Transient operations receive at most three attempts with backoff. Provider
pressure first lowers concurrency; exhaustion then blocks or fails according to
the error classification. Operational retry does not count as routing evidence.

An Assignment Attempt pins an immutable Resource Snapshot covering its Agent
definition, model, Skills, Tools, MCP configuration, and relevant Memories.
Nothing hot-swaps during an Attempt. A new Attempt after interruption, reroute,
repair, or new scheduling uses the latest validated snapshot and records it in
the audit history. Missing or incompatible required resources block or reroute;
the Runtime never silently substitutes them.

### Crash recovery, blocking, failure, and completion

On extension activation, Task Recovery transactionally marks formerly running
Attempts `interrupted`, reconciles in-flight operations, restores the last
Durable Checkpoint, performs Repository Reactivation, and revalidates model,
Tool, MCP, trust, authorization, dependency, and routing availability. It
resumes automatically when safe. A user-paused Task remains paused, and terminal
Tasks never resume.

`externally-blocked` is nonterminal and means a concrete outside action or
condition could permit continuation: consent, authentication, trust, quota,
network, required resources, repository conflict, runtime/storage repair, or an
unknown operation outcome. Agent Capability Gaps use
`waiting-for-routing`. Terminal `failed` is reserved for required work that
deterministically cannot satisfy the Task Contract after allowed retries and
graph revisions, or for an exhausted Completion Check.

All required Subtasks must succeed and no dependency or operation outcome may
remain unresolved before verification. A final Completion Check then evaluates
the repository and durable Task record against the Task Contract's success
criteria. A concrete gap may append repair Subtasks and return the Task to
execution. Three unsuccessful repair cycles place the Task in
`externally-blocked` for user intervention rather than looping indefinitely;
the Task becomes `failed` only when the resulting decision establishes that its
contract cannot be met. Ordinary successful completion needs no further user
approval.
