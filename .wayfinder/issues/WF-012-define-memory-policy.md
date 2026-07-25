---
id: WF-012
title: Define the memory lifecycle and conflict policy
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-007
  - WF-008
---

## Question

Within the fixed Memory schema, indexes, limits, sole-writer rule, and durable
Chat/Task execution contracts, when may the Memory Manager suggest explicit
Memory Promotion from a Session Ledger or Task result, how does it preview and
confirm scope and exact content, validate provenance and staleness, resolve
Personal-versus-Project conflicts, retrieve and rank content, consolidate
entries, and commit or reject durable memory changes without automatic
promotion?

## Resolution

### Suggestion and initiation

Memory never promotes automatically. An explicit user request such as
“remember this” may initiate Memory Promotion immediately. The Memory Manager
may otherwise show a Memory Promotion Suggestion only after a successful
Response Attempt or successful Task completion contains durable, reusable
knowledge likely to matter beyond that Session or Task.

Suggestions are visible parts of those lifecycle boundaries, not hidden
background model calls. Partial, cancelled, failed, disputed, stale, or
unverified content cannot produce a suggestion.

### Scope

Project Memory holds repository facts, conventions, architecture decisions, and
team-relevant workflows that should travel through Git. Personal Memory holds
the current user's preferences, habits, and repository-specific working context
that must remain untracked.

The Memory Manager never silently infers an ambiguous scope. When source content
appears to mix scopes, it asks whether the intended Memory is Project-only,
Personal-only, or genuinely both. Only an explicit “both” answer produces two
separate Memory Change Proposals.

### Exact proposal and confirmation

Before any durable change, the Memory Manager presents one atomic Memory Change
Proposal containing:

- the create, update, consolidation, or removal operation;
- the target scope and scope-qualified Memory identity;
- the exact final title, retrieval description, tags, and Markdown content;
- source links and provenance plus any staleness, conflict, or validation
  warnings; and
- for an update, consolidation, or removal, a clear before-and-after diff.

Confirmation authorizes only that exact proposal. Any material revision after
validation requires a fresh preview and confirmation. Rejection or cancellation
writes nothing.

### Provenance and staleness

Every proposed claim must trace to an authoritative user statement or
correction, a completed Tool observation, a successful Response Attempt's
validated Session Ledger entry, or a successfully verified Task result.
Agent inference alone is insufficient unless its supporting evidence is
traceable.

Repository-dependent claims are reread against the current repository at
proposal time. Disputed, superseded, missing, or contradicted evidence blocks
promotion. Potentially stale evidence must be revalidated or presented for an
explicit user correction.

The Runtime stores Memory Provenance for each Memory version in extension-owned
private durable records, preserving the fixed Memory-file schema. A portable
Memory whose private provenance is unavailable after cloning or changing
workspace identity remains discoverable repository content, but its claims are
marked unverified until current evidence corroborates them and are never
silently presented as validated fact.

### Personal and Project conflicts

Neither scope has blanket priority. Project Memory governs shared repository
facts, constraints, conventions, and architecture. Personal Memory governs the
user's preferences and habits but cannot override a Project constraint.
Compatible guidance may be combined.

The Runtime surfaces a detected Memory Conflict proactively during Memory
validation or as soon as a proposed or imported change exposes it; it does not
wait for a later Chat or Task to encounter the contradiction. Both
scope-qualified sources remain visible and are marked conflicted. Disputed
guidance is excluded from authoritative use until the user resolves it through
a Memory Change Proposal, while unrelated Chat and Task work may continue.
Nothing is silently discarded, merged, or overwritten across scopes.

### Retrieval and ranking

An exact scope-qualified identity request ranks first. Other retrieval uses
hybrid lexical and semantic relevance over title, retrieval description, tags,
and content. Invalid and conflicted Memories are filtered before ranking;
missing provenance remains explicitly labeled rather than silently validated.

Ranking primarily reflects relevance to the current turn or Subtask, followed
by applicable scope and repository context. Freshness is only a tiebreaker
because an older architecture decision may remain authoritative. Neither
Personal nor Project scope receives blanket priority.

Results keep Personal and Project Memories in separately labeled groups with
scores or reasons under a small context budget. The Agent selects full contents
on demand, and the exact retrieved Memory versions are recorded in its immutable
Resource Snapshot.

### Consolidation and capacity

The Memory Manager may suggest consolidation when same-scope Memories
substantially duplicate or fragment one durable concept, or when consolidation
is necessary before creating a fifty-first active Memory. It never consolidates
across scopes. Every source must validate first; stale claims and unresolved
conflicts block consolidation.

One atomic proposal shows the exact surviving or new Memory and every source
Memory to remove. Supported meaning and provenance are preserved. Updating an
existing survivor retains its immutable `created-at`; a genuinely new identity
receives a new `created-at`.

Rejection leaves the prior set unchanged. At the 50-entry limit, a new promotion
is rejected unless the user approves a valid consolidation or removal; capacity
never authorizes automatic deletion.

### Agent and Runtime responsibilities

The protected Bundled Memory Manager is the memory-specific internal Agent. It
interprets candidate knowledge, asks scope and conflict questions, and prepares
Memory Change Proposals. A Repository Agent cannot replace or impersonate it.

Only the Workbench Runtime may execute a proposal through a structured Memory
Write Operation. The Agent receives no arbitrary direct Memory-file write
authority.

### Durable commit and recovery

Immediately before writing, the Runtime revalidates source and target versions,
the Personal Memory privacy rule, schema, capacity, repository state, and the
exact confirmation hash. Material drift invalidates confirmation and requires a
refreshed proposal.

Memory writes obey the Repository Write Lock. A proposal may remain visible
while a Task owns the lock, but it cannot be confirmed and queued for later
silent execution. After lock release it must be revalidated and explicitly
confirmed.

The Runtime records durable intent and an Operation Key, applies the exact file
replacement and provenance changes recoverably, then refreshes the Memory
registry. On interruption it reconciles actual files against the intended
postcondition before retrying and never blindly replays an uncertain mutation.
A rejected proposal retains only a minimal audit fact that it was declined,
without retaining rejected sensitive content.

The resulting shared domain language is recorded in
[CONTEXT.md](../../CONTEXT.md).
