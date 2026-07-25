---
id: WF-019
title: Define exhaustive Runtime lifecycle transition contracts
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-007
  - WF-008
  - WF-009
  - WF-012
  - WF-016
  - WF-018
---

## Question

Within the settled Task, Subtask, Assignment Attempt, Chat, authority, Memory,
migration, and recovery behavior, what are the complete state sets and
event/guard/side-effect contracts the Runtime must enforce?

The resolution must:

- preserve every state and lifecycle rule already fixed by WF-007, WF-008,
  WF-009, WF-012, WF-016, and WF-018;
- define the complete Response Attempt and durable operation state sets, which
  the existing decisions do not enumerate;
- provide exhaustive transition tables for Task, Subtask, Assignment Attempt,
  Response Attempt, durable operation, Memory Write Operation, and migration;
- name each triggering event, source and destination state, guard, transactional
  side effects, lock/slot effect, checkpoint or reconciliation obligation, and
  emitted domain event;
- define invalid, duplicate, stale, and recovery-replayed event behavior;
- distinguish terminal, non-executing, recoverable, and user-action-required
  states without inventing new product flows; and
- identify the lifecycle event identities consumed by the Workbench Protocol,
  logical SQLite schema, audit, diagnostics, and Verification Checks.

## Acceptance criteria

- Every named state has at least one valid entry path and a defined terminal or
  recovery disposition.
- Every transition is deterministic from persisted state plus explicit input.
- Illegal transitions are side-effect-free and have stable rejection reasons.
- Lock ownership, Active Task Slot ownership, durability, authority, and
  append-only-history invariants are attached to the relevant transitions.
- The result is precise enough for WF-020 and WF-021 to reference without
  choosing lifecycle behavior themselves.

## Resolution

### Contract shape and universal rules

SQLite current records are authoritative. Every accepted lifecycle command is
one transaction over:

1. the aggregate's expected version and current state;
2. all guard evidence needed by the transition;
3. current lock, slot, authority, operation, and checkpoint records;
4. the aggregate update and any correlated aggregate updates;
5. ordered append-only Domain Transition Events and audit facts.

Model or Agent output may submit a transition claim but cannot commit one.
Runtime validation owns every state change.

Every command or recovery stimulus carries a stable Lifecycle Event Identity:
`event_id`, target aggregate identity, expected aggregate version, event type,
and canonical payload fingerprint. Processing order is:

1. An exact prior `event_id` and fingerprint returns the original accepted or
   rejected outcome without another write.
2. Reusing an identity with different content rejects
   `event-identity-conflict`.
3. A new identity with an obsolete expected version rejects
   `stale-aggregate-version`.
4. An event unavailable from the persisted source state rejects
   `invalid-transition`.
5. A structurally valid transition whose named guard fails returns that guard's
   stable reason.

A rejection changes no aggregate version or state, lock, slot, checkpoint, or
operation and emits no Domain Transition Event. When the database is writable,
the first rejection appends one sanitized Rejection Record; its exact replay
does not append another. When compatibility has not enabled writes, rejection
is returned without attempting persistence.

Each Domain Transition Event is a stable past-tense domain fact for exactly one
aggregate transition. An atomic command affecting multiple aggregates emits one
event per transition with a shared `transaction_id`, `correlation_id`, and
`causation_event_id`, plus an ordered transaction sequence. Every event carries
aggregate identity, source state, destination state, resulting version, actor
class, timestamp, reason or disposition code where applicable, and the relevant
checkpoint, lock, slot, Operation Key, or recovery identity references. A
generic `state-changed` event is not authoritative.

Terminal states have no outgoing lifecycle transition. Corrections,
reconciliation findings, and privacy redactions append facts; they never rewrite
prior transition history.

### Canonical state sets and classifications

| Aggregate | State | Classification | Slot / lock disposition |
| --- | --- | --- | --- |
| Task | `admitting` | pre-slot, non-executing, user-action-capable | neither |
| Task | `queued` | pre-slot, schedulable when ready | neither |
| Task | `preparing` | active execution phase; recoverable | owns Active Task Slot and Repository Write Lock |
| Task | `running` | active execution phase; recoverable | owns slot and lock |
| Task | `quiescing` | active settlement phase; recoverable | owns slot and lock until settlement commits |
| Task | `paused` | active, non-executing, user-action-required | owns slot; no lock |
| Task | `waiting-for-routing` | active, non-executing, user-action-required | owns slot; no lock |
| Task | `waiting-for-dependency-confirmation` | admission or active wait, user-action-required | admission: neither; active: slot only |
| Task | `externally-blocked` | active, non-executing; condition-driven or user-action-required by Task Blocker | owns slot; no lock |
| Task | `recovering` | active, non-executing recovery | owns slot; no lock |
| Task | `verifying` | active Completion Check phase; recoverable | owns slot and lock |
| Task | `succeeded` | terminal success | neither |
| Task | `failed` | terminal Unsatisfiable Determination | neither |
| Task | `cancelled` | terminal user/parent stop | neither |
| Subtask | `pending` | nonterminal, dependencies unresolved | no Attempt capacity |
| Subtask | `ready` | nonterminal, schedulable | no Attempt capacity |
| Subtask | `running` | nonterminal execution span across one or more Attempts | capacity belongs only to a selected/running Attempt |
| Subtask | `waiting-for-routing` | nonterminal, user-action-required | no Attempt capacity |
| Subtask | `succeeded` | terminal success | none |
| Subtask | `failed` | terminal local failure | none |
| Subtask | `superseded` | terminal unstarted graph history | none |
| Subtask | `cancelled` | terminal explicit or parent cancellation | none |
| Assignment Attempt | `selected` | nonterminal, resources pinned and capacity reserved | one Attempt slot and, when applicable, write-capable slot |
| Assignment Attempt | `running` | nonterminal provider execution | retains reserved capacity |
| Assignment Attempt | `succeeded`, `declined`, `failed`, `interrupted`, `outcome-unknown`, `cancelled` | terminal | releases all Attempt capacity |
| Response Attempt | `preparing` | nonterminal context/resource preparation | owns its Session's one active-attempt position |
| Response Attempt | `running` | nonterminal model-and-Tool loop | owns Session position; mutation capacity only per executing operation |
| Response Attempt | `waiting-for-approval` | nonterminal, user-action-required | owns Session position; no mutation reservation |
| Response Attempt | `succeeded`, `blocked`, `failed`, `cancelled`, `interrupted` | terminal | releases Session position |
| Durable Operation | `intent-recorded` | nonterminal durability boundary | no effect has been handed off |
| Durable Operation | `executing` | nonterminal effect handoff may be in flight | effect-specific serialization reservation |
| Durable Operation | `retry-wait` | nonterminal recoverable/backoff | no execution reservation |
| Durable Operation | `reconciling` | nonterminal recoverable inspection | no replay permission |
| Durable Operation | `outcome-unknown` | nonterminal blocked; condition- or user-action-required | Operation Barrier may remain |
| Durable Operation | `succeeded`, `failed`, `cancelled` | terminal | releases operation reservation and barrier |
| Workspace Compatibility Gate | `checking`, `migration-required`, `migrating` | nonterminal automatic gate states | writable Runtime disabled |
| Workspace Compatibility Gate | `recovery-required`, `newer-schema-refused` | nonterminal user-action-required gate states | writable Runtime disabled |
| Workspace Compatibility Gate | `compatible` | current writable disposition | writable Runtime may start after lease checks |
| Migration Attempt | `preparing`, `backing-up`, `applying`, `verifying`, `reopening` | nonterminal recovery-sensitive phases | writable Runtime disabled |
| Migration Attempt | `succeeded`, `failed`, `interrupted` | terminal immutable attempt history | none |

`Task Continuation` is a durable field, not a Task state. Its allowed values are
`preparing`, `running`, and `verifying`. It is captured before an active Task
leaves an execution phase and is preserved through quiescence, pause, routing or
dependency wait, external blocking, and recovery. Resumption requires Repository
Reactivation and returns to that phase unless the same transaction records a
valid graph change from `verifying` to `running`.

`Quiescence Disposition` is likewise data, not a state. It names the deterministic
post-settlement target: `paused`, `cancelled`, `waiting-for-routing`,
`waiting-for-dependency-confirmation`, `externally-blocked`, or `failed`, plus
cause, initiator, Task Continuation, and its linked routing, confirmation,
blocker, or Unsatisfiable Determination record. Stop may monotonically replace
any nonterminal disposition with `cancelled`; nothing may downgrade
cancellation. Force-stop is a cancellation-only flag.

### Task transitions

| Triggering event | Source → destination | Guard | Transactional effects, lease/checkpoint obligation | Domain event |
| --- | --- | --- | --- | --- |
| Create Task draft | none → `admitting` | one open supported workspace; valid requester | create Task identity and admission draft; no slot or lock | `task.admission-started` |
| Propose admission dependency | `admitting` or `queued` → `waiting-for-dependency-confirmation` | material evidence; candidate is not self; no duplicate active request | persist admission-context Dependency Confirmation Request and candidate edge; no slot or lock | `task.dependency-confirmation-requested` |
| Resolve admission dependency | `waiting-for-dependency-confirmation` → `admitting` | request context is `admission`; matching open request and contract version; accepting edge is acyclic | append accepted edge or denial with rationale; close request; no slot or lock | `task.dependency-confirmation-resolved` |
| Confirm Task Contract | `admitting` → `queued` | versioned complete contract confirmed; all dependency requests resolved; graph acyclic; boundary and authority valid | commit contract version, readiness facts, stable submission order; no slot or lock | `task.admitted` |
| Edit queued Task | `queued` → `admitting` | user request; no slot owner; no dependent execution made the version immutable | create readmission draft; retain prior contract version as history | `task.readmission-started` |
| Start ready Task | `queued` → `preparing` | all Task Dependencies succeeded; no pending confirmations or applicable Operation Barrier; earliest ready by stable order; Chat mutation has reached safe boundary; no slot or lock owner | atomically acquire Active Task Slot and Repository Write Lock; establish preparation checkpoint and initial baseline identity | `task.preparation-started` plus lease-acquisition events |
| Finish initial preparation | `preparing` → `running` | contract/resources revalidated; initial repository baseline and acyclic initial Task Graph Revision committed | commit Durable Checkpoint and graph events; retain slot and lock | `task.execution-started` |
| Request or require quiescence | `preparing`, `running`, or `verifying` → `quiescing` | valid target record exists; no cancellation downgrade | capture Task Continuation; persist Quiescence Disposition; stop new scheduling and request active-call cancellation; retain slot and lock | `task.quiescence-started` |
| Complete quiescence | `quiescing` → disposition target | all cancellable calls ended; non-cancellable operations settled or, for force-cancel only, became `outcome-unknown`; outcomes and checkpoint committed | cancel/interrupt affected Attempts as appropriate; release Repository Write Lock in the same transaction; retain slot except terminal target; emit correlated child/operation events | target-specific event from the mapping below |
| Force-stop | `quiescing` → `cancelled` | disposition is `cancelled` and force flag confirmed | unsettled operations become `outcome-unknown`; create Operation Barriers; commit final checkpoint; release lock and slot | `task.cancelled` |
| Cancel before execution | `admitting` or `queued` → `cancelled` | explicit user stop; no external effect in flight | close draft/queue position; no lease change | `task.cancelled` |
| Cancel waiting or non-executing Task | `paused`, `waiting-for-routing`, `waiting-for-dependency-confirmation`, or `externally-blocked` → `cancelled` | explicit stop; linked records preserved; unresolved effects have barriers | active context cancels nonterminal Subtasks and releases its slot; admission context owns no slot; close pending intervention records; no lock exists | `task.cancelled` plus correlated child cancellation events where applicable |
| Interrupt execution | `preparing`, `running`, `quiescing`, or `verifying` → `recovering` | Recovery Run identifies an interrupted active Task and valid ownership invariants | atomically release lock, retain slot, capture interrupted phase/disposition, mark formerly running Attempts `interrupted`, schedule operation reconciliation | `task.recovery-started` plus Attempt/lock events |
| Resume interrupted recovery | `recovering` → `recovering` | same incomplete Recovery Run and exact recovery step identity | exact committed steps are no-ops; remaining work continues from current records | no new transition event for exact replay; `task.recovery-progressed` only for newly committed recovery facts |
| Change recovery disposition | `recovering` → `recovering` | explicit pause or stop; recovery worklist identity current | persist a post-recovery `paused` or `cancelled` disposition; stop may override pause; force-cancel may leave operation barriers; no lock; retain slot until a terminal exit | `task.recovery-disposition-changed` |
| Finish safe recovery | `recovering` → Task Continuation or preserved disposition target | operations classified; checkpoint restored; repository, dependencies, resources, trust, and authority revalidated | perform Repository Reactivation; acquire lock only when entering an execution phase; retain slot | `task.recovered` plus lease event when applicable |
| Block recovery | `recovering` → `externally-blocked` | a concrete Task Blocker remains after bounded automatic recovery | persist blocker and continuation; retain slot; no lock | `task.blocked` |
| Resume paused Task | `paused` → Task Continuation | explicit resume; no unconfirmed amendment; reactivation and all phase guards pass | Repository Reactivation; acquire lock atomically with phase entry; retain slot | `task.resumed` plus lock event |
| Confirm active amendment | `paused` → `paused` | amended goal is materially the same; scope, criteria, permission, and authority changes explicitly confirmed | commit new Task Contract version and rationale; append Task Graph Revision superseding only unstarted incompatible work; set continuation `running`; do not acquire lock | `task.contract-amended` |
| Resolve routing intervention | `waiting-for-routing` → Task Continuation | proposal approval or eligible manual override committed; affected Subtask can continue; Repository Reactivation passes | close routing intervention, restore affected Subtask to `running`, acquire lock with phase entry; a new Assignment Attempt is selected separately | `task.routing-resolved` |
| Propose active dependency | `preparing`, `running`, or `verifying` → `quiescing` | material evidence; Dependency Confirmation Request records source phase; proposed prerequisite is already `succeeded`; unfinished/failed/cancelled prerequisite rejects `active-task-dependency-unschedulable` | disposition targets `waiting-for-dependency-confirmation`; ordinary quiescence rules | `task.quiescence-started` |
| Resolve active dependency | `waiting-for-dependency-confirmation` → Task Continuation | request context is `active`; matching request/version; accepted prerequisite remains succeeded; denial has rationale; Repository Reactivation passes | append edge or denial, close request, acquire lock with phase entry | `task.dependency-confirmation-resolved` |
| Observe condition-driven unblock | `externally-blocked` → Task Continuation | matching Task Blocker; required condition materially changed; revalidation and Repository Reactivation pass | close blocker, acquire lock with phase entry, retain slot | `task.unblocked` |
| Apply Repair Intervention | `externally-blocked` → `running` | blocker is `repair-cycles-exhausted`; material in-contract evidence supplied; unchanged retry rejects `no-material-repair-intervention` | Repository Reactivation, new Task Graph Revision, reset repair-cycle counter, close blocker, acquire lock | `task.repair-intervention-accepted` |
| Move blocker to paused amendment | `externally-blocked` → `paused` | proposed intervention changes scope, criteria, permission, or authority | retain blocker evidence, slot, and continuation; no lock; amendment remains separate | `task.paused` |
| Begin Completion Check | `running` → `verifying` | all required live graph leaves succeeded; no unresolved dependency, routing request, or nonterminal/unknown operation | commit pre-verification checkpoint; retain slot and lock | `task.verification-started` |
| Pass Completion Check | `verifying` → `succeeded` | every success criterion passes against repository and durable Task record | commit evidence and final checkpoint; release lock and slot atomically | `task.succeeded` plus lease-release events |
| Create repair cycle | `verifying` → `running` | concrete gap; fewer than three failed Repair Cycles | append repair Subtasks/edges as a valid Task Graph Revision; initial gap starts cycle one, each post-repair failed check increments count; retain slot and lock | `task.repair-cycle-started` |
| Exhaust repair cycles | `verifying` → `quiescing` | third post-repair Completion Check still finds a concrete gap | create user-action-required Task Blocker `repair-cycles-exhausted`; disposition targets `externally-blocked` | `task.quiescence-started` |
| Establish unsatisfiable outcome while executing | `preparing`, `running`, or `verifying` → `quiescing` | evidence-backed Unsatisfiable Determination; no permitted retry, reroute, graph revision, or repair remains | disposition targets `failed`; settle active work | `task.quiescence-started` |
| Establish unsatisfiable outcome while non-executing | `paused`, `waiting-for-routing`, active-context `waiting-for-dependency-confirmation`, `externally-blocked`, or `recovering` → `failed` | determination committed; no active or `outcome-unknown` operation | close interventions, cancel unresolved unstarted work, release slot; no lock | `task.failed` |

The target-specific completion event for `quiescing` is normative:

| Quiescence Disposition target | Domain event |
| --- | --- |
| `paused` | `task.paused` |
| `cancelled` | `task.cancelled` |
| `waiting-for-routing` | `task.routing-wait-started` |
| `waiting-for-dependency-confirmation` | `task.dependency-confirmation-wait-started` |
| `externally-blocked` | `task.blocked` |
| `failed` | `task.failed` |

If Repository Reactivation fails any resume guard, the requested transition does
not partially enter its continuation. It either remains in the source state with
a stable rejection or atomically enters `externally-blocked` with a Task Blocker
when the observed condition itself is new authoritative state.

An active Task may confirm a newly discovered top-level dependency only when
the prerequisite already succeeded. Because non-executing active Tasks retain
the slot, an unfinished prerequisite would be unschedulable. The supported
choices are denial or cancellation followed by a replacement Task Contract.

### Subtask transitions

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Append graph node | none → `pending` | valid current Task Graph Revision; objective is inside Task Contract; node identity new | `subtask.created` |
| Satisfy dependencies | `pending` → `ready` | every incoming prerequisite is `succeeded`; parent Task may schedule | `subtask.ready` |
| Select first Assignment | `ready` → `running` | Agent eligibility/selection succeeds; correlated Assignment Attempt enters `selected` and reserves capacity | `subtask.execution-started` |
| Request routing intervention | `running` → `waiting-for-routing` | no suitable eligible Agent, or allowed rerouting ends after Capability Decline; parent Task quiesces to matching wait | `subtask.routing-requested` |
| Resolve routing intervention | `waiting-for-routing` → `running` | approved Agent definition or eligible manual override; immutable prior Attempts retained | `subtask.routing-resolved` |
| Accept successful assignment | `running` → `succeeded` | Assignment Attempt is `succeeded`; Orchestrator acceptance references current graph; Runtime validates known operation outcomes and required artifacts | `subtask.succeeded` |
| Exhaust local execution routes | `running` → `failed` | objective cannot complete after permitted retries and Attempts; no current Attempt active or unknown | `subtask.failed` |
| Supersede unstarted work | `pending` or `ready` → `superseded` | current Task Graph Revision validly removes/replaces work; running/completed nodes reject | `subtask.superseded` |
| Cancel unfinished work | `pending`, `ready`, `running`, or `waiting-for-routing` → `cancelled` | explicit user or parent cancellation; active Attempt/operations settled or barriers recorded | `subtask.cancelled` |

A failed or cancelled Subtask never satisfies success-only dependencies.
Unfinished dependent work stays blocked until a valid in-contract Task Graph
Revision routes around the immutable terminal node. Parent Task failure occurs
only when no graph route can satisfy the Task Contract.

### Assignment Attempt transitions

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Commit Agent selection | none → `selected` | hard eligibility and semantic selection/override valid; immutable Resource Snapshot and rationale committed; concurrency below three and write-capable concurrency below one | `assignment.selected` |
| Provider accepts invocation | `selected` → `running` | pinned resources still valid at launch; provider accepted | `assignment.started` |
| Pre-launch failure | `selected` → `failed` | launch cannot proceed and no operational retry applies | release all Attempt capacity; `assignment.failed` |
| Pre-launch cancellation | `selected` → `cancelled` | parent/user cancellation before provider acceptance | release capacity; `assignment.cancelled` |
| Host interruption | `selected` or `running` → `interrupted` | Recovery Run observes extension-host loss | preserve completed records, release capacity; contained operations reconcile separately; `assignment.interrupted` |
| Validate completion claim | `running` → `succeeded` | Agent submitted Assignment Completion Claim; every operation outcome known; output/artifacts/checkpoint and authority invariants valid | commit outcome/checkpoint and release capacity; `assignment.succeeded` |
| Capability Decline | `running` → `declined` | valid delegated control call with unmet requirements | record decline evidence, release capacity, trigger at most one rerouting evaluation; `assignment.declined` |
| Exhaust execution failure | `running` → `failed` | known model/Runtime failure after allowed operational retry | preserve failure evidence and release capacity; `assignment.failed` |
| Cooperative cancellation | `running` → `cancelled` | cancellation completed and Attempt completion is known absent; uncertain operations remain separate | preserve partial output/completed effects and release capacity; `assignment.cancelled` |
| Live Agent outcome ambiguity | `running` → `outcome-unknown` | force-stop or live control-channel failure prevents classifying Agent terminal protocol | release capacity; do not retry in place; link required reconciliation/barriers; `assignment.outcome-became-unknown` |

Assignment Attempt terminal states are immutable. Extension-host loss always
produces `interrupted`; it does not later refine to Attempt
`outcome-unknown`. An uncertain contained Tool effect is represented by its
Durable Operation while the Attempt remains interrupted.

### Response Attempt transitions

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Submit durable user turn | none → `preparing` | no active Attempt for Session; fixed Agent valid at submission boundary; user turn committed first | create Attempt, pin Resource Snapshot/model selection, lock Session selector, reserve Session active position; `response.preparation-started` |
| Finish preparation | `preparing` → `running` | context, Memory versions, repository baseline, and any visible summary compaction committed; provider accepted | `response.started` |
| Known pre-launch guard rejection | `preparing` → `blocked` | quota, authentication, trust, or required availability prevents launch after turn commit | record stable blocker evidence; release Session position; `response.blocked` |
| Preparation malfunction | `preparing` → `failed` | preparation error is not a named guard rejection | preserve error evidence; release Session position; `response.failed` |
| Request Tool approval | `running` → `waiting-for-approval` | Tool requires Chat approval; sanitized exact request committed | retain Session position; reserve no mutation capacity and do not delay Task lock; `response.approval-requested` |
| Resolve approval | `waiting-for-approval` → `running` | approval/denial matches request; Tool identity, inputs, authority, baseline, and current Task lock revalidated | approval competes for mutation serialization only at execution; denial or lock invalidation becomes a structured Tool result; `response.approval-resolved` |
| Validate complete response | `running` → `succeeded` | provider terminal completion; all operations known; durable output and valid ledger deltas committed | release Session position and selector; a complete limitation response is success; `response.succeeded` |
| Unrecovered execution error | `running` → `failed` | model/Runtime error after allowed operational retry | preserve partial output and completed Tool records; release Session position; `response.failed` |
| User cancellation | `preparing`, `running`, or `waiting-for-approval` → `cancelled` | cancellation requested; active operations settle or become separately unknown | preserve partial output/completed effects, release Session position; `response.cancelled` |
| Host interruption | `preparing`, `running`, or `waiting-for-approval` → `interrupted` | Recovery Run observes extension-host loss | preserve submitted turn, completed output/Tools, and partial display output; exclude unfinished prose from future model context; invalidate approval; release Session position; `response.interrupted` |

Retry from any terminal non-success outcome creates a new Response Attempt for
the same durable user turn. No Response Attempt resumes. Unknown Tool effects
never create a Response Attempt `outcome-unknown` state.

Moving a Session to Trash first cancels an active Response Attempt and completes
only after it is terminal. Trash may retain unresolved operations. Permanent
deletion rejects while an Attempt is active, an operation is `reconciling` or
`outcome-unknown`, or Diagnostic Evidence is pinned.

### Durable Operation transitions

An Operation Key belongs to one immutable logical intent: parent Attempt,
provider/model or Tool identity, canonical inputs, effect class, authority
scope, and target. Execution retries, reconciliation, and provider idempotency
reuse it. Any changed intent or later Attempt receives a new key.

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Commit validated intent | none → `intent-recorded` | caller Attempt active; authority, boundary, effect class, canonical input, target, and Operation Key valid | persist intent before effect handoff and append Tool Audit Record where applicable; `operation.intent-recorded` |
| Hand off effect | `intent-recorded` or `retry-wait` → `executing` | authority/boundary/resources revalidated; backoff elapsed; no conflicting lock, serialization lease, or Operation Barrier; mutation retry has proof of non-application | reserve effect-specific serialization and record execution-attempt ordinal before invocation; `operation.started` |
| Observe success | `executing` → `succeeded` | provider result and required postcondition observed | persist sanitized result/artifact, affected targets, terminal audit, and caller checkpoint; release reservation/barrier; `operation.succeeded` |
| Schedule bounded retry | `executing` → `retry-wait` | transient known failure; fewer than three execution attempts; read-only/idempotent, or mutation proven not applied | record failure and backoff; release reservation; `operation.retry-scheduled` |
| Exhaust known failure | `intent-recorded`, `executing`, `retry-wait`, or `reconciling` → `failed` | failure known and retry forbidden/exhausted | record terminal reason, release reservation/barrier; `operation.failed` |
| Cancel before or without effect | `intent-recorded` or `retry-wait` → `cancelled` | caller cancellation; effect handoff absent | release reservation/barrier; `operation.cancelled` |
| Observe cooperative cancellation | `executing` → `cancelled` | provider proves no effect occurred | record cancellation evidence and release reservation/barrier; `operation.cancelled` |
| Require reconciliation | `executing` → `reconciling` | interruption/cancellation leaves effect uncertain and reconciliation can begin | release execution reservation; create conservative Operation Barrier; `operation.reconciliation-started` |
| Recover pre-handoff intent | `intent-recorded` → `retry-wait` or `cancelled` | Recovery Run proves effect handoff never began; parent still permits retry or is cancelled | record proof; `operation.retry-scheduled` or `operation.cancelled`, matching destination |
| Prove application | `reconciling` → `succeeded` | intended postcondition is observed | success is truthful even if parent Attempt is cancelled/interrupted; remove barrier; `operation.application-established` |
| Prove non-application, retry allowed | `reconciling` → `retry-wait` | postcondition absent and replay safe; parent still permits retry | record proof/backoff; remove barrier until next execution handoff; `operation.retry-scheduled` |
| Prove non-application, parent ended | `reconciling` → `cancelled` | postcondition absent; parent cancelled/interrupted with no continuation | remove barrier; `operation.cancelled` |
| Reconciliation remains inconclusive | `reconciling` → `outcome-unknown` | bounded inspection cannot classify effect | retain Operation Barrier and pin evidence; `operation.outcome-became-unknown` |
| New reconciliation evidence | `outcome-unknown` → `reconciling` | explicit user action or material provider/repository evidence; exact operation identity preserved | retain barrier; `operation.reconciliation-resumed` |

An unknown repository mutation creates a workspace-wide mutation barrier because
the MVP has no file leases or worktree isolation; read-only work may continue.
An unknown External Mutation blocks only operations whose provider, target, or
postcondition could overlap. Barriers belong to operations, survive parent Task
or Attempt termination, and are checked by Chat invocation, Task readiness,
Repository Reactivation, and Memory writes.

### Memory Write Operation overlay

Memory Write Operations use the complete Durable Operation state machine above.
They add these mandatory guards and effects:

| Boundary | Additional contract |
| --- | --- |
| Before `intent-recorded` | Repository Write Lock permits Chat mutation; no Task currently owns it; exact proposal is freshly confirmed; proposal/source/target versions, confirmation hash, Personal Memory privacy, schema, capacity, and repository baseline all match. A proposal waiting on the Task lock cannot be confirmed or queued. |
| `intent-recorded` → `executing` | Commit the exact replacement bytes, provenance delta, target Memory identity/version, and Operation Key before filesystem handoff. |
| `executing` → `succeeded` | Exact file replacement and provenance postcondition observed; commit resulting Memory version and registry refresh in the success boundary. |
| `executing` → `reconciling` | Compare actual file content, target version, provenance, and registry state with the confirmed postcondition; never infer success from file existence alone. |
| `reconciling` outcome | Applied maps to `succeeded`; not applied maps to `retry-wait` only while the same confirmation remains valid, otherwise `cancelled`; ambiguity maps to `outcome-unknown`. |
| Proposal rejection | No Memory Write Operation is created; retain only the minimal declined audit fact without rejected sensitive content. |

### Workspace compatibility and migration transitions

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Begin compatibility check | none or prior `compatible` → `checking` | Workbench use/restoration activates extension | close prior connections as required; writable services remain disabled; `compatibility.check-started` |
| Compatible schema observed | `checking` → `compatible` | schema/protocol metadata, integrity, target ABI, and lease invariants valid | open database and enable writable Runtime services; `compatibility.established` |
| Older supported schema observed | `checking` → `migration-required` | complete direct forward chain exists | record source/target versions; writes remain disabled; `compatibility.migration-required` |
| Newer schema observed | `checking` → `newer-schema-refused` | database schema exceeds supported range | refuse all writes and expose reinstall/restore actions; create no Migration Attempt; `compatibility.newer-schema-refused` |
| Corrupt/inconsistent state observed | `checking` → `recovery-required` | integrity, backup, or lease invariant fails | create Operational Incident; no writable startup; `compatibility.recovery-required` |
| Start migration | `migration-required` or explicit retry from `recovery-required` → `migrating` | user action required only for retry; ordered direct chain known; live database/source identity unchanged | create new Migration Attempt in `preparing`; `compatibility.migration-started` |
| Complete migration | `migrating` → `compatible` | Attempt `succeeded`; integrity passes; migrated database reopens successfully | enable writes; eligible future upgrade may replace prior backup only after this boundary; `compatibility.established` |
| Fail or interrupt migration | `migrating` → `recovery-required` | Attempt terminal `failed` or `interrupted` | transaction rolled back; live database and restorable backup preserved; expose explicit retry/restore/fresh actions; `compatibility.recovery-required` |
| Complete explicit restore/fresh recovery | `recovery-required` or `newer-schema-refused` → `checking` | separately audited recovery operation succeeded and exact data-loss/restore confirmation valid | never set `compatible` directly; repeat full compatibility/integrity/lease check; `compatibility.recheck-requested` |
| Install compatible code | `newer-schema-refused` → `checking` | running extension now declares support for observed schema | repeat full check; `compatibility.recheck-requested` |

Migration Attempt transitions:

| Triggering event | Source → destination | Guard and atomic effects | Domain event |
| --- | --- | --- | --- |
| Create ordered migration | none → `preparing` | gate `migrating`; source/target and full chain fixed | record attempt identity and close/checkpoint prior connections; `migration.preparation-started` |
| Start backup | `preparing` → `backing-up` | source identity/integrity sufficient to copy; destination private and writable | record backup intent before copy; `migration.backup-started` |
| Finish backup/start chain | `backing-up` → `applying` | one restorable backup verified and identified by source schema/extension version | begin single migration transaction; `migration.application-started` |
| Finish chain | `applying` → `verifying` | every ordered step applied in transaction | verify target schema and integrity before commit eligibility; `migration.verification-started` |
| Pass verification | `verifying` → `reopening` | target integrity and metadata valid | commit migration transaction, close migration connection, reopen through normal target path; `migration.reopen-started` |
| Reopen successfully | `reopening` → `succeeded` | target database reopens and integrity recheck passes | append immutable success evidence; `migration.succeeded` |
| Known migration failure | any nonterminal Attempt state → `failed` | backup, step, verification, or reopen fails while host remains available | roll back an active transaction where one remains; a `reopening` failure occurs after verified commit, so preserve the migrated live database and pre-upgrade backup without automatic restore; append failure evidence; `migration.failed` |
| Host interruption | any nonterminal Attempt state → `interrupted` | activation detects incomplete Attempt | rely on SQLite rollback where an uncommitted transaction existed; if interruption followed verified commit, preserve the migrated live database and pre-upgrade backup; verify both before exposing recovery; `migration.interrupted` |

`failed` and `interrupted` Migration Attempts never resume. Explicit retry creates
a new Attempt. Backup restoration and fresh-database creation are separately
audited recovery operations because they may be required while the live database
is not writable. Their success always returns the gate to `checking`, never
directly to `compatible`.

### Lock, slot, authority, and durability invariants

| Invariant | Enforced transition boundaries |
| --- | --- |
| Exactly zero or one Active Task Slot owner | acquire only with `queued` → `preparing`; retain through every nonterminal active Task state; release only on Task terminal transition. |
| Lock owner must equal slot owner | acquire with entry to `preparing`, `running`, or `verifying`; retain through `quiescing`; release atomically with quiescence completion, interruption recovery entry, or terminal completion. |
| No lock in non-executing Task state | `paused`, routing/dependency waits, `externally-blocked`, and `recovering` require no lock. |
| Chat mutation serialization | pending approval owns no mutation reservation; execution rechecks Task lock and Operation Barriers; at most one Chat repository mutation runs globally. |
| Assignment concurrency | `selected` reserves capacity; every terminal Attempt releases it; maximum three total and one Write-capable. |
| Authority immutability | every Operation records the authority decision and immutable caller Resource Snapshot; Task authority cannot expand during execution; Chat approval is revalidated at invocation. |
| Intent before effect | every external effect crosses `intent-recorded` before `executing`; every effect result precedes caller checkpoint advancement. |
| Unknown effects never replay | only reconciliation proof of non-application permits mutation retry; Operation Barriers survive parent termination. |
| Append-only execution history | Task Graph Revisions may supersede only `pending`/`ready` Subtasks; Attempts and terminal states are never rewritten. |
| Terminal Task success | requires successful Completion Check and no unresolved dependency, routing request, operation, blocker, or unknown outcome. |
| Terminal Task failure | requires Unsatisfiable Determination and no active/unknown operation. |
| Compatibility gate | no writable Runtime command, migration-independent audit write, or lock acquisition occurs unless gate is `compatible`; pre-compatibility rejections are returned without persistence. |

Lease, capacity, barrier, and recovery records are independent aggregates and
emit these exact correlated facts:

| Fact type | Emission boundary |
| --- | --- |
| `active-task-slot.acquired` | same transaction as `queued` → `preparing` |
| `active-task-slot.released` | same transaction as Task terminal entry |
| `repository-write-lock.acquired` | entry to an execution phase when the Task does not already hold it |
| `repository-write-lock.released` | quiescence completion, interruption recovery entry, or terminal Task completion |
| `assignment-capacity.reserved` | Assignment Attempt enters `selected` |
| `assignment-capacity.released` | Assignment Attempt enters any terminal state |
| `chat-mutation-capacity.reserved` | approved Chat mutation enters operation `executing` |
| `chat-mutation-capacity.released` | that operation leaves `executing` |
| `operation-barrier.created` | uncertain mutation enters `reconciling` or `outcome-unknown` |
| `operation-barrier.removed` | reconciliation reaches a known terminal/retry disposition |
| `recovery-run.started` | Recovery Run/worklist is first committed |
| `recovery-run.completed` | every worklist item reaches a safe disposition |

On activation, a valid interrupted executing Task enters `recovering`, releases
its lock, and retains its slot in one transaction. A terminal/non-executing lock
owner, multiple slot owners, a pre-slot slot owner, or a lock owner different
from the slot owner is a Lease Integrity Violation: the gate enters
`recovery-required`, an Operational Incident is emitted, and the Runtime never
guesses which lease to clear.

### Recovery Run and replay contract

Activation persists one Recovery Run identity and ordered worklist before
changing affected aggregates. Each step event identity is deterministically
derived from recovery ID, aggregate ID, and step name. Another host interruption
resumes that incomplete run; exact committed steps return their prior result,
and uncommitted steps evaluate current persisted state. A run closes only when
every affected Task, Attempt, and operation is safely resumed, explicitly
blocked, or terminal. A later unrelated interruption creates a new Recovery Run.

Recovery order is:

1. establish compatibility and lease integrity;
2. enter interrupted Tasks into `recovering`, release valid stale execution
   locks, and retain their slots;
3. terminalize interrupted Assignment/Response Attempts and invalidate pending
   approvals;
4. classify pre-handoff intents and reconcile in-flight effects;
5. install Operation Barriers for remaining unknowns;
6. restore Durable Checkpoints;
7. perform Repository Reactivation and revalidate dependencies, resources,
   trust, and authority;
8. resume the Task Continuation, complete its preserved Quiescence Disposition,
   or enter a structured blocked/terminal disposition.

User-paused Tasks remain paused. Other non-executing Tasks preserve their state
unless a newly observed authoritative condition creates a Task Blocker.
Terminal aggregates never resume.

### Stable rejection reasons

The following reasons are normative and may be extended only by WF-020 with
more-specific guards that preserve these meanings:

- `event-identity-conflict`
- `stale-aggregate-version`
- `invalid-transition`
- `terminal-state`
- `guard-contract-version-mismatch`
- `guard-dependency-cycle`
- `guard-dependency-unsatisfied`
- `active-task-dependency-unschedulable`
- `guard-task-not-ready`
- `guard-slot-owned`
- `guard-lock-owned`
- `guard-operation-barrier`
- `guard-authority-denied`
- `guard-boundary-violation`
- `guard-resource-unavailable`
- `guard-attempt-capacity`
- `guard-write-capacity`
- `guard-operation-outcome-unresolved`
- `guard-reactivation-required`
- `guard-repository-conflict`
- `guard-confirmation-stale`
- `guard-approval-stale`
- `no-material-repair-intervention`
- `new-task-required`
- `guard-deletion-retention-pinned`
- `guard-migration-write-disabled`
- `guard-lease-integrity`

An event aimed at a terminal aggregate rejects `terminal-state`, the normative
specialization of `invalid-transition` for a terminal source.

### Lifecycle identities consumed downstream

WF-020 must expose the authoritative domain fact names from the tables without
renaming or collapsing them and must carry their aggregate version, source and
destination, causation, transaction/correlation ordering, reason/disposition,
and relevant checkpoint/lease/operation/recovery references. It may define
transport envelopes, snapshots, batching, and payload schemas but may not choose
new lifecycle behavior.

WF-021 must persist:

- every canonical current state and aggregate version;
- Task Continuation, Quiescence Disposition, Task Blocker, Dependency
  Confirmation Request, Active Task Amendment, Repair Cycle, and
  Unsatisfiable Determination records;
- independent Active Task Slot and Repository Write Lock ownership;
- Assignment and Chat concurrency reservations;
- Durable Operations, execution-attempt ordinals, immutable intent fingerprints,
  Operation Keys, Operation Barriers, and reconciliation evidence;
- Workspace Compatibility Gate, immutable Migration Attempts, backup identity,
  and recovery actions;
- Lifecycle Event Identity outcomes, Rejection Records, ordered Domain
  Transition Events, Recovery Runs/steps, Tool Audit Records, Durable
  Checkpoints, and artifact references.

Audit and Diagnostics consume the same event identities but derive views rather
than authoritative state. Verification must exercise every table row, every
named guard and rejection, every Durability Boundary, every terminal state's
absence of outgoing transitions, exact duplicate replay, identity collision,
stale version, interruption at each recovery step, lock/slot invariant failure,
and every operation reconciliation result.
