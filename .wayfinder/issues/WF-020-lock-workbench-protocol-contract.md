---
id: WF-020
title: Lock the versioned Workbench Protocol catalog and schemas
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
  - WF-018
  - WF-019
---

## Question

What exact version-1 command, query, event, snapshot, error, and compatibility
contract connects the Workbench Webview to the extension-host application layer?

The resolution must:

- enumerate the stable command/query and host-event identities for every MVP
  Task, Chat, Agent, Resource, authority, Memory, attention, diagnostics,
  migration, recovery, and settings workflow;
- define a discriminated schema for every payload and response, including
  identity, causation, correlation, expected-version, and operation fields;
- define the initial handshake, protocol-version mismatch, Webview-instance
  identity, authoritative snapshot, incremental event ordering, resubscription,
  and reconstruction sequence;
- define validation limits, unknown message behavior, stale/duplicate command
  handling, optimistic-concurrency rejection, sanitized error envelopes, and
  side-effect-free rejection guarantees;
- bind commands and events to the lifecycle identities fixed by WF-019 without
  duplicating domain policy in the Webview; and
- produce machine-verifiable schemas suitable for the fake and production
  protocol adapter contract suite.

## Acceptance criteria

- Every user-visible MVP action maps to exactly one declared application
  command or query path.
- Every authoritative state change needed by the Webview maps to a declared
  event or snapshot field.
- Duplicate, stale, malformed, unknown, mismatched-version, and wrong-Webview
  inputs have deterministic, side-effect-free outcomes.
- Reload can reconstruct the complete authoritative presentation state without
  relying on Webview-owned domain state.
- No payload contains a secret or grants authority merely by assertion.

## Resolution

### Boundary and schema authority

Version 1 is a same-release, JSON-only Workbench Protocol between one bound
Webview Instance and the extension-host application layer. It is not a Runtime
or feature-internal API. The Webview may keep ephemeral presentation state
(selection, scroll position, open disclosure widgets, and an unsent composer)
but owns no Task, Chat, authority, approval, Memory, diagnostic, recovery, or
settings fact.

The normative wire schemas are JSON Schema Draft 2020-12 with:

- one closed schema per named request, result, snapshot, control message, and
  Projection Event (`additionalProperties: false` at every object boundary);
- UTF-8 JSON values only, finite numbers only, RFC 3339 UTC timestamps, and
  opaque strings for every identity;
- generated TypeScript types and validators from the same checked-in schema
  catalog; handwritten parallel wire types are prohibited; and
- golden valid/invalid fixtures for every discriminator plus fake-adapter and
  production-gateway conformance against the same validators.

The catalog has independent integer `protocolVersion: 1` and
`catalogRevision: 1`. A catalog revision may clarify fixtures without changing
accepted bytes. Any schema, identity, meaning, required field, or ordering
change increments the protocol version.

### Envelopes and shared value schemas

All application requests use this closed envelope:

```text
Request<TName, TPayload> = {
  protocolVersion: 1,
  kind: "command" | "query",
  name: TName,
  requestId: Id,
  webviewInstanceId: Id,
  correlationId: Id,
  causationId: Id | null,
  operation: {
    operationId: Id,
    intentId: Id,
    submittedAt: Timestamp
  },
  expectedVersions: ExpectedVersion[],
  payload: TPayload
}

ExpectedVersion = {
  aggregateType: AggregateType,
  aggregateId: Id,
  version: nonnegative integer | "absent"
}
```

`requestId` identifies one delivery and is unique within a Webview Instance.
`operationId` is the durable idempotency identity for one logical command and
survives retransmission or Webview reload. `intentId` groups successive
operations that implement one visible user intent without making them
duplicates. `correlationId` groups the complete workflow; `causationId` points
to the request, Projection Event, Attention Request, or proposal that directly
caused this request. The host derives the canonical payload fingerprint and
actor from validated bytes and the bound Webview; neither is asserted by the
Webview.

Every command carries the complete expected-version set named by its catalog
entry. Creation uses `"absent"`. Queries carry `expectedVersions: []`; their
operation fields provide traceability but never create a Durable Operation.
Duplicate expected-version entries and unexpected aggregate types reject.

Every request has exactly one response identity, `<request-name>.result`:

```text
Result<TName, TValue> =
  | {
      protocolVersion: 1, kind: "result", name: TName + ".result",
      requestId: Id, operationId: Id, correlationId: Id,
      outcome: "accepted", resultingVersions: ExpectedVersion[],
      value: TValue
    }
  | {
      protocolVersion: 1, kind: "result", name: TName + ".result",
      requestId: Id, operationId: Id, correlationId: Id,
      outcome: "rejected", resultingVersions: [],
      error: ErrorEnvelope
    }
```

An accepted command result returns only identities, resulting versions, and
the minimal workflow-specific value declared below; authoritative display data
arrives through Projection Events or a snapshot. A rejected result never
contains `value`.

`EntityRef` is `{ entityType, entityId, version }`. `ArtifactRef` is an opaque
private artifact identity plus media type, byte count, checksum, and sanitized
display label; it never contains an absolute path. `PageRequest` is
`{ cursor: Id|null, limit: 1..100 }`; `Page<T>` is
`{ items: T[], nextCursor: Id|null, asOfSequence }`. `Decision` is
`{ decision: "approve"|"deny", rationale: string|null }`. Each proposal-specific
decision narrows those values where required. Raw secret values, credential
values, environment values, access tokens, and authority booleans asserted
without a referenced proposal or review identity are invalid everywhere.

### Handshake, reconstruction, and ordering

The only pre-binding Webview message is `protocol.hello`:

```text
{
  kind: "protocol.hello",
  webviewInstanceId: Id,
  webviewRelease: SemVer,
  supportedProtocolVersions: [positive integer, ...],
  bootstrapNonce: Id
}
```

The host accepts it only for the instance and nonce it created for that panel.
It replies with exactly one of:

- `protocol.welcome` — selected version, catalog revision, host release,
  Webview Instance, opaque workspace identity, Presentation Stream identity,
  current compatibility disposition, and an Authoritative Snapshot;
- `protocol.reload-required` — stable reason
  `release-mismatch|protocol-mismatch|instance-superseded`, the host release,
  supported version, and no operational data; or
- `protocol.unavailable` — stable reason
  `workspace-unsupported|compatibility-checking|fatal-bootstrap-error` and a
  sanitized Error Envelope.

`protocol.reload-required` and `protocol.unavailable` expose no command route.
Changing the Webview Instance, workspace, release, or selected protocol requires
a new handshake.

The snapshot is `workbench.snapshot.v1` and contains:

```text
{
  snapshotId, workspaceId, streamId, throughSequence, generatedAt,
  compatibility,
  tasks: { entities, contracts, dependencies, graphRevisions, attempts,
           operations, checkpoints, blockers, queue, activeTaskSlot,
           repositoryWriteLock },
  chats: { sessions, turns, attempts, visibleOutput, summaries, ledger,
           contextPins, approvals, operationRefs, trash },
  agents: { catalog, eligibility, proposals, routingInterventions },
  resources: { agents, skills, tools, mcpServers, models, snapshots,
               validationDiagnostics, interactionRequests },
  authority: { reviews, grants, denials, linkedRoots, operationBarriers },
  memory: { project, personal, provenanceSummaries, conflicts, suggestions,
            proposals, privacyDisposition },
  attention: { requests, terminalOutcomes, unresolvedCount },
  diagnostics: { health, incidents, retention, supportBundlePreviews },
  activity: { latestItems, continuationCursor },
  settings
}
```

Content-bearing transcript, Memory, artifact, audit-input, and diagnostic
details are paged by queries; the snapshot carries bounded summaries and stable
references sufficient to render every area and discover those pages.

Every post-snapshot host message is either a result, a control message, or an
ordered Projection Event:

```text
ProjectionEvent<TName, TPayload> = {
  protocolVersion: 1, kind: "event", name: TName,
  eventId: Id, streamId: Id, sequence: positive integer,
  transactionId: Id, transactionSequence: nonnegative integer,
  aggregate: { aggregateType, aggregateId, sourceVersion, resultingVersion },
  correlationId: Id, causationId: Id, emittedAt: Timestamp,
  payload: TPayload
}
```

`sequence` is a gapless order over committed presentation changes in one
Presentation Stream. Events from one transaction are adjacent and ordered by
`transactionSequence`. Delivery may duplicate but never reorder. The Webview
applies only `throughSequence + 1`, ignores an exact duplicate
`(streamId, sequence, eventId)`, and requests resubscription on any gap or
identity collision. The host persists Chat output before emitting bounded
`chat.output-appended` events, so partial visible output reconstructs.

`protocol.resubscribe` carries the bound instance, `streamId`, and
`lastAppliedSequence`. `protocol.events` returns the next contiguous batch and
its inclusive end. `protocol.resnapshot-required` is returned when the stream
changed, the requested sequence is ahead, retained projection events no longer
cover the gap, or an event identity conflicts. The Webview then issues
`workbench.snapshot.get`, atomically replaces every authoritative slice, and
resumes after its `throughSequence`. It never merges an old snapshot into a new
stream.

### Query catalog

The following are the complete side-effect-free query identities. Payload and
accepted result value are shown as `payload → value`. Every detail query takes
an `EntityRef`; every list query takes its documented filter plus `PageRequest`.

| Query | Payload → accepted value |
| --- | --- |
| `workbench.snapshot.get` | `{}` → `AuthoritativeSnapshot` |
| `task.list` | `{ states?, PageRequest }` → `Page<TaskSummary>` |
| `task.get` | `{ task: EntityRef }` → `TaskDetail` |
| `task.activity.list` | `{ task: EntityRef, PageRequest }` → `Page<ActivityItem>` |
| `chat.list` | `{ location:"active"|"trash", text?, PageRequest }` → `Page<ChatSummary>` |
| `chat.get` | `{ chat: EntityRef }` → `ChatDetail` |
| `chat.transcript.list` | `{ chat: EntityRef, PageRequest }` → `Page<TranscriptItem>` |
| `chat.provenance.get` | `{ chat: EntityRef, item: EntityRef }` → `ChatProvenanceDetail` |
| `agent.list` | `{ availability?, PageRequest }` → `Page<AgentSummary>` |
| `agent.get` | `{ agentIdentity }` → `AgentDetail` |
| `resource.list` | `{ resourceKind, status?, PageRequest }` → `Page<ResourceSummary>` |
| `resource.get` | `{ resourceKind, resourceName }` → `ResourceDetail` |
| `model.list` | `{ capability?, PageRequest }` → `Page<ModelSummary>` |
| `memory.list` | `{ scope?, status?, text?, PageRequest }` → `Page<MemorySummary>` |
| `memory.get` | `{ scope, memoryId, version? }` → `MemoryDetail` |
| `activity.list` | `{ severity?, entity?, PageRequest }` → `Page<ActivityItem>` |
| `attention.list` | `{ status?, PageRequest }` → `Page<AttentionRequest>` |
| `diagnostics.health.get` | `{}` → `HealthSnapshot` |
| `diagnostics.incident.list` | `{ status?, PageRequest }` → `Page<IncidentSummary>` |
| `diagnostics.incident.get` | `{ incident: EntityRef }` → `IncidentDetail` |
| `diagnostics.support-bundle.get-preview` | `{ preview: EntityRef }` → `SupportBundlePreview` |
| `settings.get` | `{}` → `Settings` |

Queries observe one committed read snapshot, never run health checks, discovery,
recovery, migration, reconciliation, filesystem edits, prompts, authentication,
or notification effects.

### Command catalog

The following are the complete user/application command identities. A payload
ending in `expected …` requires those aggregates in the envelope. `EntityRef`
payload members are identity hints; the envelope remains the concurrency guard.

| Area | Command | Required payload → accepted value |
| --- | --- | --- |
| Task | `task.admission.start` | `{ draft: TaskContractDraft }`, expected Task absent → `{ task, contractDraft }` |
| Task | `task.dependency.resolve` | `{ request: EntityRef, decision, rationale }`, expected Task and request → `{ task }` |
| Task | `task.contract.confirm` | `{ task, contractVersion, confirmationHash }`, expected Task and contract → `{ task }` |
| Task | `task.queued.edit` | `{ task }`, expected Task → `{ task, contractDraft }` |
| Task | `task.queue.reorder` | `{ orderedTaskIds }`, expected queue and every moved Task → `{ queue }` |
| Task | `task.pause` | `{ task }`, expected Task → `{ task }` |
| Task | `task.resume` | `{ task }`, expected Task → `{ task }` |
| Task | `task.cancel` | `{ task, confirmationHash? }`, expected Task → `{ task }` |
| Task | `task.force-stop` | `{ task, confirmationHash }`, expected Task and quiescence disposition → `{ task }` |
| Task | `task.amendment.confirm` | `{ task, amendmentVersion, confirmationHash }`, expected Task, contract, amendment → `{ task }` |
| Task | `task.routing.resolve` | `{ intervention, resolution:"approve-proposal"|"manual-agent"|"cancel", proposalVersion?, agentIdentity?, confirmationHash? }`, expected Task, Subtask, intervention, and proposal when used → `{ task, subtask }` |
| Task | `task.repair-intervention.apply` | `{ task, blocker, evidence, confirmationHash? }`, expected Task and blocker → `{ task }` |
| Task | `task.reactivation.retry` | `{ task, blocker }`, expected Task and blocker → `{ task }` |
| Task | `task.terminal-outcome.acknowledge` | `{ outcome: EntityRef }`, expected outcome → `{ outcome }` |
| Chat | `chat.session.create` | `{ agentIdentity, requestedModelId? }`, expected Chat absent → `{ chat }` |
| Chat | `chat.turn.send` | `{ chat, clientTurnId, content, requestedModelId?, pinnedContextIds }`, expected Chat → `{ chat, turn, responseAttempt }` |
| Chat | `chat.attempt.cancel` | `{ attempt: EntityRef }`, expected Chat and Response Attempt → `{ attempt }` |
| Chat | `chat.attempt.retry` | `{ attempt: EntityRef, requestedModelId?, includePartialOutput:false }`, expected Chat and terminal Response Attempt → `{ responseAttempt }` |
| Chat | `chat.session.fork` | `{ chat, throughItem, requestedModelId? }`, expected source Chat/item and new Chat absent → `{ chat }` |
| Chat | `chat.session.handoff` | `{ chat, throughItem, targetAgentIdentity, requestedModelId? }`, expected source Chat/item and new Chat absent → `{ chat }` |
| Chat | `chat.session.trash` | `{ chat }`, expected Chat → `{ chat }` |
| Chat | `chat.session.restore` | `{ chat }`, expected Chat → `{ chat }` |
| Chat | `chat.session.delete-permanently` | `{ chat, confirmationHash }`, expected Chat and retention disposition → `{ deletedChatId }` |
| Chat | `chat.summary.generate` | `{ chat, throughItem? }`, expected Chat and active summary → `{ summaryAttempt }` |
| Chat | `chat.ledger.correct` | `{ chat, entry, replacement, rationale }`, expected Chat and Ledger entry → `{ ledgerEntry }` |
| Chat | `chat.context-pin.add` | `{ chat, contextRef }`, expected Chat → `{ contextPin }` |
| Chat | `chat.context-pin.remove` | `{ chat, contextPin }`, expected Chat and pin → `{ chat }` |
| Chat | `chat.approval.resolve` | `{ approval, decision:"approve-once"|"approve-session"|"deny", confirmationHash? }`, expected Chat, Response Attempt, approval, authority review → `{ attempt }` |
| Chat | `chat.privacy-redaction.execute` | `{ chat, targets, confirmationHash }`, expected Chat and every target → `{ redactionOperation }` |
| Agent | `agent.proposal.resolve` | `{ proposal, decision:"approve"|"approve-edited"|"reject", editedDefinition?, confirmationHash? }`, expected proposal and target Agent when present → `{ proposal, agentIdentity? }` |
| Agent | `agent.update-proposal.resolve` | `{ proposal, decision:"approve"|"approve-edited"|"reject", editedDefinition?, confirmationHash? }`, expected proposal and Agent → `{ proposal, agentIdentity }` |
| Agent | `agent.source.open` | `{ agentIdentity }` → `{ opened:true }` |
| Resource | `resource.discovery.refresh` | `{ resourceKinds }` → `{ refreshId }` |
| Resource | `resource.source.open` | `{ resourceKind, resourceName }` → `{ opened:true }` |
| Resource | `resource.personal-memory-ignore.apply` | `{ proposal, confirmationHash }`, expected privacy disposition and proposal → `{ operation }` |
| MCP | `mcp.server.trust.resolve` | `{ server, fingerprint, decision:"trust"|"deny" }`, expected server and trust request → `{ server }` |
| MCP | `mcp.interaction.submit` | `{ request, valueRef }`, expected interaction request → `{ request }` |
| MCP | `mcp.interaction.cancel` | `{ request }`, expected interaction request → `{ request }` |
| MCP | `mcp.oauth.start` | `{ request, server }`, expected interaction request and server → `{ authorizationAttempt }` |
| Authority | `authority.chat-auto-review.resolve` | `{ review, decision, selectedScopes, acknowledgementHash }`, expected Chat and review → `{ review }` |
| Authority | `authority.linked-root.resolve` | `{ proposal, decision, canonicalTargetFingerprint, acknowledgementHash? }`, expected proposal and boundary → `{ linkedRoot? }` |
| Authority | `authority.operation-reconciliation.start` | `{ operation, evidence? }`, expected operation and barrier → `{ operation }` |
| Memory | `memory.promotion.start` | `{ sourceRefs }` → `{ proposalAttempt }` |
| Memory | `memory.proposal.resolve` | `{ proposal, decision:"confirm"|"reject", confirmationHash? }`, expected proposal, targets, sources, privacy disposition, and repository baseline → `{ proposal, operation? }` |
| Memory | `memory.conflict.propose-resolution` | `{ conflict, resolutionIntent }`, expected conflict and Memories → `{ proposalAttempt }` |
| Attention | `attention.resolve` | `{ request, resolutionCode }`, expected request and owning aggregate → `{ request }` |
| Attention | `attention.dismiss-outcome` | `{ outcome }`, expected outcome → `{ outcome }` |
| Diagnostics | `diagnostics.health.run` | `{ categories? }` → `{ runId }` |
| Diagnostics | `diagnostics.clear` | `{ scope:"ordinary"|"resolved-pinned", confirmationHash? }`, expected retention disposition → `{ clearOperation }` |
| Diagnostics | `diagnostics.support-bundle.preview` | `{ incidentIds, includeOptionalContent:false }` → `{ preview }` |
| Diagnostics | `diagnostics.support-bundle.create` | `{ preview, optionalContentSelections, destinationRef, confirmationHash }`, expected preview and every selected source version → `{ bundleOperation, artifact }` |
| Diagnostics | `diagnostics.incident.acknowledge` | `{ incident }`, expected incident → `{ incident }` |
| Recovery | `recovery.run.retry` | `{ incident }`, expected incident and compatibility/recovery disposition → `{ recoveryRun }` |
| Recovery | `compatibility.migration.retry` | `{ gate, confirmationHash }`, expected gate and live database identity → `{ migrationAttempt }` |
| Recovery | `compatibility.backup.restore` | `{ gate, backup, confirmationHash }`, expected gate, backup, and live database identity → `{ recoveryOperation }` |
| Recovery | `compatibility.database.create-fresh` | `{ gate, confirmationText }`, expected gate and live database identity → `{ recoveryOperation }` |
| Recovery | `compatibility.recheck` | `{ gate }`, expected gate → `{ compatibilityCheck }` |
| Settings | `settings.update` | `{ patch, baseSettingsVersion }`, expected Settings → `{ settings }` |
| Settings | `settings.reset` | `{ confirmationHash }`, expected Settings → `{ settings }` |
| Settings | `workbench.data.reset` | `{ confirmationText, repositoryIdentityHash }`, expected compatibility gate and reset disposition → `{ resetOperation }` |

Task-contract editing before confirmation uses `task.contract.confirm` over the
latest host-produced draft; free-form field edits are presentation input to the
next draft proposal, not piecemeal authoritative commands. Agent, Memory,
authority, linked-root, Support Bundle, and reset commands authorize only the
referenced versioned proposal and exact confirmation hash. `destinationRef` and
MCP `valueRef` are opaque host-issued handles obtained through native VS Code
UI; paths and secret/input values never cross this protocol.

Area switching, search-text editing, disclosure state, focus, scroll, composer
drafts, and canceling an unsubmitted dialog are Webview presentation actions
and emit no application request. The sidebar and Command Palette open/focus
actions are extension commands that call the same application interfaces
directly and are outside the Webview Protocol.

### Projection Event catalog

Every lifecycle Projection Event uses the exact Domain Transition Event identity
fixed by [Define exhaustive Runtime lifecycle transition contracts](WF-019-define-lifecycle-transition-contracts.md):

```text
active-task-slot.acquired
active-task-slot.released
assignment-capacity.reserved
assignment-capacity.released
assignment.selected
assignment.started
assignment.succeeded
assignment.declined
assignment.failed
assignment.interrupted
assignment.outcome-became-unknown
assignment.cancelled
chat-mutation-capacity.reserved
chat-mutation-capacity.released
compatibility.check-started
compatibility.established
compatibility.migration-required
compatibility.migration-started
compatibility.newer-schema-refused
compatibility.recovery-required
compatibility.recheck-requested
migration.preparation-started
migration.backup-started
migration.application-started
migration.verification-started
migration.reopen-started
migration.succeeded
migration.failed
migration.interrupted
operation-barrier.created
operation-barrier.removed
operation.intent-recorded
operation.started
operation.succeeded
operation.retry-scheduled
operation.failed
operation.cancelled
operation.reconciliation-started
operation.reconciliation-resumed
operation.application-established
operation.outcome-became-unknown
recovery-run.started
recovery-run.completed
repository-write-lock.acquired
repository-write-lock.released
response.preparation-started
response.started
response.approval-requested
response.approval-resolved
response.succeeded
response.blocked
response.failed
response.cancelled
response.interrupted
subtask.created
subtask.ready
subtask.execution-started
subtask.routing-requested
subtask.routing-resolved
subtask.succeeded
subtask.failed
subtask.superseded
subtask.cancelled
task.admission-started
task.dependency-confirmation-requested
task.dependency-confirmation-resolved
task.admitted
task.readmission-started
task.preparation-started
task.execution-started
task.quiescence-started
task.cancelled
task.recovery-started
task.recovery-progressed
task.recovery-disposition-changed
task.recovered
task.blocked
task.resumed
task.contract-amended
task.routing-resolved
task.dependency-confirmation-wait-started
task.unblocked
task.repair-intervention-accepted
task.paused
task.verification-started
task.repair-cycle-started
task.failed
task.routing-wait-started
task.succeeded
```

Their payload is the closed `LifecycleTransition` schema:
`{ sourceState, destinationState, reasonCode?, dispositionCode?,
checkpointRef?, activeTaskSlotRef?, repositoryWriteLockRef?,
assignmentCapacityRef?, operationRef?, operationBarrierRef?, recoveryRunRef?,
migrationAttemptRef? }`. Required references are selected per the normative
transition row in that ticket; irrelevant members are absent, not `null`.

The remaining presentation-relevant committed facts have these stable event
identities and closed payload families:

| Slice | Projection Events |
| --- | --- |
| Task | `task.contract-draft-changed`, `task.queue-reordered`, `task.graph-revised`, `task.checkpoint-recorded`, `task.output-appended`, `task.blocker-changed`, `task.terminal-outcome-seen` |
| Chat | `chat.session-created`, `chat.session-trashed`, `chat.session-restored`, `chat.session-deleted`, `chat.turn-submitted`, `chat.output-appended`, `chat.summary-created`, `chat.ledger-entry-changed`, `chat.context-pin-changed`, `chat.privacy-redacted` |
| Agent/routing | `agent.catalog-changed`, `agent.eligibility-changed`, `agent.proposal-created`, `agent.proposal-resolved`, `agent.routing-evidence-changed` |
| Resources/MCP | `resource.catalog-changed`, `resource.validation-changed`, `resource.snapshot-pinned`, `resource.interaction-requested`, `resource.interaction-resolved`, `resource.trust-changed` |
| Authority | `authority.review-requested`, `authority.review-resolved`, `authority.grant-changed`, `authority.linked-root-changed` |
| Memory | `memory.catalog-changed`, `memory.promotion-suggested`, `memory.proposal-created`, `memory.proposal-resolved`, `memory.conflict-changed`, `memory.provenance-changed`, `memory.privacy-disposition-changed` |
| Attention | `attention.requested`, `attention.updated`, `attention.resolved`, `attention.terminal-outcome-seen` |
| Diagnostics | `diagnostics.event-appended`, `diagnostics.health-changed`, `diagnostics.incident-opened`, `diagnostics.incident-updated`, `diagnostics.incident-resolved`, `diagnostics.retention-changed`, `diagnostics.support-bundle-previewed`, `diagnostics.support-bundle-created` |
| Settings/reset | `settings.changed`, `workbench.data-reset` |

Each non-lifecycle payload is exactly one of:

- `EntityChanged`: `{ entity: EntityRef, change:
  "created"|"updated"|"removed", summary? }`;
- `CollectionChanged`: `{ collection, added: EntityRef[], updated:
  EntityRef[], removedIds: Id[] }`;
- `ContentAppended`: `{ owner: EntityRef, contentRef: EntityRef,
  ordinal, textChunk? }`, where `textChunk` is sanitized, persisted display
  output only and is absent for sensitive or artifact-backed content;
- `ProposalChanged`: `{ proposal: EntityRef, owner: EntityRef,
  disposition, summary }`;
- `AttentionChanged`: `{ request: EntityRef, owner: EntityRef, status,
  version, noticeSummary }`; or
- `ProjectionInvalidated`: `{ slices[], reasonCode }`, which requires the next
  contiguous event or snapshot to carry replacements and never tells the
  Webview to infer state.

The catalog binds each event above to one of those payload schemas and the
single snapshot slice it advances. A Domain Transition Event is never renamed,
collapsed into generic `state-changed`, or interpreted by Webview policy.

### Validation, rejection, duplication, and errors

Limits are evaluated before application dispatch: handshake 32 KiB; ordinary
request or result 1 MiB; Projection Event 1 MiB; snapshot 8 MiB; nesting depth
16; object members 128; arrays 1,000 unless a paged schema is tighter; identity
128 Unicode scalar values; ordinary string 16,384; submitted Chat content
262,144; persisted output event chunk 32,768. Larger content uses an
`ArtifactRef`. JSON duplicate keys, unpaired surrogates, non-finite numbers,
prototype-sensitive keys, malformed timestamps, unknown discriminators, and
unknown fields reject.

Processing is deterministic:

1. Decode within byte/depth limits.
2. Validate the pre-binding or bound envelope, protocol, release, instance, and
   request identity.
3. Select the exact discriminator schema and validate all fields and
   cross-field limits.
4. Authorize the named application route; the payload can only reference
   authority already held in host records.
5. Canonicalize and fingerprint the logical operation.
6. Resolve exact duplicate, identity collision, expected versions, lifecycle
   guards, and proposal/confirmation freshness.
7. Execute one application transaction or side-effect-free query.

An exact repeated `operationId` and canonical fingerprint returns the original
result, including its original resulting versions, without another state
change, event, audit record, notification, or external effect. Reuse with
different content rejects `operation-identity-conflict`. Repeated `requestId`
with different content rejects `request-identity-conflict`. A new operation
with stale expected versions rejects `stale-aggregate-version`. Stale or exact
duplicate lifecycle identities retain the more-specific behavior fixed in the
lifecycle contract.

Malformed, oversized, unknown-name, wrong-kind, protocol-mismatched,
release-mismatched, unbound, wrong-Webview, superseded-Webview, stale,
duplicate, identity-conflicting, unauthorized, and guard-rejected inputs cause
no application state change, Projection Event, notification, external effect,
authority grant, or secret read. The lifecycle contract's one sanitized,
deduplicated Rejection Record remains permitted after dispatch; protocol-level
failures before dispatch may only increment an in-memory rate-limit counter and
emit a redacted extension diagnostic with no raw payload.

`ErrorEnvelope` is:

```text
{
  code:
    "malformed-json" | "payload-too-large" | "schema-invalid" |
    "unknown-message" | "protocol-mismatch" | "release-mismatch" |
    "webview-unbound" | "webview-instance-mismatch" |
    "webview-instance-superseded" | "request-identity-conflict" |
    "operation-identity-conflict" | "stale-aggregate-version" |
    "invalid-transition" | "terminal-state" |
    <a stable guard/reason fixed by the lifecycle contract> |
    "authority-denied" | "not-found" | "temporarily-unavailable" |
    "internal-error",
  category: "validation"|"compatibility"|"concurrency"|"policy"|
            "availability"|"internal",
  message: sanitized localized display string,
  retry: "never"|"after-resnapshot"|"after-user-action"|"later",
  correlationId: Id,
  incidentId: Id | null,
  fieldErrors: [{ jsonPointer, code }] | null
}
```

It contains no stack, absolute path, repository content, prompt, Tool input,
credential metadata that reveals a secret, provider body, SQL, or raw exception.
`internal-error` always carries an Incident ID when the compatibility gate
permits durable incident creation.

### Contract-suite obligations

The schema catalog and adapter suite must prove, for every query, command,
result, snapshot, control message, and event:

- one valid minimum and maximum fixture and one invalid fixture for every
  required field, discriminator, bound, enum, unknown field, and secret-shaped
  value;
- exact fake/production agreement on accepted bytes, normalized value, returned
  error, and absence of side effects;
- handshake mismatch, wrong/superseded instance, resubscription gap, duplicate
  delivery, event collision, transaction ordering, and full reload
  reconstruction;
- exact duplicate command replay, request and operation identity collisions,
  stale versions, missing expected versions, stale confirmation hashes, and
  unknown message names;
- snapshot-plus-events equivalence with a fresh snapshot at every sequence
  boundary; and
- a coverage assertion that every Workbench control is bound to exactly one
  catalog command/query or explicitly classified above as presentation-only,
  and every snapshot field is produced by at least one query or Projection
  Event.

This contract leaves domain decisions in the application layer, preserves all
lifecycle identities, and makes reload/reconnect a replacement-and-replay
operation rather than a recovery of Webview-owned state.
