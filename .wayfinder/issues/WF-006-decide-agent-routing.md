---
id: WF-006
title: Decide how the orchestrator selects agents
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-005
---

## Question

Should subtask-to-agent routing use explicit structured capabilities, semantic
matching against agent descriptions, a hybrid scoring contract, or another
mechanism, and how must the orchestrator behave when no agent, several agents, or
an overridden orchestrator appears suitable?

## Resolution

### Selection contract

Routing has two stages:

1. The Workbench Runtime constructs the eligible set using hard constraints:
   native `agents` authorization, invocation rules, manifest validity, runtime
   availability, target support, and the resources known to be required by the
   subtask.
2. The active Orchestrator selects semantically among eligible Agents using their
   native `description`, relevant instructions, and available resources.

The MVP adds neither structured capability fields nor numeric capability scores.
An Agent is suitable only when its native description positively covers the
subtask's primary objective, its eligible resources cover the known execution
needs, and the Orchestrator can record a concrete one-sentence fit rationale.
Incidental keyword overlap is not sufficient.

When several Agents appear equally suitable, choose by:

1. the most specifically matching `description`;
2. the closest fit between required and available resources;
3. a Repository Agent over a Bundled Agent; then
4. Agent Identity as the stable final tie-breaker.

Chat may expose a user override, but Task execution does not pause merely because
multiple Agents qualify. Every automatic or manual selection records the
candidate considered, chosen Agent, rationale, and relevant resource snapshot.

### Capability gaps and user intervention

When no Agent passes the suitability test, the Orchestrator declares an Agent
Capability Gap instead of assigning an unsuitable Agent or doing the specialist
work itself. The Bundled Agent Creator drafts a Repository Agent for the gap and
the subtask and its parent Task enter a durable `waiting-for-routing` state.
The proposed Agent is neither written nor activated without user approval.

The user may:

- approve or edit and approve the proposed Agent;
- assign the subtask to an eligible existing Agent despite the Orchestrator's
  suitability judgment; or
- cancel the subtask or parent Task.

Rejecting a proposal without choosing another action leaves the Task waiting.
The Orchestrator never treats rejection as permission to execute the work itself.
A user override bypasses semantic suitability only: it cannot bypass hard
eligibility, resource, or safety constraints, and it applies to one Assignment
Attempt rather than becoming a permanent routing rule.

Routing overrides are local routing evidence, not Memory. Three semantically
similar overrides that assign the same Agent trigger the Agent Creator to propose
an update to that Agent's `description` or instructions. The user must approve
the repository change. Approval or rejection resets that similarity counter to
zero; after a rejection, three new similar overrides trigger a fresh proposal.

### Capability Decline and rerouting

Every delegated Subagent execution receives a narrow Runtime control tool:

```text
decline_assignment({
  reason: string,
  unmet_requirements: string[]
})
```

This control tool is part of the delegation protocol rather than the Agent's
ordinary work-resource allowlist, so it remains available even when native
`tools` is empty. It exists only in a delegated Subtask, cannot select another
Agent or write durable state directly, and terminates the current Assignment
Attempt without classifying the Subtask as failed.

The Runtime transactionally records the Capability Decline and newly discovered
requirements, closes the current Assignment Attempt as declined, and returns
control to the Orchestrator. The Orchestrator re-evaluates eligibility and
suitability once. If another Agent clearly fits, it appends a new Assignment
Attempt and updates the Subtask's current assignment. If none fits, or that
second Agent also declines, the Subtask enters `waiting-for-routing`; the
Orchestrator must not cycle through the catalog. Ordinary model, tool, or
operational failures follow Task retry policy and do not count as routing
evidence.

Assignment Attempts are append-only audit history. Rerouting changes the
Subtask's current assignment without erasing who was previously tried, why that
selection was made, or why it was declined.

### Orchestrator override boundary

A Repository Agent with identity `orchestrator` replaces the Bundled
Orchestrator's judgment and behavior, but not the Workbench Runtime's routing
protocol. The Runtime continues to enforce eligibility, durable selection
records, approval gates, Capability Decline handling, the single automatic
reroute limit, and all safety constraints.

### Constraints handed to Task lifecycle

A Routing Intervention leaves its parent top-level Task active, preventing a
later queued Task from starting. Cancelling the active Task releases that slot
but does not roll back repository edits already made by its Agents. The exact
write-lock behavior while waiting belongs to the durable Task lifecycle.

Top-level Task queue order is distinct from top-level Task dependency. Task
admission must analyze the running and queued Tasks, propose suspected success
dependencies with rationale, and let the user confirm or deny each edge. One
confirmed dependency relationship is stored per prerequisite Task; the scheduler
may skip a blocked earlier Task to run the earliest ready later Task.
