---
id: WF-001
title: Chart the VS Code agent workbench specification
type: map
label: wayfinder:map
status: closed
assignee:
blocked_by: []
---

## Destination

Reach an implementation-ready MVP product and architecture specification that is
clear enough to scaffold and build a local-first VS Code extension with interactive
Chat mode and durable autonomous Task mode powered by `vscode.lm`.

## Notes

- The product is single-user, local-first, and scoped to the currently open Git
  repository plus explicitly approved linked repository roots. Git is the only
  sharing mechanism; no backend or synchronization service is planned.
- Both modes may use tools, skills, and MCP servers. Chat is interactive; Task is
  set-and-forget orchestration that continues until completion or an explicit
  user pause/stop.
- Only one main Task job and its subtasks may execute at a time. Ready subtasks may
  run sequentially or in parallel according to their dependency graph.
- Chat remains available during an active task, but becomes read-only while the
  task owns the repository write lock.
- Project assets live beneath `.github/`: agents in `.github/agents/*.agent.md`,
  skills in `.github/skills/<skill-name>/SKILL.md`, and Workbench memories in
  `.github/memories/{personal,project}/`. MCP configuration uses VS Code's
  native `.vscode/mcp.json`.
  Personal memories must be ignored by Git.
- The extension bundles memory-manager, skill-creator, agent-creator, and task
  orchestrator agents. `.github/agents/orchestrator.agent.md` overrides the
  bundled orchestrator when present.
- Agents and Skills use native VS Code/Copilot file formats without
  Workbench-only frontmatter. Skills load progressively; native Agent `tools`
  controls Workbench, extension-registered, and MCP tools.
- Autonomous repository execution uses Repository-confined Tools plus explicitly
  granted Ambient Tools. Destructive Git operations and direct credential
  retrieval are prohibited. Remote mutations require separately disclosed,
  bounded authority; Ambient Tools remain subject to the VDI user's operating
  system authority.
- Consult current official VS Code API documentation for all platform capability
  claims. Use structured domain modeling when resolving schema, lifecycle, and
  routing decisions.

## Decisions so far

- [Define the repository agent-resource schema](WF-005-define-resource-schema.md) — Uses native Agent, Skill, and MCP formats with an extension-owned runtime, protected bundled identities, progressive Skills, and indexed Workbench Memories.
- [Decide how the orchestrator selects agents](WF-006-decide-agent-routing.md) — Filters hard eligibility before semantic selection, escalates capability gaps through approved Agent creation or manual routing, and preserves structured decline and rerouting history.
- [Define the durable autonomous-task lifecycle](WF-007-design-task-lifecycle.md) — Uses confirmed Task Contracts, a transactional checkpointed state machine, success-only dynamic DAGs, bounded one-writer scheduling, safe quiescence and recovery, repository reactivation, and goal-based completion.
- [Define the resumable chat-session lifecycle](WF-008-design-chat-lifecycle.md) — Uses fixed-Agent linear sessions with explicit forks, immutable attempt provenance, rolling summaries and a live Session Ledger, safe cancellation and recovery, and automatic read-only behavior under the Task write lock.
- [Define the repo-confined execution boundary](WF-009-design-execution-boundary.md) — Separates enforceable Repository-confined Tools from explicitly authorized Ambient Tools, with scoped authority, linked roots, VDI-aware disclosure, immutable audit, and reconcile-before-retry safety.
- [Prototype the sidebar and editor workbench experience](WF-010-prototype-workbench-ux.md) — Uses a Task-first six-area full-editor Workbench, opened from a single-action VS Code sidebar launcher with passive status only.
- [Define the memory lifecycle and conflict policy](WF-012-define-memory-policy.md) — Uses explicit, exact-confirmation promotion; provenance and proactive conflict validation; scope-neutral retrieval; same-scope consolidation; and Runtime-enforced recoverable writes.
- [Define the Workbench accessibility and notification contract](WF-014-define-accessibility-notifications.md) — Uses no-focus-stealing document semantics, composite keyboard navigation, polite deduplicated Attention Requests, action-count badges, native VS Code notifications, proportional confirmations, and a WCAG 2.2 AA acceptance baseline.
- [Lock the MVP architecture and specification acceptance contract](WF-011-lock-spec-architecture.md) — Uses an interactive presentation-only Webview over a modular extension-host Runtime, one SQLite store per workspace, deterministic policy and recovery boundaries, headless test seams, a prescribed scaffold, and fourteen traced acceptance scenarios.
- [Verify VS Code packaging, upgrade, and workspace-storage constraints](WF-015-verify-vscode-packaging-upgrade-constraints.md) — Confirms a desktop Node extension is viable while making packaged assets, native SQLite compatibility, forward migrations, backups, and data-safe downgrade refusal extension-owned release guarantees.
- [Define the MVP packaging, migration, and release contract](WF-016-define-packaging-migration-release-contract.md) — Uses two target-specific internal VSIXs, lazy migration-gated activation, forward-only recoverable data evolution, explicit compatibility ranges, and an atomic two-target GitHub release gate.
- [Define the operational diagnostics and supportability contract](WF-017-define-observability-diagnostics-contract.md) — Uses local metadata-first evidence, derived health and causal audit views, bounded incident-aware retention, previewed Support Bundles, and guarded recovery links without telemetry or secret exposure.
- [Lock the MVP verification and specification traceability contract](WF-018-lock-verification-traceability-contract.md) — Uses two waiver-free gates, atomic bidirectional requirement traceability, layered deterministic verification, real-host developer and packaged profiles, exhaustive recovery and adversarial checks, and durable sanitized evidence.
- [Define exhaustive Runtime lifecycle transition contracts](WF-019-define-lifecycle-transition-contracts.md) — Fixes the canonical state machines, continuation and quiescence records, deterministic guards and effects, lease/barrier/recovery invariants, idempotent replay, migration gates, and authoritative lifecycle event identities.
- [Lock the versioned Workbench Protocol catalog and schemas](WF-020-lock-workbench-protocol-contract.md) — Uses a closed same-release JSON contract with bound Webview instances, authoritative snapshots plus gapless projection streams, complete action and event catalogs, deterministic idempotency and rejection, and one generated schema source for fake and production adapters.
- [Lock the logical SQLite schema and transaction map](WF-021-lock-sqlite-schema-transaction-map.md) — Uses a normalized 59-table authoritative store, typed private artifacts, enforced lifecycle and lease invariants, indexed recovery paths, and complete command-to-transaction coverage with intent-before-effect reconciliation.

## Not yet specified

<!-- No remaining in-scope fog. Open specified decisions are child tickets. -->

## Out of scope

- Multi-user collaboration, cloud synchronization, hosted orchestration, and
  remote task execution.
- Cross-repository execution or mutation outside the currently open repository.
- Destructive Git operations, direct credential retrieval, and unapproved remote
  mutations or publishing.
- Building the extension during this Wayfinder effort; the destination is its
  implementation-ready specification.
- Configurable Agent, Skill, or Memory Resource Sources outside the canonical
  repository locations; these belong to a later Workbench Settings effort.
- Parallel mutating Subtasks, file-level leases, and worktree isolation; the MVP
  serializes every write-capable Subtask.
- [Set VDI-safe runtime resource budgets](WF-013-set-vdi-resource-budgets.md) —
  organization-controlled ceilings, per-Task budget overrides, consumption UI,
  and budget-exhaustion policy are deferred to a later Workbench Resource
  Governance effort; existing lifecycle safety bounds remain.
