---
id: WF-015
title: Verify VS Code packaging, upgrade, and workspace-storage constraints
type: research
label: wayfinder:research
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
---

## Question

Which current stable VS Code extension-platform constraints govern packaging,
activation, bundled webview assets, workspace-scoped storage, SQLite native
dependencies, schema upgrades, extension updates, rollback compatibility, and
Marketplace distribution for this MVP?

## Resolution

Current stable VS Code supports the MVP as a conventional desktop Node extension
with a separately bundled Webview and one extension-owned SQLite database beneath
`ExtensionContext.storageUri`.

VS Code owns lazy activation, Extension Host placement, workspace-private storage
location, VSIX and Marketplace installation, compatible-version filtering, and
Extension Host restart after updates. The extension owns packaged runtime assets,
SQLite OS/CPU/Node-ABI compatibility, storage-directory and database integrity,
forward schema migrations, pre-migration backups, crash recovery, and downgrade
behavior.

The release contract must therefore use target-specific VSIXs when SQLite uses a
native addon, production-test packaged Webview assets and CSP, migrate before
starting writable Runtime services, and refuse writes when older extension code
encounters a newer schema. Installing an older extension version rolls back code
only; VS Code does not transactionally roll back extension-owned data.

Full official-source evidence and the proposed release gate are recorded in
[the research asset](../research/WF-015-verify-vscode-packaging-upgrade-constraints.md).
