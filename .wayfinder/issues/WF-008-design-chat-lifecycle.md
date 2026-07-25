---
id: WF-008
title: Define the resumable chat-session lifecycle
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-002
  - WF-003
  - WF-005
---

## Question

What is the repository-scoped chat-session model for agent and model selection,
message/context persistence, continuation, branching or deletion, tool-call
records, memory use, cancellation, and the automatic read-only transition while a
Task-mode job owns the repository write lock?

## Resolution

### Session identity, creation, and selection

A Chat Session is an extension-owned, repository-workspace-scoped conversation
with one stable identity, one linear history, and one fixed Agent Identity. The
user must choose the Agent when creating a session; an empty session remains a
local draft and enters durable history only when its first user turn is
submitted. A session never changes Agents in place.

Model choice is session-local but may change between Response Attempts. The
initial requested selection follows the established precedence: an explicit
user selection, then the Agent's native model preference, then Workbench Auto.
While a Response Attempt is active, that session's model selector is disabled.
After the attempt completes, fails, or is cancelled, the user may select the
model for the next turn. Other idle sessions remain independently configurable.

Each Response Attempt pins and records an immutable Resource Snapshot containing
the exact Agent definition version, effective model, Skills, Tools, MCP
configuration, and relevant Memory versions used. A new attempt uses the latest
valid definition of the same Agent Identity. If that Agent becomes invalid or
unavailable, the session remains readable but Send is blocked; the Runtime never
substitutes a different Agent. A specifically selected model that becomes
unavailable likewise blocks Send with its classified reason until the user
chooses another model or Auto. Only Auto may resolve to different effective
models across attempts, and every effective model remains visible and recorded.

### Durable turns, attempts, and recovery

The Runtime commits a submitted user turn before making any external model or
Tool call. Authorization, availability, quota, or provider failure attaches a
blocked or failed Response Attempt to that durable turn rather than discarding
or duplicating the prompt. Retry always creates a new Response Attempt attached
to the same turn.

Every attempt durably records its lifecycle, effective resources, streamed
output, Tool calls, errors, cancellation, and terminal outcome. Each Tool call
has an expandable record containing the Tool identity, sanitized inputs,
permission decision, timing, result or error, affected artifacts, and observed
outcome. Large outputs are private linked artifacts. A retry never automatically
replays a completed Tool call; a new attempt must deliberately issue a new call.

Extension-host interruption never resumes Chat model or Tool activity
automatically. The submitted turn, completed Tool outcomes, completed output,
and any partial output are restored, and the unfinished attempt is marked
interrupted. Retry receives completed Tool results and resulting Session Ledger
entries as prior execution context, while unfinished assistant prose is excluded
from model context by default.

### Linear history, forks, and deletion

Established history is immutable. Editing an earlier user message or continuing
from an earlier point creates a new Conversation Fork linked to its origin.
Native Agent Handoff is a specialized Conversation Fork: it creates a new Chat
Session bound to the target Agent, carries context through the handoff point,
and leaves the originating session unchanged and resumable. The MVP does not
provide an in-session Agent switch or a general mutable conversation tree.

Ordinary deletion applies to a whole Chat Session. It first moves only that
session to recoverable Trash and never cascades to Conversation Forks. A
surviving fork shows a deleted-origin marker when necessary. Permanent deletion
requires explicit confirmation and removes that session's transcript,
summaries, ledger, Response and Tool records, and private artifacts. It does not
undo repository changes, delete promoted Memories, or remove surviving forks,
and the confirmation warns about those retained effects. A separate explicit,
audited privacy-redaction operation may remove sensitive individual content;
ordinary message editing or deletion never rewrites history.

### Context, summaries, and repository drift

The complete raw conversation is retained. When older history no longer fits a
model's context window, the Runtime uses a rolling, versioned Conversation
Summary plus recent unsummarized turns, the current Session Ledger, and
explicitly pinned context. Summary compaction may run as a visible preparation
step of a user-initiated Send when required, or from an explicit user action; it
never runs as an invisible post-response model call.

The first summary compresses an initial conversation segment. Each later summary
consumes the prior active summary, all subsequent relevant turns, and applicable
Session Ledger corrections. It supersedes the prior version for prompt
construction, so only the latest active summary is sent to the model. Raw turns
and all earlier summary versions remain inspectable provenance. Summaries are
immutable; a correction enters the Session Ledger and regeneration creates a
new summary version. A Conversation Fork reconstructs context only through its
fork point.

Before each Response Attempt, the Runtime observes the current repository
baseline and compares it with the prior attempt. A branch switch, user edit,
Task result, or other Repository Drift does not prevent continuing the same Chat
Session, but affected Session Ledger entries and artifact references become
potentially stale until revalidated. Historical Tool observations are never
silently treated as current repository truth.

### Session Ledger and Memory

Every Chat Session owns an inspectable Session Ledger distinct from both its
Conversation Summary and cross-session Memories. It holds structured,
provenance-linked facts, decisions, constraints, artifact references, and open
questions. Entries may be active, superseded, or disputed. Users may edit or
dispute entries, and explicit user corrections are authoritative; conflicting
new evidence is surfaced rather than silently overwriting an entry.

Ledger changes occur throughout the conversation rather than only during
compaction. User-stated facts and corrections commit with their submitted turn,
Tool-observed facts commit with the completed Tool result, and Agent-inferred
facts or decisions commit only after a successful Response Attempt. Cancelled or
interrupted partial assistant output contributes no inferred entries. Ledger
deltas are produced within the user-initiated Response Attempt, not by hidden
background model calls.

Each new attempt receives the latest validated Memory Index and records the
specific Memory versions it retrieves. Earlier attempts retain their original
provenance. Ledger entries never become Memories automatically. An explicit
request such as "remember this," or acceptance of a suggestion, invokes the
Memory Manager's Memory Promotion workflow. Ambiguous session-only, Project
Memory, or Personal Memory scope is clarified with the user. Before writing, the
Memory Manager previews the exact scope, title, retrieval description, tags,
and content for confirmation; the ledger then links to the resulting Memory.

### Cancellation, concurrency, and the Task write lock

Cancel requests termination of the model stream and active Tools. Partial
assistant output remains visible and marked cancelled; completed Tool records
and completed repository mutations remain intact. Nothing rolls back
automatically. An uncertain mutating operation receives an Unknown Operation
Outcome. Reconciliation rereads the affected files and repository state and
checks the intended postcondition, relevant Git state, and available Tool
receipts to classify it as applied, not applied, or still unknown. Related
writes cannot continue and the operation is never replayed blindly while its
outcome remains unknown.

Multiple Chat Sessions may have concurrent Response Attempts, with at most one
active attempt per session. Model-only and read-only activity may proceed
concurrently, but repository-mutating Chat Tool calls are serialized globally.

When a Task is ready to acquire the Repository Write Lock, it lets the one active
Chat mutation reach a safe completed boundary rather than cancelling it, then
acquires the lock. A pending approval for a Chat mutation has not begun work and
does not delay acquisition; that approval becomes unavailable with an
explanation. While the Task holds the lock, Chat remains available for
conversation and read-only Tools, displays the lock owner, and checks every Tool
at invocation so repository mutation is denied. Mutation-seeking prompts may
still be sent, but they execute read-only and are never queued for automatic
mutation after release. When the Task releases the lock, Chat mutation
capability returns automatically.

### Persistence boundary

The MVP requires one open single-folder workspace and stores sessions in the
versioned extension-owned SQLite database beneath that workspace's private
`ExtensionContext.storageUri`. Disposable UI state may use `workspaceState`.
Session data stays private and untracked. Because supported storage is scoped to
VS Code workspace identity, opening the same checkout through a different
workspace configuration may produce a separate history; cross-workspace
discovery, export, and merging are deferred.

The shared terminology is recorded in
[CONTEXT.md](../../CONTEXT.md).
