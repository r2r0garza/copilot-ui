---
id: WF-009
title: Define the repo-confined execution boundary
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-004
  - WF-005
---

## Question

What tool mediation, path validation, command policy, MCP trust model, Git policy,
resource limits, audit trail, and failure behavior enforce repository-only local
execution consistently across interactive Chat mode and unattended Task mode?

## Resolution

### Honest boundary and Tool classification

`vscode.lm` supplies model inference, not the Native Agent Runtime or Copilot's
built-in Tool sandbox. Bridgit-UI therefore owns its Tool loop and separates Tool
origin from enforceability:

- A Repository-confined Tool is a structured Workbench Tool whose filesystem
  effects the Runtime can mediate inside the Repository Boundary.
- An Ambient Tool is any Workbench, Extension, or MCP Tool whose possible
  effects cannot be technically confined by Bridgit-UI. Arbitrary commands are
  always ambient.
- The Repository Boundary consists of the canonical primary repository plus
  explicitly Approved Linked Roots. A linked root grant is bound to both the
  repository-relative symlink or junction and its canonical target. Retargeting
  invalidates it, and a Task's linked-root set is fixed at admission.

Repository-confined Tool inputs use repository-relative paths. The Runtime
rejects absolute, drive-relative, UNC, device, and parent-traversal paths;
canonicalizes every existing target; and validates both source and destination
for moves. Reads may follow a symlink or junction only when its canonical target
is inside the Repository Boundary. Writes, creates, renames, and deletes do not
traverse unapproved reparse points. For an Approved Linked Root, the Runtime
maps the approved repository-relative link to its bound canonical root and
validates the remaining relative path beneath that root rather than trusting
the link during each write. Repository-confined Tools cannot create symlinks,
junctions, or hard links in the MVP.

### Authority scopes

Every Ambient Tool runs with the local VDI user's authority and requires an
Ambient Authority Grant. Grants never become global or permanent:

- Chat Ask mode offers One-time Tool Approval and Session Tool Approval.
- Chat Auto Mode requires a bounded session Authority Review, then runs covered
  calls without per-invocation prompts. Ungranted capabilities are unavailable,
  not approval checkpoints.
- Task authority is fixed in the confirmed Task Contract at admission. A Task
  never pauses mid-execution to request broader authority.

The mandatory Authority Review discloses the Repository Boundary and linked
roots, command and shell authority, providers, effect classes, and material
risks. Deny is the default and Arbitrary Shell Authority requires a separate
affirmative choice. The acknowledgement is:

> These operations run with your local user permissions. Bridgit-UI cannot
> sandbox any tools or guarantee rollbacks. You are authorizing their effects
> for this Task/Chat Session.

For Task external access, the user makes one admission-time Allow or Deny
decision. Allow is intentionally broad: it covers every external Tool and
network capability exposed by the Task's already trusted, Agent-eligible
resources, including uses not predicted by the initial plan. Deny prevents
admission when external capability is required. Resources installed,
reconfigured, or newly trusted afterward remain outside the running Task.

### Commands, Git, Extension Tools, and MCP

Direct commands use Command Family Grants bound to one executable and bounded
argument family. A repository script remains ambient. Approval of one
subcommand never implies authority for the executable as a whole. PowerShell,
`cmd.exe`, and arbitrary command composition require distinct Arbitrary Shell
Authority.

Structured Git observation is available without general Git mutation. Local
staging and commits require explicit Local Commit Authority in the Task
Contract. Branch switching, stashing, history rewriting, destructive cleanup,
remote changes, pushing, and publishing remain prohibited. Safe Git operations
must not implicitly execute hooks, signing programs, credential helpers, or
external diff drivers.

MCP Server Trust is bound to an exact configuration fingerprint: transport,
executable or endpoint, arguments, and non-secret environment shape. It may
persist for the workspace but authorizes no MCP Tool. Tool authority remains
separate. Extension Tool authority is bound to the providing extension identity
and version, Tool identity, and input-schema fingerprint. Material changes
require reconfirmation at the next Resource Snapshot boundary.

### Chat and Task interaction

The Repository Write Lock overrides Chat approval. While a Task holds it, Chat
cannot invoke Repository-confined write Tools or Ambient Tools that may mutate
the repository or have opaque effects, even in Chat Auto Mode. Proven read-only
or remote-only Tools may remain available.

A Tool request outside the Repository Boundary or current grant returns a
side-effect-free Tool Policy Denial containing the violated rule and available
alternatives. The Agent receives the denial and may replan. After three
materially equivalent denials, Chat completes with the limitation. A Task that
cannot meet its contract within its admission-time authority fails terminally
and releases the Active Task Slot. A failed Task never satisfies a Task
Dependency; dependent Tasks remain not ready while unrelated ready Tasks may
run.

### Secrets, audit, and failure

Execution is secret-minimized: secret values never enter model context, Tool
schemas, audit records, errors, or inherited command environments; MCP
authentication remains in VS Code SecretStorage; repository environment files
are not loaded implicitly; and credential-retrieval Tools are prohibited.
Authorized Ambient Tools may still independently use resources available to the
VDI user, which the Authority Review discloses.

Every requested Tool invocation, including policy denials, creates an immutable
Tool Audit Record linking its Agent and Chat/Task context, Resource Snapshot,
Operation Key, sanitized inputs, authority decision, timing, terminal outcome,
affected repository paths, declared endpoints, and sanitized result or private
artifact. Reconciliation appends evidence instead of rewriting history.

Mutating operations use an Operation Key and provider idempotency support where
available. After timeout or interruption, the Runtime reconciles repository or
external provider state before retrying. It retries only when it can prove the
prior mutation did not apply or the provider guarantees idempotency. Otherwise
it preserves an Unknown Operation Outcome and never blindly replays the
mutation.

Organization-controlled concurrency, time, output, process, retry, and
model-usage budgets are outside the MVP, as recorded in
[Set VDI-safe runtime resource budgets](WF-013-set-vdi-resource-budgets.md).
The lifecycle's existing concurrency and retry safety invariants still apply.

The shared terminology is recorded in [CONTEXT.md](../../CONTEXT.md).
