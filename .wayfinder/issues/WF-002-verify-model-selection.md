---
id: WF-002
title: Verify Copilot model discovery and selection constraints
type: research
label: wayfinder:research
status: closed
parent: WF-001
assignee: research-model-selection
blocked_by: []
---

## Question

Using current official VS Code documentation, what can an extension discover and
select through `vscode.lm`, can it observe the model selected in Copilot Chat, what
does an "Auto" choice mean in extension-owned UI, and what availability,
authorization, quota, and fallback constraints must the MVP expose?

## Resolution

The extension must own model selection in its sidebar/editor UI: it can
dynamically enumerate and select Copilot models through `vscode.lm`, but only a
native Chat participant receives Copilot Chat's selected model, scoped to the
current request. “Auto” must therefore be an extension-defined per-request
resolver with recorded effective models, not an alias for Copilot Chat Auto.
Consent must be established from a user action; resumed runs must re-resolve
availability and handle missing authorization, unavailable models, quota
blocking, and stream failures as durable states. Full findings and sources:
[research evidence](../research/WF-002-verify-model-selection.md).
