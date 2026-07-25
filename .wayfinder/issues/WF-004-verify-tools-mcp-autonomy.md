---
id: WF-004
title: Verify tool, MCP, and autonomous execution constraints
type: research
label: wayfinder:research
status: closed
parent: WF-001
assignee: research-tools-autonomy
blocked_by: []
---

## Question

Using current official VS Code documentation, determine how a `vscode.lm` extension
can expose and invoke tools, integrate repository-configured MCP servers, stream
responses, cancel work, run concurrent model requests, survive extension-host or
window failure, and enforce repo-confined unattended execution. Identify platform
limits that contradict or constrain the intended set-and-forget behavior.

## Resolution

Resolved with [tool, MCP, and autonomous execution evidence](../research/WF-004-tools-mcp-autonomy.md).

The specification must use an extension-owned, checkpointed tool loop and treat
resume as replay from durable state. Native VS Code MCP configuration is
`.vscode/mcp.json`, and the stable API does not expose native MCP-discovered tools
to an extension's custom `vscode.lm` loop; `.github/mcp.json` therefore implies an
extension-owned MCP client. Set-and-forget work can run only while an extension
host is alive and can still be externally blocked by consent, trust,
authentication, quota, model, or network state. Finally, arbitrary commands and
MCPs cannot be truthfully called repo-confined without a separately enforced
sandbox/container, so unsafe execution must be disabled when that boundary is
unavailable.
