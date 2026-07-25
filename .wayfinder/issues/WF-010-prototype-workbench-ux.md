---
id: WF-010
title: Prototype the sidebar and editor workbench experience
type: prototype
label: wayfinder:prototype
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-002
  - WF-007
  - WF-008
---

## Question

What information architecture and interaction model should the sidebar and
full-editor views use for Chat sessions, the single active Task job, queued tasks,
subtask progress, agent/model selection, pause/stop controls, recovery state, and
read-only chat behavior during task execution? Include Conversation Fork lineage,
Trash and permanent-deletion warnings, rolling Conversation Summary provenance,
the inspectable and correctable Session Ledger, Tool records, repository-drift
warnings, and Memory Promotion previews without turning the workbench into an
audit-log UI.

## Assets

- [Interactive Workbench prototype](../../prototype/workbench/index.html) —
  three throwaway variants switchable with `?variant=A`, `B`, or `C`; run with
  `npm run prototype`.
- [Minimal VS Code sidebar launcher](http://127.0.0.1:4173/?variant=B&surface=sidebar)
  — a single product action opens Variant B as the full editor Workbench.

## Resolution

Use the prototype's **Variant B — Task command center** as the full-editor
Workbench information architecture. Its persistent internal rail switches among
Tasks, Chats, Activity, Agents, Memory, and Settings:

- Tasks is the operational home: active Task status and controls, the Subtask
  board, important recovery or repository-drift interventions, live execution,
  queued Tasks, and a read-only Chat entry point.
- Chats is session-first: searchable sessions, Conversation Fork lineage, Trash,
  the current conversation, fixed Agent and model identity, and write-lock state.
- Activity summarizes human-relevant outcomes, warnings, and interventions;
  routine Tool and resource provenance stays collapsed on demand so the product
  does not become an audit-log UI.
- Agents combines Repository and Bundled Agent discovery with current
  eligibility, resource access, model preference, and the actions to inspect,
  edit, or start a Chat.
- Memory separates Project and Personal Memory from session-local ledgers and
  exposes retrieval metadata, provenance, recent use, and a confirmation preview
  for Memory Promotion.
- Settings groups repository-scoped Workbench behavior, tools and authority,
  models, storage, and native Agent, Skill, and MCP locations.

The VS Code sidebar is deliberately **not** a compressed version of this
navigation. It is a lightweight launcher with exactly one product action,
**Open Workbench in Editor**, which opens Variant B as a full editor tab.
Passive active-Task status may appear beneath that action, but Chats, Activity,
Agents, Memory, Settings, and Task controls live only in the editor Workbench.

The production UI should use VS Code-native theme primitives and interaction
conventions; the prototype establishes structure and hierarchy, not final visual
polish.
