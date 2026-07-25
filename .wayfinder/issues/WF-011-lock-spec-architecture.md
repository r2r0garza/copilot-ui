---
id: WF-011
title: Lock the MVP architecture and specification acceptance contract
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-007
  - WF-008
  - WF-009
  - WF-010
  - WF-012
  - WF-014
---

## Question

Which extension-host components, webview boundaries, storage adapters, domain
services, orchestration interfaces, recovery guarantees, test seams, scaffold
layout, and acceptance scenarios must the final MVP specification prescribe so a
builder can implement it without reopening product or architecture decisions?

## Resolution

### Application boundary

The MVP is one feature-oriented TypeScript modular monolith running in the VS
Code extension host. Its Workbench Webview is a fully interactive presentation
client: users conduct Chat, submit and control Tasks, review authority, resolve
interventions, manage resources and Memory, and change settings through it. The
Webview may retain ephemeral presentation state, but owns no authoritative
domain or durable execution state.

The Webview and extension host communicate only through the versioned, validated
Workbench Protocol. Commands flow into the host and authoritative state and
events flow back. Reloading or replacing the Webview reconstructs its view from
extension-host state.

### Host components and dependency direction

The extension host contains:

- one composition root at the VS Code extension entry point;
- a protocol gateway for Workbench commands, events, validation, and
  compatibility;
- an application layer that coordinates commands, queries, transactions, and
  cross-feature workflows;
- feature modules for Tasks, Chats, Agents, Agent Resources, execution
  authority, Memory, and attention;
- the Workbench Runtime policy kernel for lifecycle invariants, scheduling,
  authority enforcement, durable operations, and recovery;
- ports describing external capabilities; and
- adapters for SQLite, `vscode.lm`, repository and Git access, Workbench and
  extension Tools, MCP, SecretStorage, and VS Code notifications.

Each feature owns its domain model, commands, queries, and events. Cross-feature
coordination uses declared application interfaces rather than imports of
another feature's internals. The Webview may share Workbench Protocol types but
cannot import Runtime or domain code.

### Persistence boundary

Each VS Code workspace has one extension-owned operational SQLite database
beneath its workspace-specific `ExtensionContext.storageUri`. It stores Tasks,
Chat Sessions, attempts, checkpoints, approvals, audit and operation records,
private Memory provenance, migrations, and recovery metadata. Accepted commands
commit their authoritative state change and corresponding durable event or
audit record transactionally.

Repository files contain only portable project resources in their previously
decided native locations. `workspaceState` is limited to small UI metadata.
Truly user-global preferences, if any, use VS Code global settings or state.
Credentials remain in SecretStorage and are referenced rather than copied into
SQLite.

### Orchestration authority

Agents retain autonomous reasoning and orchestration judgment: they interpret
Goals, decompose and route work, select calls and arguments, react to results,
propose Task Graph Revisions, and assess apparent completion.

The Runtime is the deterministic policy and durability kernel. It validates
Agent choices against the Task Contract, lifecycle state, dependency graph,
Resource Snapshot, authority grants, locks, and operation history before
executing effects or committing transitions. Model output alone cannot grant
authority, mutate operational persistence, bypass lifecycle invariants, or
establish completion.

### Recovery guarantee

The product guarantees recovery to a known durable state, not continuation of
lost in-memory execution:

- incomplete SQLite transactions roll back and committed transactions remain
  authoritative;
- interrupted Chat Response Attempts retain completed records but do not resume
  model or Tool activity automatically;
- nonterminal Tasks reconstruct from their last Durable Checkpoint;
- recorded but unfinished operations are reconciled against repository or
  provider state before retry;
- repository state and external capabilities are revalidated before Task
  execution resumes;
- safe Tasks may resume automatically, while drift conflicts, missing
  authority, or uncertain outcomes become explicit blocked states; and
- completed effects are preserved, with no promise of rollback or exactly-once
  external mutation where a provider cannot prove idempotency.

### Required test seams

The architecture includes a headless Runtime harness that accepts the same
application commands as the Webview without launching VS Code or a browser.
Tests can replace time and identity generation, model streams, Tools,
filesystem and Git, MCP, SecretStorage, notifications, authority decisions,
user responses, and crash points.

Port contract tests apply to every adapter. Integration tests use the real
SQLite adapter with temporary databases to verify transactions, migrations,
and recovery. Webview tests cover protocol and interaction behavior without
duplicating domain rules, and VS Code end-to-end tests cover the assembled
extension.

### Prescribed scaffold

```text
src/
├── extension.ts
├── protocol/
├── runtime/
├── features/
│   ├── tasks/
│   ├── chats/
│   ├── agents/
│   ├── resources/
│   ├── execution-authority/
│   ├── memory/
│   └── attention/
├── ports/
├── adapters/
│   ├── sqlite/
│   ├── vscode-lm/
│   ├── repository/
│   ├── tools/
│   ├── mcp/
│   ├── secrets/
│   └── notifications/
└── webview/

tests/
├── unit/
├── contract/
├── integration/
├── scenarios/
└── e2e/
```

### Minimum acceptance scenarios

The final specification must prescribe and trace at least these end-to-end
scenarios:

1. Discover valid and invalid Agents, Skills, Memories, models, Tools, and MCP
   servers without one invalid resource disabling unrelated resources.
2. Start, persist, resume, fork, cancel, and trash a Chat Session with immutable
   Response Attempts.
3. Run a Chat Tool call through authority review, audit, completion, and
   uncertain-outcome reconciliation.
4. Admit a Task through confirmed Task Contract, Task Dependency, and authority
   review.
5. Execute a Task graph with parallel read-only Subtasks, serialized
   Write-capable Subtasks, routing, graph revision, and Completion Check.
6. Queue multiple Tasks while enforcing the single Active Task Slot and
   confirmed Task Dependencies.
7. Pause, restart VS Code, recover, perform Repository Reactivation, and safely
   resume a Task.
8. Crash at every durable-intent, effect, and checkpoint boundary and prove a
   recoverable or explicitly blocked result without silent duplication.
9. Keep Chat interactive but repository-read-only while a Task owns the
   Repository Write Lock.
10. Handle Repository Drift, missing authority, unavailable models, MCP
    failure, and Unknown Operation Outcomes with the specified recovery or
    intervention state.
11. Promote, retrieve, conflict, consolidate, and recover Memory only through
    exact user-confirmed proposals.
12. Complete every core flow keyboard-only with correct focus, announcements,
    Attention Requests, badges, and notification deduplication.
13. Upgrade an older SQLite schema without history loss and reject or safely
    recover from an unsupported or failed migration.
14. Reload the Webview at any point and reconstruct the same authoritative state
    from the extension host.

### Final specification package

One canonical, navigable MVP specification is the source of truth. It includes
scope and invariants; glossary references; component and dependency diagrams;
feature, port, and adapter responsibilities; versioned Workbench Protocol
contracts; the logical SQLite schema, transaction boundaries, migration policy,
and recovery rules; lifecycle transition tables; orchestration and recovery
sequences; scaffold and dependency rules; security enforcement points; explicit
non-goals; and traceability from the acceptance scenarios to components and
invariants.

Machine-verifiable schemas and scenario fixtures may live in linked
version-controlled companion files.

The clarified domain language is recorded in
[CONTEXT.md](../../CONTEXT.md).
