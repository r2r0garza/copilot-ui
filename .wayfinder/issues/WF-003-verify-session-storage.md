---
id: WF-003
title: Verify chat-session interoperability and durable extension storage
type: research
label: wayfinder:research
status: closed
parent: WF-001
assignee: research-session-storage
blocked_by: []
---

## Question

Using current official VS Code documentation, can an extension read, write, or
continue Copilot Chat's stored sessions, and which extension storage APIs and local
database/file approaches are supported for repository-scoped chat history, task
graphs, checkpoints, crash recovery, and schema migration?

## Resolution

The stable API cannot enumerate, mutate, or continue Copilot Chat's stored
sessions; participant history is limited to that participant in the current
session, and the newer session-provider surface is proposed and provider-owned.
The MVP should keep a versioned extension-owned SQLite store under the
workspace-specific `ExtensionContext.storageUri`, reserve `workspaceState` for
small UI metadata, transactionally checkpoint task state, and own its schema
migrations. Full evidence:
[Verify chat-session interoperability and durable extension storage](../research/WF-003-verify-session-storage.md).
