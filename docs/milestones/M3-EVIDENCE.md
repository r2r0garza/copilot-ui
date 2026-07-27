# M3 — Autonomous Task Happy Path

Milestone 3 implements one confirmed, routed, success-only autonomous Task path
through the production `TaskService` and workspace SQLite adapter.

## Traceability

| Issues | Requirements / checks | Production evidence | Automated evidence |
| --- | --- | --- | --- |
| #45–#46 | NR-TASK-001, AS-04 | `src/features/tasks/index.ts`: normalized Task Contract capture, immutable version hash, exact confirmation, and queue gate; `src/adapters/sqlite/workspaceStore.ts`: append-only durable Task snapshots | `AS-04 captures, versions, and confirms the exact Task Contract before queue admission` |
| #47–#50 | NR-ROUTE-001–005, VC-ROUTE-001 | Hard eligibility precedes semantic assessments; deterministic specificity/resource/origin/identity tie-breaks; immutable candidate, snapshot, rationale, override, decline, and reroute records | `VC-ROUTE-001 filters hard eligibility...`, `capability gaps wait...`, and `Capability Decline preserves history...` |
| #51 | NR-TASK-004, AS-05 | Versioned graph revisions validate the confirmed Repository Boundary, reject cycles, unlock only success dependencies, and preserve running/terminal history | `AS-05 preserves an acyclic success-only DAG...` |
| #52 | NR-TASK-005, AS-05 | Selection reserves capacity for at most three nonterminal Assignment Attempts and at most one Write-capable attempt | `AS-05 preserves an acyclic success-only DAG...` |
| #53 | NR-TASK-006, AS-05 | The active Task owns the Repository Write Lock while running/verifying, releases it while waiting or blocked, and releases lock and slot on success | M3 AS-05 tests plus the existing `keeps Chat read-only and interactive while a Task owns the Repository Write Lock` test |
| #54 | NR-TASK-011, AS-05 | Completion requires successful required Subtasks and resolved dependencies, operations, and attempts; concrete gaps append repair revisions; the third unsuccessful check waits for intervention | `completion requires resolved work...` and `three unsuccessful completion repairs stop for intervention...` |

The production composition root exposes the durable service as
`Runtime.tasks`; callers without workspace storage use the same domain service
with an in-memory adapter for deterministic headless tests.

## Demonstration

Run:

```sh
npm run verify
```

Observed milestone scenarios:

1. AS-04 keeps a Task in `admitting` until the current contract version and its
   SHA-256 confirmation hash match, then persists `task.admitted` and enters
   `queued`.
2. AS-05 starts the confirmed Task, chooses only a hard-eligible Agent, records
   the candidate set, rationale, and immutable Resource Snapshot, and reserves
   Assignment capacity.
3. Two independent read attempts can coexist with one writer; a fourth attempt
   and a second writer are rejected.
4. A valid graph revision is appended, a cyclic revision is side-effect-free,
   and completed Subtask history cannot be superseded.
5. The first failed Completion Check appends a repair Subtask; after that repair
   succeeds, the next check completes the Task and releases the lock and slot.
6. A third unsuccessful repair check instead enters `externally-blocked`,
   releases the Repository Write Lock, and retains the Active Task Slot for
   user intervention.
