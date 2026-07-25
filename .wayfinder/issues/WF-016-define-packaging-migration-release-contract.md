---
id: WF-016
title: Define the MVP packaging, migration, and release contract
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
  - WF-015
---

## Question

Which build artifacts, activation behavior, platform support, database migration
and rollback rules, compatibility promises, distribution channel, versioning
policy, and release gates must the MVP specification require?

## Resolution

### Supported package matrix

The MVP supports exactly two desktop VS Code targets:

- `win32-x64`; and
- `darwin-arm64`.

Intel macOS, Windows ARM, Linux, VS Code for Web, Remote SSH, WSL, Dev
Containers, and other remote extension hosts are outside the MVP support
promise.

Each release produces a separate target-specific VSIX containing the bundled
extension-host entry point, bundled Workbench Webview code and static assets,
distribution metadata and notices, and the matching native SQLite runtime.
There is no universal fallback VSIX.

### Activation contract

Activation is lazy and use-triggered through the Workbench's contributed
command or view, plus the Webview restoration path for an existing Workbench.
The extension does not use eager `*` or `onStartupFinished` activation.

On activation, the extension establishes database compatibility and completes
any required migration before exposing writable Runtime services. A Webview may
render recovery state during this gate but cannot issue writable commands.

### Internal distribution and versioning

GitHub Releases are the canonical MVP distribution channel. Installable VSIX
binaries do not enter Git history. One tagged GitHub Release holds both target
artifacts, their SHA-256 checksums, the changelog, and migration notes. VS Code
Marketplace distribution is deferred and creates no MVP compatibility promise.

Both target packages share one Semantic Version and one source tag named
`v<version>`, beginning at `0.1.0`. Before `1.0.0`:

- patch releases contain compatible fixes without a new database migration;
- minor releases may add features, migrations, or compatibility changes; and
- a major version is reserved for declaring a stable post-MVP compatibility
  contract.

Database schema and Workbench Protocol versions are independent monotonic
integers recorded alongside the extension version.

### Database migration and recovery

Database evolution is forward-only. A current extension must migrate directly
from every previously released schema without requiring intermediate extension
versions. Before the whole ordered migration chain, it checkpoints and closes
prior connections, verifies and records one restorable pre-upgrade backup, then
applies migrations transactionally and verifies integrity before writable
startup.

Each workspace retains one pre-upgrade backup, identified by source schema and
extension version. A later successful upgrade may replace it only after the new
database passes integrity checks and reopens successfully after restart.

There are no downward migrations. Older extension code encountering a newer
schema refuses all writes and directs the user to reinstall compatible code or
explicitly restore the pre-upgrade backup. A failed or interrupted migration
rolls back its transaction, preserves the live database and backup, blocks
writable Runtime startup, and enters diagnostic recovery. Retry, backup
restoration, or creation of a fresh database always requires explicit user
action; recovery never replaces the live database automatically.

### Compatibility promises

The first MVP release supports VS Code `1.130.x` only. Each later VS Code minor
must pass the full packaged-extension release matrix before a new Workbench
release changes the declared compatible range. Compatibility with untested
future VS Code or Electron/Node ABIs is not implied.

The Workbench Protocol promises compatibility only between the extension host
and Webview bundles from the same release. If an update leaves an older Webview
alive, the host rejects mismatched commands without side effects and requires
the Webview to reload and reconstruct its authoritative state. Cross-release
protocol backward compatibility is not an MVP promise.

### Required release gate

A release may be published only when CI produces both target VSIXs from the same
tagged commit and verifies:

1. Type-checking, linting, unit, contract, integration, scenario, and Webview
   test suites.
2. Exact packaged contents, required licenses and notices, SHA-256 checksums,
   and absence of secrets and development-only files.
3. Clean installation on `win32-x64` and `darwin-arm64` under the declared VS
   Code `1.130.x` range.
4. Native SQLite loading, lazy activation, Webview restoration, and all
   production-CSP Webview resources.
5. Fresh workspace startup, no-workspace refusal, missing storage-directory
   creation, ordinary restart, abrupt Extension Host termination, and corrupt
   database recovery.
6. Direct upgrades from every supported prior schema, interrupted migration,
   post-migration restart, explicit backup restoration, and the
   newer-schema/older-code write-refusal path.
7. Uninstall/reinstall and manual VSIX upgrade and downgrade behavior.

Failure on either Supported Target blocks the whole release. After both targets
pass, the two VSIXs and their release metadata are attached together to one
GitHub Release; partially published releases are not valid.
