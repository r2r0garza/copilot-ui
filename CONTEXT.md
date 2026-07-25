# Agent Workbench

The language of the local-first VS Code workbench for interactive agents and
durable autonomous tasks within one repository.

## Language

**Repository Agent**:
An Agent defined by the current repository for its own work.
_Avoid_: Custom agent, user agent

**Bundled Agent**:
An internal Agent supplied by the workbench.
_Avoid_: Built-in agent, system agent

**Orchestrator**:
The Agent that delegates work among other Agents; it is the only Bundled Agent
that a Repository Agent may replace.
_Avoid_: Router, coordinator

**Agent Identity**:
The stable, canonical identity of an Agent, derived from its definition filename.
_Avoid_: Agent name, display name

**Agent Name**:
The optional, human-facing display label of an Agent.
_Avoid_: Agent title, identity

**Agent Eligibility**:
The hard runtime determination that an Agent is permitted and currently able to
receive a particular subtask.
_Avoid_: Agent score, Agent suitability

**Agent Capability Gap**:
The condition in which no eligible Agent is sufficiently suitable for a
particular subtask. It prompts an Agent Creator proposal rather than an
unsuitable automatic assignment.
_Avoid_: Routing failure, missing capability

**Assignment Attempt**:
One durable assignment of a subtask to an Agent, including its routing rationale
and outcome. Rerouting creates a new attempt without erasing prior attempts.
_Avoid_: Subtask, current assignment

**Selected Assignment Attempt**:
An Assignment Attempt whose Agent, rationale, and immutable Resource Snapshot
have been committed and whose scheduler capacity is reserved before provider
launch. It consumes one of the three Assignment Attempt slots and, when
Write-capable, the single write-capable slot. Provider acceptance moves it to
`running`; pre-launch failure or cancellation releases every reservation.
_Avoid_: Agent candidate, Running Assignment Attempt, queued Subtask

**Interrupted Assignment Attempt**:
A terminal Assignment Attempt ended by extension-host interruption. It preserves
all completed records, releases scheduler capacity, and is never resumed or
retried in place. Any uncertain Tool effects remain separately represented by
their durable operation outcomes.
_Avoid_: Unknown Assignment Outcome, failed Assignment Attempt, Task Recovery

**Unknown Assignment Outcome**:
A terminal Assignment Attempt whose delegated Agent completion cannot be
classified after a force-stop or live control-channel failure. It releases
scheduler capacity but cannot be retried in place; later work requires any
necessary reconciliation and a new Assignment Attempt. Extension-host loss
instead produces an Interrupted Assignment Attempt.
_Avoid_: Unknown Operation Outcome, interrupted Assignment Attempt

**Assignment Completion Claim**:
An Agent's structured proposal that its Assignment Attempt is complete,
including outcome, artifact references, and checkpoint data. It cannot commit
state. The Runtime validates known operation outcomes, required durable records,
authority, and checkpoint invariants before marking the Attempt `succeeded`;
the Orchestrator may then propose Subtask acceptance, which the Runtime validates
against the current Task graph before committing Subtask `succeeded`.
_Avoid_: successful Subtask, Completion Check, model stop reason

**Capability Decline**:
An Agent's structured conclusion that an assigned subtask is outside its
capabilities, including the unmet requirements returned to the Orchestrator for
one rerouting evaluation.
_Avoid_: Task failure, cancellation

**Agent Selection**:
The Orchestrator's semantic choice of the most suitable eligible Agent for a
particular subtask, based on native Agent metadata and instructions.
_Avoid_: Agent eligibility, capability scoring

**Routing Intervention**:
A persisted request for the user to approve a proposed Repository Agent or
override Agent Selection for a blocked subtask.
_Avoid_: Routing failure, Agent approval

**Routing Mismatch**:
A user override that assigns a subtask to an eligible Agent despite the
Orchestrator preferring another Agent or finding none suitable. Three similar
mismatches for one Agent trigger a user-approved Agent-definition update
proposal, then reset the evidence cycle whether accepted or rejected.
_Avoid_: Memory, permanent routing rule

**Agent Manifest**:
The declarative identity, discovery, and capability metadata of an Agent.
_Avoid_: Agent configuration, agent prompt

**Agent Instructions**:
The behavioral guidance an Agent follows when it runs.
_Avoid_: Agent manifest, agent metadata

**Resource Name**:
The stable, canonical identity by which an Agent refers to a Tool, Skill, or MCP
Server.
_Avoid_: Resource label, display name

**Resource Source**:
An approved location from which the Workbench discovers Agent Resources.
_Avoid_: Resource path, import folder

**Agent Skill**:
A reusable package of instructions and supporting resources that a user may
invoke directly or an Agent may load when relevant.
_Avoid_: Agent, tool, command

**Subagent**:
An Agent delegated a focused unit of work in an isolated context whose result
returns to the delegating Agent.
_Avoid_: Handoff, active agent

**Handoff**:
A user-driven Conversation Fork that starts a new Chat Session with a target
Agent and carries prior conversation context forward. The originating Chat
Session remains unchanged and resumable.
_Avoid_: Delegation, subagent

**Chat Session**:
One durable, repository-scoped conversation with a single linear history, one
fixed Agent, and one active point of continuation. Its requested model may
change between turns, while each completed turn retains its effective model.
_Avoid_: Copilot Chat session, conversation tree

**Conversation Fork**:
A new Chat Session created from an earlier point in another Chat Session, linked
to its origin while continuing independently.
_Avoid_: Branch, edited history

**Trashed Chat Session**:
A recoverably deleted Chat Session hidden from the normal session list.
Trashing an active Session first cancels its Response Attempt and completes only
after that Attempt is terminal. Trash retains all evidence needed by
reconciling or outcome-unknown operations. Permanent deletion is unavailable
while execution is active, operation outcomes remain unresolved, or diagnostics
retention pins the records; it never cascades to Conversation Forks or removes
repository effects or promoted Memories.
_Avoid_: Cancelled session, archived session

**Conversation Summary**:
A versioned compression of older Chat Session narrative used to fit future
model context. It may be created when a user-initiated Send needs compaction or
when the user explicitly requests it. Each new version compacts the prior active
summary, subsequent conversation, and relevant Session Ledger corrections; only
the latest version enters future model context. It never replaces or rewrites
raw history or earlier summary versions.
_Avoid_: Session Ledger, transcript

**Session Ledger**:
A structured, session-local record of facts, decisions, constraints, artifact
references, and open questions gathered throughout a Chat Session. Entries keep
their provenance and may be superseded or disputed. Users may inspect and
correct entries, and explicit user corrections are authoritative. Ledger entries
are not automatically promoted to Memory.
_Avoid_: Conversation Summary, Memory, session case

**Memory Promotion**:
The explicit conversion of session-local knowledge into Project Memory or
Personal Memory by the Memory Manager. A “remember this” request initiates
promotion; ambiguous or mixed scope must be resolved explicitly with the user
before content is proposed.
_Avoid_: Session Ledger update, automatic memory

**Memory Promotion Suggestion**:
A visible invitation to begin Memory Promotion after a successful Response
Attempt or Task completes with durable, reusable knowledge. It is never derived
from partial, failed, disputed, stale, or unverified content and never promotes
anything without explicit user confirmation.
_Avoid_: Automatic memory, background extraction

**Memory Change Proposal**:
The exact create, update, consolidation, or removal the Memory Manager asks the
user to confirm, including its scope, final content, provenance, warnings, and
any before-and-after diff. Confirmation authorizes only that proposal; a
material revision requires a new proposal.
_Avoid_: Memory draft, general write approval

**Memory Provenance**:
The private, durable evidence linking one Memory version to authoritative user
statements, completed observations, validated ledger entries, or verified Task
results. Missing provenance does not invalidate a portable Memory file, but its
claims remain unverified until corroborated against current evidence.
_Avoid_: Memory content, citation frontmatter

**Memory Conflict**:
A detected contradiction between Personal and Project Memories that is surfaced
proactively and remains visible until the user resolves it. Conflicted guidance
is excluded from authoritative use, while unrelated work may continue.
_Avoid_: Personal override, Project override, retrieval warning

**Response Attempt**:
One recorded effort to answer a submitted user turn. Retry creates a new
Response Attempt; interruption preserves completed records but never resumes
model or Tool activity automatically. Its nonterminal states are `preparing`,
`running`, and user-action-required `waiting-for-approval`; its terminal states
are `succeeded`, `blocked`, `failed`, `cancelled`, and `interrupted`. A complete
response that reports an authorized limitation is successful. Unknown Tool
effects remain separate durable operations rather than an Attempt state, and no
terminal Response Attempt resumes.
_Avoid_: Chat Session, user turn

**Cancelled Response Attempt**:
A Response Attempt stopped by the user whose partial output, completed Tool
records, and completed repository changes remain visible. An uncertain mutation
must be reconciled before related writes continue.
_Avoid_: Deleted response, rolled-back response

**Blocked Response Attempt**:
A terminal Response Attempt rejected from `preparing` because an explicit guard
such as quota, authentication, trust, or required resource availability prevents
provider launch after the user turn was committed. It never resumes; retry
creates a new Response Attempt for the same turn.
_Avoid_: Failed Response Attempt, blocked Send control, Tool denial

**Failed Response Attempt**:
A terminal Response Attempt ended by a preparation malfunction or an
unrecovered model or Runtime error after provider execution began. Known
pre-launch guard rejection is blocked instead. It never resumes; retry creates a
new Response Attempt for the same turn.
_Avoid_: Blocked Response Attempt, Cancelled Response Attempt, Tool failure

**Response Approval Wait**:
The user-action-required `waiting-for-approval` state of one active Response
Attempt. It retains that Chat Session's single active-attempt position but owns
no repository-mutation reservation and cannot delay Task lock acquisition.
Approval authorizes revalidation rather than execution: Tool identity, inputs,
authority, repository baseline, and the current Repository Write Lock are
checked again before the Attempt may return to `running` and compete for global
Chat mutation serialization.
_Avoid_: Ambient Authority Grant, queued mutation, Task blocker

**Workbench Runtime**:
The extension-owned model, Tool, and orchestration loop that interprets Agent
definitions for Workbench Chat and Task execution. Agents control reasoning and
orchestration choices; the Runtime deterministically enforces safety,
durability, authority, and lifecycle invariants before executing effects or
committing transitions.
_Avoid_: Native Agent Runtime, Copilot Chat

**Workbench Webview**:
The fully interactive presentation client through which the user operates the
Workbench. It may retain ephemeral view state, but sends validated commands to
the extension host and renders state and events returned by the Workbench
Runtime; it never owns authoritative domain or durable execution state.
_Avoid_: Workbench Runtime, static UI, application backend

**Workbench Protocol**:
The versioned, validated command-and-event contract between the Workbench
Webview and the extension host. Reloading or replacing the Webview reconstructs
its authoritative view from extension-host state through this protocol.
_Avoid_: internal API, webview state, model protocol

**Attention Request**:
A non-focus-stealing Workbench signal that an event needs user awareness or
action. Only the user's response to it may open the Workbench or transfer focus.
_Avoid_: Alert, automatic focus, forced navigation

**Workbench Notice**:
A prominent in-editor presentation of an unresolved Attention Request or an
acknowledgeable Task outcome.
_Avoid_: VS Code notification, Activity record, dialog

**VS Code Notification**:
A native VS Code notification emitted for a configured important event that is
not already visible in the focused Workbench. Operating-system delivery is not
part of the Workbench contract.
_Avoid_: Desktop notification, Workbench Notice, Attention Request

**Attention Badge**:
The sidebar view's numeric count of unresolved Attention Requests. Viewing a
request does not remove it from the count.
_Avoid_: Unread count, activity count, completion badge

**Task**:
A top-level Goal submitted by the user for durable autonomous execution. Only
one Task may execute at a time, although other Tasks may be admitted and queued.
_Avoid_: Subtask, assignment

**Subtask**:
A unit of work within one Task's dependency graph that the Orchestrator assigns
to an Agent.
_Avoid_: Task, Goal

**Running Subtask**:
A Subtask whose execution has begun and remains unresolved. Its durable
`running` state spans failed, interrupted, or replacement Assignment Attempts
and does not imply that a model or Tool call is currently active. It leaves
`running` only for `waiting-for-routing` or a terminal Subtask state; retry and
recovery never cycle it back through `ready`.
_Avoid_: active Assignment Attempt, ready Subtask, running Task

**Superseded Subtask**:
An unstarted Subtask made unnecessary or replaced by a valid Task Graph Revision.
Only `pending` or `ready` Subtasks may become terminal `superseded`; running and
completed Subtasks remain immutable execution history.
_Avoid_: Cancelled Subtask, edited Subtask, replacement Assignment Attempt

**Cancelled Subtask**:
An unfinished Subtask terminated by an explicit user request or cancellation of
its parent Task. Active Attempts and operations must first settle or record
Unknown Operation Outcomes. Cancellation never satisfies a Subtask Dependency;
required work needs a valid in-contract replacement path or contributes to an
Unsatisfiable Determination.
_Avoid_: Superseded Subtask, successful Subtask, Capability Decline

**Failed Subtask**:
A terminal Subtask whose own objective cannot be completed after its permitted
operational retries and Assignment Attempts. Its success-dependent children
remain blocked, but it does not directly fail the parent Task: an in-contract
Task Graph Revision may preserve it as immutable history while routing
unfinished work through replacement or compensating Subtasks. It contributes to
Task failure only when no valid route can satisfy the Task Contract.
_Avoid_: Failed Assignment Attempt, Failed Task, superseded Subtask

**Task Dependency**:
A user-confirmed requirement that one top-level Task complete successfully
before another may execute, represented as one directed relationship per
prerequisite Task. It is proposed only when the dependent Task's success requires
a named artifact or repository state the prerequisite is expected to produce;
shared files, possible conflicts, and preferred order are not dependencies.
After the dependent Task owns the Active Task Slot, a newly discovered
dependency may be confirmed in place only when its prerequisite has already
succeeded. An unfinished, failed, or cancelled prerequisite is unschedulable
while the active Task retains the slot; representing that dependency requires
cancelling the active Task and admitting a replacement Task Contract.
_Avoid_: Queue order, Subtask dependency

**Subtask Dependency**:
A directed relationship requiring one prerequisite Subtask to succeed before
another Subtask becomes ready. Scheduler constraints and conditional planning
are not dependencies; branching is expressed through a Task Graph Revision.
_Avoid_: Task Dependency, execution order

**Repository Write Lock**:
The Workbench Runtime's exclusive permission for a Task to mutate the current
repository while it is executing or quiescing. Acquisition waits for an active
Chat mutation to finish safely; while held, Chat remains available without
repository mutation. At invocation time, Chat disables Repository-confined
write Tools and every Ambient Tool that may mutate the repository or has opaque
effects, regardless of prior session approval or Chat Auto Mode. Proven
read-only or remote-only Tools may remain available. The lock is released
whenever the Task enters a Non-executing Task State.
_Avoid_: Active-task slot, filesystem lock

**Non-executing Task State**:
A durable state in which the active Task retains the single active-task slot but
is not running an Agent and does not hold the Repository Write Lock, including
paused, waiting-for-routing, externally blocked, and interrupted/recovering
states.
_Avoid_: Completed Task, queued Task, intermittent status

**Repository Reactivation**:
The mandatory rereading and revalidation of the repository before a Task leaves
a Non-executing Task State and resumes execution. Earlier in-memory repository
context is never trusted across reactivation. Unrelated Repository Drift
refreshes execution context automatically; assumption-changing drift replans
affected unfinished Subtasks; overlapping, graph-invalidating, or unclassifiable
drift places the Task in a repository-conflict state for user reconciliation.
_Avoid_: Process restart, retry

**Repository Drift**:
Any repository change observed during Repository Reactivation relative to the
Task's last durable repository baseline.
_Avoid_: Task output, merge conflict

**Task Quiescence**:
The safe transition out of Task execution: stop admitting new work, request
cancellation of active calls, allow non-cancellable operations to settle, record
their outcomes, and checkpoint before releasing the Repository Write Lock.
_Avoid_: Rollback, immediate termination

**Quiescence Disposition**:
The durable destination and cause carried while a Task is `quiescing`. Its
target is `paused`, `cancelled`, `waiting-for-routing`,
`waiting-for-dependency-confirmation`, `externally-blocked`, or `failed`, with
the initiator, Task Continuation, and linked routing, confirmation, blocker, or
Unsatisfiable Determination record. A stop request may override any nonterminal
target with `cancelled`; no event may downgrade cancellation. Force-stop is a
cancellation-only flag that permits unsettled operations to become Unknown
Operation Outcomes. Task Recovery preserves and completes the disposition
deterministically after interruption.
_Avoid_: Task state, cancellation reason, operation cancellation

**Paused Task**:
A resumable Task that has completed Task Quiescence and entered a Non-executing
Task State at the user's request.
_Avoid_: Cancelled Task, blocked Task

**Cancelled Task**:
A terminal Task that has completed Task Quiescence after the user requested
stop. Repository changes already completed by the Task are preserved.
_Avoid_: Paused Task, rolled-back Task

**Durable Operation**:
One logical model or Tool invocation whose validated intent, authority decision,
effect class, Operation Key, execution attempts, observed result, and current
state are persisted. Its nonterminal states are `intent-recorded`, `executing`,
`retry-wait`, `reconciling`, and recoverable or user-action-required
`outcome-unknown`; its terminal states are `succeeded`, `failed`, and
`cancelled`. An unknown operation may later be reconciled, but it is never
blindly replayed.
_Avoid_: Assignment Attempt, Response Attempt, Tool Audit Record

**Unknown Operation Outcome**:
The durable result of force-stopping or interruption when the Workbench cannot
prove whether an in-flight operation took effect. Related execution cannot
continue until the outcome is reconciled.
_Avoid_: Failed operation, cancelled operation

**Operation Barrier**:
The workspace safety restriction derived from an `outcome-unknown` Durable
Operation independently of its parent Task or Attempt. An unknown repository
mutation blocks every repository mutation because the MVP has no file leases or
worktree isolation, while read-only work may continue. An unknown External
Mutation blocks operations whose provider, target, or postcondition may overlap.
Reconciliation removes the barrier; releasing an Active Task Slot does not.
_Avoid_: Repository Write Lock, Task Blocker, Active Task Slot

**Operation Key**:
A durable identity for one immutable logical model or Tool intent, bound to its
parent Attempt, provider identity, canonical inputs, effect class, authority
scope, and target. Bounded execution retries, reconciliation, and provider
idempotency reuse the key; changed intent or a later Attempt creates a new key
even when the requested action looks similar.
_Avoid_: Assignment Attempt, Subtask identity

**Operation Reconciliation**:
The inspection that establishes whether an interrupted mutating operation was
applied, was not applied, or still has an Unknown Operation Outcome before the
Runtime may continue related work. For an External Mutation, reconciliation
reads provider state and uses the Operation Key or provider idempotency contract
before any replay; absent proof that replay is safe, the mutation is never
retried automatically. Proven application makes the Durable Operation
`succeeded` even when its parent Attempt is cancelled or interrupted. Proven
non-application enters `retry-wait` only when the parent workflow still permits
retry, otherwise `cancelled`; insufficient evidence returns to
`outcome-unknown`.
_Avoid_: Retry, rollback

**Completion Check**:
The final evaluation of the repository and Task record against the Task's
durable success criteria after every required Subtask has succeeded and no
unresolved or unknown outcome remains. A failed check may create repair
Subtasks; three unsuccessful repair cycles require user intervention.
_Avoid_: Last Subtask, user approval

**Repair Cycle**:
One bounded response to a concrete Completion Check gap: the Runtime commits
repair Subtasks, executes them, and performs another Completion Check. The
initial gap starts cycle one but does not count as a failed cycle; each
post-repair check that still finds a gap increments the failure count. The third
failed Repair Cycle places the Task in `externally-blocked` with reason
`repair-cycles-exhausted` rather than failing it automatically.
_Avoid_: operational retry, Task Graph Revision, Completion Check

**Repair Intervention**:
Material new evidence supplied after repair-cycle exhaustion that can permit the
same Task Contract to advance, such as a repository change, corrected
assumption, newly available eligible resource within existing authority, or
in-contract guidance. It requires Repository Reactivation and a new Task Graph
Revision, then resets the automatic repair-cycle count. An unchanged retry is
not a Repair Intervention; changes to scope, criteria, permission, or authority
instead require pausing and amending the Task Contract.
_Avoid_: retry button, operational retry, Task Contract amendment

**Write-capable Subtask**:
A Subtask whose allowed resources include any operation that can mutate the
repository, whether or not the Agent expects to use it. The MVP executes at most
one Write-capable Subtask at a time; independent read-only or model-only
Subtasks may execute concurrently within the scheduler limit.
_Avoid_: Currently writing Subtask, file lease

**Task Graph Revision**:
An append-only, durable version of a Task's execution plan. It may add Subtasks
and dependencies or supersede pending Subtasks within the submitted Task
contract; running and completed Subtasks remain immutable history. A revision
that creates a cycle or requires new scope, criteria, permission, or authority
cannot activate autonomously.
_Avoid_: Task retry, editing Subtask history

**Dependency Confirmation**:
The user decision that accepts or denies a suspected Task Dependency together
with its rationale. A Task awaiting that decision is non-executing; a previous
denial is raised again only when materially new evidence exists.
_Avoid_: Queue order, automatic dependency

**Dependency Confirmation Request**:
The durable pending decision behind `waiting-for-dependency-confirmation`. It
records the proposed prerequisite and rationale, Task Contract version, and
whether it arose during `admission` or while `active`. An active request also
stores its `preparing`, `running`, or `verifying` continuation state; it retains
the Active Task Slot, releases the Repository Write Lock after quiescence, and
requires Repository Reactivation before returning there. An admission request
owns neither lease and returns to `admitting`.
_Avoid_: Dependency Confirmation, Task Dependency, Attention Request

**Task Readiness**:
The determination that a queued Task has no unresolved Task Dependency or
Dependency Confirmation and may compete for the active-task slot. Queue order
selects the earliest ready Task but never makes a blocked Task ready. A
terminally failed prerequisite never satisfies its dependency; the dependent
Task remains not ready until its contract is readmitted with a removed or
successfully replaced prerequisite. Unrelated ready Tasks continue normally.
_Avoid_: Queue position, active Task

**Preparing Task**:
A ready Task undergoing its one-time initial activation after the scheduler
atomically grants it the Active Task Slot and Repository Write Lock. In
`preparing`, the Runtime validates the confirmed Task Contract and required
resources, establishes the initial repository baseline, and commits the initial
Task Graph Revision before entering `running`. Reactivation after pause or
blocking may continue an unfinished captured `preparing` phase, but no later
execution phase starts a second preparation or repeats committed preparation
work.
_Avoid_: Task admission, Repository Reactivation, Task Recovery

**Task Recovery**:
The automatic reconstruction of a nonterminal Task after extension-host
interruption. Recovery reconciles operations, restores the last committed
checkpoint, performs Repository Reactivation, and revalidates external
capabilities before execution may resume. Explicitly paused Tasks remain paused.
_Avoid_: Retry, Task Quiescence

**Recovering Task**:
An interrupted active Task in the durable `recovering` state while Task Recovery
reconciles uncertain operations, restores its last Durable Checkpoint, performs
Repository Reactivation, and revalidates dependencies, resources, trust, and
authority. Only interruption of `preparing`, `running`, `quiescing`,
`verifying`, or `recovering` enters this state; paused and blocked Tasks retain
their existing state across restart and use ordinary Repository Reactivation
when resuming. A Recovering Task retains the Active Task Slot, never holds the
Repository Write Lock, and cannot execute an Agent until recovery reaches a
deterministic disposition.
_Avoid_: Paused Task, retrying Task, migration recovery

**Task Continuation**:
The durable execution phase—`preparing`, `running`, or `verifying`—to which an
active Task may return after quiescence, pause, routing or dependency wait,
external blocking, or interruption recovery. It is captured before leaving the
phase and resumed only after required reconciliation and Repository
Reactivation. A valid graph change may replace `verifying` with `running` in
the same transaction that records the change.
_Avoid_: Task state, Durable Checkpoint, retry target

**Recovery Run**:
One durable, resumable activation-time recovery worklist identified before it
changes affected Tasks, Attempts, or operations. Each step has a Lifecycle Event
Identity derived from the Recovery Run, aggregate, and step, so another host
interruption resumes the same run and replays committed steps idempotently. The
run closes only when every affected aggregate reaches a safely resumed, blocked,
or terminal disposition; a later unrelated interruption creates a new run.
_Avoid_: Task Recovery, operational retry, Migration Attempt

**Active Task Slot**:
The single durable scheduler lease that permits one top-level Task and its
Subtasks to advance. Slot ownership is independent of Task status and is retained
by a paused or blocked active Task until it completes or is cancelled.
_Avoid_: Repository Write Lock, queue position

**Lease Integrity Violation**:
A persisted contradiction among Task state, Repository Write Lock ownership,
and Active Task Slot ownership, such as multiple slot owners, a lock owner that
does not own the slot, or a terminal/non-executing lock owner. Task Recovery may
transactionally release the valid lock of an interrupted executing Task while
retaining its slot; contradictory ownership instead places the Workspace
Compatibility Gate in `recovery-required` and prevents writable startup until
explicit repair and revalidation.
_Avoid_: stale in-memory lock, Task Blocker, normal Task Recovery

**Durable Checkpoint**:
The authoritative current execution state from which Task Recovery continues,
committed transactionally with its audit event. External side effects are
bracketed by durable intent and observed-result records rather than inferred
from model output.
_Avoid_: Event log, in-memory context

**Resource Snapshot**:
The immutable set of validated Agent, model, Skill, Tool, MCP, and Memory
resources pinned to one Assignment Attempt or Response Attempt. A new attempt
uses the latest valid snapshot; resources never hot-swap during a running
attempt.
_Avoid_: Resource registry, current repository configuration

**Externally Blocked Task**:
A nonterminal Task that cannot currently advance but has a concrete external
condition or user action that could permit continuation, such as restoring
authorization, trust, quota, network, resources, or resolving repository or
operation uncertainty.
_Avoid_: Failed Task, waiting-for-routing

**Task Blocker**:
The durable structured cause beneath an `externally-blocked` Task: a stable
reason code, sanitized evidence, required condition or user action, resume mode,
and last revalidation event. A `condition-driven` blocker may clear only after
an observed change and Repository Reactivation; a `user-action-required`
blocker cannot clear through polling alone. Task Blockers do not create separate
Task states.
_Avoid_: Task state, Agent Capability Gap, Dependency Confirmation

**Failed Task**:
A terminal Task whose required work deterministically cannot satisfy its durable
contract after allowed retries, graph revisions, and repair cycles are exhausted.
_Avoid_: Externally blocked Task, cancelled Task

**Unsatisfiable Determination**:
The durable, evidence-backed Runtime conclusion required before a Task may enter
terminal `failed`. Its stable reason identifies why the confirmed Task Contract
cannot be satisfied after the permitted retry, rerouting, graph-revision, and
recovery paths. It may incorporate user-supplied evidence but is never a direct
user-selected status. The determination is valid only when no operation remains
active or outcome-unknown; committing it releases the Repository Write Lock and
Active Task Slot and preserves append-only history.
_Avoid_: user cancellation, operational failure, external blocker

**Task Contract**:
The user-confirmed Goal, testable success criteria, scope and safety constraints,
initial Agent or model preferences, Task Dependencies, Ambient Authority Grants,
and external capability decision that govern one admitted Task. Task Graph
Revisions may change the route but cannot change this contract without new user
confirmation. Queued contracts may be revised through readmission; an active
contract may be amended only while paused. A materially different Goal requires
a new Task.
_Avoid_: Task graph, user prompt

**Active Task Amendment**:
The user-confirmed replacement of a paused active Task's contract version
without returning it to pre-slot `admitting`. Confirmation records rationale,
supersedes incompatible unstarted work through a Task Graph Revision, and sets
Task Continuation to `running`, but does not resume automatically; Repository
Reactivation still follows a separate resume event. A materially different Goal
is rejected as `new-task-required`.
_Avoid_: queued Task readmission, Task Graph Revision, automatic resume

**Native Agent Runtime**:
The Copilot-owned execution environment for VS Code Agents, which is separate
from the Workbench Runtime.
_Avoid_: Workbench Runtime, language model API

**Project Memory**:
Durable repository facts, conventions, architecture decisions, and
team-relevant workflows that are shared through Git.
_Avoid_: Personal memory, session history

**Personal Memory**:
Durable knowledge about the current user's preferences, habits, and
repository-specific working context that is never shared through Git.
_Avoid_: Project memory, global setting

**Memory Index**:
A compact catalog of available Personal and Project Memories that every Agent
receives before each turn or subtask.
_Avoid_: Memory contents, chat history

**Memory Retrieval**:
The scope-labeled, relevance-ranked selection of validated Memory content for a
specific turn or Subtask. Exact identity outranks hybrid lexical and semantic
relevance; freshness is only a tiebreaker, and every retrieved version is
recorded in the Resource Snapshot.
_Avoid_: Memory Index, automatic scope priority

**Memory Consolidation**:
A user-confirmed, same-scope replacement of duplicate or fragmented Memories by
one validated Memory while preserving supported meaning and provenance. It is
never automatic, cross-scope, or permitted to erase conflicted claims.
_Avoid_: Memory cleanup, automatic eviction

**Memory Manager**:
The protected Bundled Agent responsible for interpreting candidate knowledge
and preparing user-confirmed Memory Change Proposals. Only the Workbench Runtime
executes its proposals through the structured Memory Write Operation.
_Avoid_: Memory retrieval, memory reader, repository Memory Agent

**Memory Write Operation**:
The recoverable Runtime operation that revalidates one confirmed Memory Change
Proposal, records durable intent, and applies its exact file and provenance
changes under the Repository Write Lock. It specializes the Durable Operation
state set rather than defining another lifecycle. No operation exists while a
proposal waits for confirmation or lock release. Entry requires fresh proposal,
confirmation, source/target, privacy, schema, capacity, and repository-baseline
validation; success commits the resulting Memory version and refreshes the
registry. Uncertain outcomes reconcile actual file and provenance state against
the confirmed postcondition and are never replayed blindly.
_Avoid_: Agent file edit, queued Memory proposal

**Workbench Tool**:
A Tool implemented and controlled by the Workbench Runtime.
_Avoid_: Extension Tool, MCP Tool

**Repository-confined Tool**:
A Workbench Tool whose every filesystem effect is mediated by the Workbench
Runtime and canonically constrained to the current Repository Boundary. It may
execute unattended without an additional authority grant. Tool origin and
confinement are separate classifications: only a Workbench Tool can qualify,
and not every Workbench Tool does.
_Avoid_: Safe Tool, Repository Tool, approved Tool

**Repository Boundary**:
The fixed set of filesystem roots within which Repository-confined Tools may
operate: the canonical primary repository root plus any Approved Linked Roots
authorized for the current Chat Session or admitted Task. It does not constrain
Ambient Tools or processes at the operating-system level.
_Avoid_: Workspace folder, process sandbox, working directory

**Approved Linked Root**:
The canonical external target of a symlink or junction located beneath the
primary repository that the user explicitly adds to one Repository Boundary.
Authority is bound to both the repository-relative link path and its canonical
target; retargeting invalidates it. A Task's set is fixed at admission and newly
discovered targets are denied without interrupting execution.
_Avoid_: Symlink exception, workspace folder, external directory

**Ambient Tool**:
A Workbench Tool, Extension Tool, or MCP Tool whose possible effects cannot be
technically confined to the Repository Boundary by the Workbench Runtime,
including arbitrary command execution. It may run for a Task only within an
explicit Ambient Authority Grant in that Task's confirmed contract.
_Avoid_: Unsafe Tool, unrestricted Tool, external Tool

**Ambient Authority Grant**:
The user's informed preauthorization for a bounded set of Ambient Tools within
one explicit execution scope: a confirmed Task Contract or one Chat Session in
Chat Auto Mode. It records the tools' identities, possible effects, and reliance
on the VDI user's operating-system authority. Covered invocations may proceed
without per-invocation approval; authority outside the grant remains
unavailable. A grant ends with its Chat Session or terminal Task, never transfers
to a Conversation Fork or future Task, and never becomes an always-allow rule.
_Avoid_: Tool approval, workspace trust, blanket consent

**Authority Review**:
The mandatory admission or activation review that discloses the Repository
Boundary, Approved Linked Roots, Command Family Grants, Arbitrary Shell
Authority, external providers and effects, Tool providers, and material risks
before an Ambient Authority Grant is created. It records the exact accepted
review and requires the acknowledgement: “These operations run with your local
user permissions. Bridgit-UI cannot sandbox any tools or guarantee rollbacks.
You are authorizing their effects for this Task/Chat Session.” Deny is the
default, and Arbitrary Shell Authority requires a separate affirmative choice.
_Avoid_: Warning dialog, Tool confirmation, Workspace Trust

**Command Family Grant**:
Ambient authority for direct execution of one identified executable within a
bounded argument family and a working directory inside the Repository Boundary. Each
repository script remains ambient regardless of its friendly name, and one
approved command family never implies authority for other subcommands of the
same executable.
_Avoid_: Shell access, executable approval, command allowlist

**Arbitrary Shell Authority**:
A distinct, high-risk Ambient Authority Grant permitting unbounded command
composition through a shell such as PowerShell or `cmd.exe`. It is never implied
by Command Family Grants and requires an explicit warning that shell processes
retain the VDI user's ambient operating-system authority.
_Avoid_: Command Family Grant, terminal access

**Local Commit Authority**:
A narrow Task Contract grant permitting structured staging and creation of
local commits required by that Task's confirmed outcome. It does not permit
branch switching, stashing, history rewriting, destructive cleanup, remote
changes, pushing, publishing, or implicit execution of Git hooks, signing
programs, credential helpers, and external diff drivers.
_Avoid_: Git access, repository write access, publishing authority

**MCP Server Trust**:
The user's trust in one exact fingerprinted MCP Server configuration, including
its transport, executable or endpoint, arguments, and non-secret environment
shape. It permits the Workbench Runtime to start or connect to that server but
does not authorize any MCP Tool. A material configuration change revokes the
trust decision. Server Trust may persist for the workspace, but it never becomes
reusable Tool execution authority.
_Avoid_: MCP Tool authority, server availability, Workspace Trust

**Chat Permission Mode**:
The session-level policy governing how a Chat Session authorizes Ambient Tool
invocations. It is independent of model selection and does not override the
Repository Write Lock.
_Avoid_: Model Auto, Task authority

**One-time Tool Approval**:
The user's authorization of one exact pending Ambient Tool invocation in Chat.
Repeating or materially changing the invocation requires another decision.
_Avoid_: Session approval, Ambient Authority Grant

**Session Tool Approval**:
The user's authorization of a bounded Ambient Tool capability for the remainder
of one Chat Session. It does not carry into Conversation Forks or other Chat
Sessions and never expands silently when resources change.
_Avoid_: One-time approval, workspace approval

**Chat Auto Mode**:
A Chat Permission Mode in which the user confirms a bounded, session-specific
Ambient Authority Grant before Ambient Tools run, after which covered
invocations proceed without per-invocation prompts. The permission control must
distinguish Chat Auto Mode from automatic model selection.
_Avoid_: Model Auto, Task mode, blanket approval

**Tool Policy Denial**:
A side-effect-free, audited Tool result produced when a requested invocation
would cross the Repository Boundary or exceed the current Ambient
Authority Grant. It tells the Agent which policy was violated and which
available capabilities remain, allowing the current Response Attempt or
Assignment Attempt to replan without prompting the user or executing the
prohibited operation. After three materially equivalent denials in one attempt,
Chat completes with the limitation. A Task never opens a mid-execution authority
prompt; if it cannot satisfy its contract within the authority fixed at
admission, it fails terminally and releases the Active Task Slot.
_Avoid_: Tool failure, user rejection, permission prompt

**Tool Audit Record**:
An immutable, durable account of every requested Tool invocation, including
policy denials. It links the execution context, Agent, Resource Snapshot,
Operation Key, sanitized inputs, authority decision, timing, terminal outcome,
affected repository paths, declared external endpoints, and sanitized result
or private artifact. Reconciliation and corrections append records rather than
rewriting prior evidence.
_Avoid_: Tool output, event log, approval history

**Rejection Record**:
A sanitized append-only audit fact for an invalid, stale, or conflicting
lifecycle event. It records event and aggregate identity, observed aggregate
version, stable rejection reason, and bounded context without changing aggregate
state or version, locks, slots, checkpoints, or operations and without emitting
a domain event. Replaying the identical rejected event returns the same result
without appending another record.
_Avoid_: domain event, failed transition, Tool Audit Record

**Lifecycle Event Identity**:
The stable identity and canonical payload fingerprint carried by every command
or recovery stimulus together with its aggregate identity and expected version.
Exact replay returns the originally stored transition or rejection before
version checks and causes no new write. Reusing the identity with changed
content is `event-identity-conflict`; a new identity with an obsolete expected
version is `stale-aggregate-version`.
_Avoid_: Operation Key, domain event sequence, protocol message identity

**Domain Transition Event**:
The append-only authoritative fact emitted for exactly one aggregate state
transition, naming its source, destination, and resulting version. An atomic
command that changes several aggregates emits one ordered event per transition;
the events share causation, transaction, and correlation identities. Protocol
delivery may batch them without merging or replacing their identities. Event
types are stable past-tense domain facts such as `task.quiescence-started`, not
imperative commands or generic `state-changed` notifications; structured reason
and disposition codes distinguish guarded variants with identical meaning.
_Avoid_: Lifecycle Event Identity, compound event, Diagnostic Event

**Diagnostic Evidence**:
Privacy-minimized operational facts retained so a user or builder can explain,
assess, and recover Workbench behavior without duplicating authoritative
history or repository content.
_Avoid_: Debug log, transcript, telemetry

**Diagnostic Event**:
An append-only, structured, sanitized observation that explains an operational
change and links back to the authoritative Workbench records involved.
_Avoid_: Authoritative event, console log, Activity entry

**Pinned Diagnostic Evidence**:
Diagnostic Evidence protected from ordinary retention cleanup while an
unresolved recovery or integrity condition depends on it.
_Avoid_: Permanent log, authoritative record, saved export

**Support Bundle**:
A user-created, previewed local export of sanitized Diagnostic Evidence for one
support incident; it is never retained, uploaded, or sent by the Workbench.
_Avoid_: Telemetry upload, database backup, log archive

**Operational Incident**:
The durable identity and causal evidence chain for one unexpected Workbench
failure or recovery blocker, including its current impact and next safe action.
_Avoid_: Error message, Attention Request, support ticket

**Health Snapshot**:
A derived, point-in-time assessment of Workbench dependencies and recovery
blockers, reproducible from live checks and authoritative records.
_Avoid_: Health log, diagnostic history, Durable Checkpoint

**Secret-Minimized Execution**:
The Runtime policy that keeps secret values out of model context, Tool schemas,
audit records, errors, and inherited command environments; stores MCP
authentication only in SecretStorage; never loads repository environment files
implicitly; and denies Tools intended to retrieve credentials. It reduces
exposure but does not technically prevent an authorized Ambient Tool from using
resources available to the VDI user.
_Avoid_: Credential isolation, sandboxing, secret access

**External Mutation**:
An Ambient Tool operation that creates, changes, sends, publishes, or deletes
state outside the current repository, such as commenting on or closing an Azure
DevOps work item. Read access to the same service does not imply authority for
any External Mutation, and distinct effects require separately disclosed
authority.
_Avoid_: Network access, MCP access, external publishing

**External Capability Decision**:
The user's single admission-time Allow or Deny decision for external Tools and
network calls. Allow records broad Task-wide Ambient Authority for every
external capability exposed by the Task's already trusted, Agent-eligible
resources, including uses not predicted by its initial plan; the admission
dialog discloses known providers, effect classes, and the breadth of the grant.
Deny prevents admission when the Task requires external capability. Resources
installed, reconfigured, or newly trusted after admission remain outside the
running Task, and no authority prompt may interrupt execution.
_Avoid_: External Mutation approval, network prompt, deferred approval

**Extension Tool**:
A Tool registered by another installed VS Code extension through the public
language-model tool API.
_Avoid_: Workbench Tool, MCP Tool

**Extension Tool Authority**:
Ambient authority bound to one Extension Tool's providing extension identity
and version, Tool identity, and input-schema fingerprint. A change to any bound
element invalidates the authority at the next Resource Snapshot boundary and
requires informed reconfirmation.
_Avoid_: Extension trust, Tool availability, permanent Tool approval

**MCP Tool**:
A Tool exposed by a configured MCP Server.
_Avoid_: Workbench Tool, Extension Tool

**Invalid Agent**:
An Agent whose definition violates the schema or refers to an unknown resource;
it can be inspected but cannot run.
_Avoid_: Broken agent, unavailable agent

**Unavailable Agent**:
A valid Agent that cannot currently run because an operational dependency is
not ready.
_Avoid_: Invalid agent, broken agent

**Supported Target**:
An operating-system and CPU-architecture pair for which one Workbench release
is packaged and release-gated. The MVP Supported Targets are `win32-x64` and
`darwin-arm64`.
_Avoid_: Supported platform, supported operating system

**Specification Acceptance Gate**:
The evidence review that determines whether the MVP specification is complete,
consistent, traceable, and precise enough for implementation to begin without
reopening product or architecture decisions. It validates the specification
and its executable test design; it does not claim that an unbuilt implementation
has passed its prescribed checks.
_Avoid_: Release Gate, implementation test run, design approval

**Implementation Verification Gate**:
The future evidence gate that requires the implemented Workbench to pass the
unit, contract, integration, scenario, accessibility, recovery, security, and
packaged VS Code checks prescribed by the accepted MVP specification.
_Avoid_: Specification Acceptance Gate, code review, test plan

**Normative Requirement**:
One atomic, testable obligation in the MVP specification, identified by a stable
ID and traced bidirectionally to its owning component or invariant, prescribed
Verification Checks, and required evidence. Rationale, examples, and explanatory
prose are not Normative Requirements.
_Avoid_: Acceptance Scenario, design note, test case

**Verification Check**:
A named mandatory check prescribed by the MVP specification with a declared
verification layer, setup, stimulus, observable oracle, failure behavior, and
required evidence. It verifies one or more Normative Requirements without
dictating every internal test or the implementation's complete test layout.
_Avoid_: Normative Requirement, ad hoc test, implementation test suite

**Conclusive Verification Run**:
A reproducible execution in which every mandatory Verification Check applicable
to the gate and Supported Target passes with its required evidence. Failures,
skips, quarantines, flaky-only passes, missing evidence, unsupported
not-applicable claims, and inconclusive outcomes block the gate rather than
being waived.
_Avoid_: Best-effort test run, partial pass, waived release

**Developer Verification Profile**:
A fast, focused implementation-time path for running selected Verification
Checks against a real VS Code Extension Development Host from the current source
tree. It provides continuous assembly feedback while features are built but
does not replace the packaged two-target Implementation Verification Gate.
_Avoid_: Release Gate, headless Runtime harness, manual smoke test

**Specification Acceptance Record**:
The durable record that identifies the exact specification revision, successful
machine validation result, completed semantic-review checklist, unresolved-item
count of zero, reviewer, and acceptance time for one Specification Acceptance
Gate decision.
_Avoid_: Test report, informal approval, Implementation Verification Gate

**Threat Case**:
A specification-owned account of an asset, trust boundary, attacker capability,
abuse path, required control, accepted residual risk, and the adversarial
Verification Checks that prove the control. Security checklist items without
negative-check traceability are not Threat Cases.
_Avoid_: Bug report, generic security requirement, penetration-test note

**Durability Boundary**:
A declared Runtime point at which intent, an external-effect handoff, committed
state, a checkpoint, a lock transition, or a migration step changes what
recovery may safely do. Every Durability Boundary generates a mandatory
fault-injection Verification Check.
_Avoid_: Logging point, ordinary function boundary, manual crash test

**Invariant Check**:
A deterministic example-based or generative Verification Check that proves a
Runtime property across valid and invalid state transitions. A generative run
records its seed and, on failure, the minimized transition trace needed to
reproduce it.
_Avoid_: Acceptance Scenario, happy-path unit test, random stress test

**Deterministic Model Provider**:
A test-only VS Code extension fixture that registers predictable language models
through the real `vscode.lm` provider API so model selection, streaming, Tool
calls, cancellation, disappearance, consent denial, quota, and error behavior
can be verified reproducibly in an Extension Development Host. It is excluded
from production packages.
_Avoid_: Production model provider, mocked Runtime port, live-provider smoke test

**Verification Manifest**:
A sanitized, machine-readable record of one Conclusive Verification Run,
binding its Verification Check outcomes and bounded supporting evidence to the
exact source revision, package hashes, environment, schema and protocol
versions, deterministic seeds, and any required human attestations.
_Avoid_: Raw test log, Support Bundle, release notes

**Critical Verification Kernel**:
Deterministic Runtime code whose incorrect branch can violate lifecycle,
authority, Repository Boundary, protocol-validation, redaction, or migration
guarantees. Its state and guard branches require complete exercise plus mutation
testing with no unexplained behavior-changing survivor.
_Avoid_: All production code, code-coverage target, acceptance scenario

**Verification Fixture**:
A synthetic repository, identity, credential reference, conversation, MCP
server, external provider, or failure condition used to produce reproducible
Verification Evidence without exposing real repository content, secrets, or
host identity.
_Avoid_: Production sample, copied user data, developer workspace

**Workspace Compatibility Gate**:
The activation-time write gate that records whether the workspace database is
`checking`, `compatible`, `migration-required`, `migrating`,
`recovery-required`, or `newer-schema-refused`. Only `compatible` exposes
writable Runtime services. The gate persists across Migration Attempts and
therefore represents the workspace's current disposition rather than one
upgrade execution.
_Avoid_: Migration Attempt, release compatibility range, Repository Write Lock

**Migration Attempt**:
One immutable execution of an ordered forward database-migration chain. Its
nonterminal states are `preparing`, `backing-up`, `applying`, `verifying`, and
`reopening`; its terminal states are `succeeded`, `failed`, and `interrupted`.
Failure or interruption rolls back the transaction, preserves the live database
and backup, and leaves the Workspace Compatibility Gate
`recovery-required`. Explicit retry creates a new Attempt.
_Avoid_: Workspace Compatibility Gate, downward migration, backup restoration

**Workbench Protocol**:
The versioned, validated application-message contract through which one
Workbench Webview observes authoritative host state and requests application
behavior. It carries commands, queries, results, Authoritative Snapshots, and
Projection Events; it never gives the Webview domain authority.
_Avoid_: Runtime API, Webview state, extension command

**Webview Instance**:
One host-recognized lifetime of a rendered Workbench Webview, identified during
the Workbench Protocol handshake. Reload creates a new identity; messages from
an unbound or superseded instance cannot request application behavior.
_Avoid_: Chat Session, VS Code window, workspace identity

**Presentation Stream**:
The ordered, workspace-scoped sequence of authoritative Projection Events from
which a bound Webview advances a particular Authoritative Snapshot. A changed
stream identity or unavailable sequence range requires a fresh snapshot.
_Avoid_: Domain event log, model token stream, Chat transcript

**Authoritative Snapshot**:
A point-in-time, host-produced projection of every domain fact needed to render
the Workbench, identified by its Presentation Stream and inclusive sequence.
It is replaceable presentation input, not a second authority store.
_Avoid_: Durable Checkpoint, database backup, cached Webview state

**Projection Event**:
One ordered Workbench Protocol fact that advances a named part of the
Authoritative Snapshot. Lifecycle Projection Events preserve the exact Domain
Transition Event identity; other Projection Events describe committed
presentation-relevant changes without inventing domain policy.
_Avoid_: Domain Transition Event, Diagnostic Event, UI callback
