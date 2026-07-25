---
id: WF-013
title: Set VDI-safe runtime resource budgets
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-009
---

## Question

Within the settled Chat and Task lifecycles and execution boundary, what
organization-controlled ceilings and conservative defaults should bound
concurrent Subtasks and processes, wall-clock execution, captured output, Tool
calls, retries, and measurable model usage on Windows VDIs; which limits may a
user lower per Task, how is consumption presented, and what terminal behavior
applies when each budget is exhausted?

## Scope disposition

Deferred beyond the MVP. The MVP will not define organization-controlled or
user-configurable VDI resource ceilings, per-Task budget overrides, consumption
dashboards, or budget-exhaustion terminal behavior.

This scope cut does not remove the safety invariants already established by the
Task lifecycle and execution boundary: one active Task, at most one
write-capable Subtask, bounded read-only/model concurrency, bounded operational
retries, safe quiescence, and provider or operating-system failures surfaced
through the existing blocked or failed states. A later Workbench Resource
Governance effort may add explicit VDI budgets and administration.
