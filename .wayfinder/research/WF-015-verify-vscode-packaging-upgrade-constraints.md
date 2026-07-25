# Verify VS Code packaging, upgrade, and workspace-storage constraints

Researched 2026-07-25 against current stable Visual Studio Code **1.130**
(released 2026-07-22) and the official Microsoft/VS Code extension
documentation updated 2026-07-15.

## Answer

The desktop MVP is viable as a conventional Node.js VS Code extension with a
bundled webview and an extension-owned SQLite database. The support boundary
must be explicit:

- VS Code owns extension discovery, lazy activation, Extension Host placement,
  the private workspace-scoped storage URI, VSIX/Marketplace installation,
  compatible-version filtering, and prompting/restarting the Extension Host
  after an update.
- The extension owns every runtime file included in the VSIX, all native SQLite
  binaries and ABI/platform compatibility, creation and integrity of its
  storage directory and database, schema upgrades, backups, crash recovery, and
  behavior when older extension code encounters a newer database.
- VS Code does **not** document a transactional coupling between an extension
  update and extension-owned data, a database migration API, or automatic data
  rollback when a user installs an older extension version. Therefore, “Install
  Another Version” is only a code-package rollback. It is not a data rollback.

For the MVP, package the extension host and webview code as separate JavaScript
bundles, ship the webview's static assets in the VSIX, and keep the SQLite file
under `ExtensionContext.storageUri`, never under the extension installation
directory or VS Code's private internal storage paths. Use a versioned,
forward-migrated schema with a pre-migration backup and a hard compatibility
check that refuses to write when the database schema is newer than the running
extension understands.

## What VS Code guarantees and what the extension owns

| Concern | VS Code contract | Extension responsibility |
| --- | --- | --- |
| Runtime | Desktop provides a local Node.js Extension Host; a Node extension declares a `main` entry point. Extensions are loaded lazily from activation events. | Compile/bundle the `main` artifact, target only stable APIs allowed by `engines.vscode`, register disposables, and avoid eager `*` activation. |
| Package compatibility | `package.json.engines.vscode` declares the compatible VS Code range and cannot be `*`. Marketplace/VS Code can select a compatible extension version. | Choose and test the minimum supported VS Code version; do not treat the current editor's bundled Node/Electron ABI as stable across future VS Code releases. |
| Webview files | VS Code serves only permitted local resources after `Webview.asWebviewUri` conversion and enforces the configured webview resource roots/CSP. | Build and include HTML-adjacent JS/CSS/images/fonts, generate their webview URIs, restrict `localResourceRoots`, use a restrictive CSP, and sanitize workspace/user content. |
| Workspace persistence | `storageUri` is a private workspace-specific URI; its parent exists, but the directory itself may not. It is `undefined` with no open folder/workspace. `workspaceState` is workspace-scoped key/value state. | Require an open workspace, create the directory, create/lock/query/recover the SQLite database, and decide how multi-root or differently-opened copies of one repository map to stores. |
| Native SQLite | A desktop Node Extension Host can load Node modules. Marketplace supports platform-specific VSIXs. | Build or acquire SQLite binaries for every supported OS/CPU and the VS Code Electron Node module ABI, or choose a non-native implementation. VS Code does not rebuild native dependencies for users. |
| Update | Marketplace extensions can auto-update; VS Code installs the update and asks to restart the Extension Host. Users can install another published version. VSIX-installed extensions have auto-update disabled by default. | Make activation safe after any supported version transition. Run migrations, preserve recoverability, and define downgrade behavior. |
| Rollback | VS Code can install an older extension package/version. | Keep new schemas backward-readable for a declared window, or detect a too-new schema and refuse writes with a guided restore/export path. VS Code does not revert the database. |
| Distribution | `@vscode/vsce` packages/publishes VSIXs; Marketplace can serve target-specific packages. | Own publisher/release credentials, versioning, changelog, CI build matrix, VSIX-content inspection, smoke tests, and publishing each supported target. |

## Packaging and activation constraints

Every extension needs a root `package.json`. For this MVP it should, at
minimum:

- declare a SemVer `version`, publisher/name identity, and a tested
  `engines.vscode` floor;
- point `main` at the bundled Node entry point and omit `browser`, making this
  a desktop/Node extension rather than a web extension;
- declare only the commands, views, configuration, and other contribution
  points actually used;
- make the execution location deliberate. `extensionKind: ["workspace"]`
  causes it to run with the workspace (locally for an ordinary desktop
  workspace, remotely for SSH/WSL/container workspaces). If native builds for
  remote hosts are not part of this MVP, state that those remote configurations
  are unsupported and test the failure path. `extensionKind` is a placement
  preference/requirement, not a general “desktop-only” compatibility flag;
- declare virtual-workspace limitations through
  `capabilities.virtualWorkspaces` if the selected SQLite adapter requires a
  local filesystem. Workspace Trust behavior must likewise be declared rather
  than inferred.

VS Code 1.74 and later implicitly activates an extension when a contributed
command, view, custom editor, or language is used, so redundant `onCommand` or
`onView` declarations are unnecessary at the proposed compatibility floor.
An imperatively created webview panel that VS Code should restore still needs
the `onWebviewPanel:<viewType>` path and a registered
`WebviewPanelSerializer`. Prefer use-triggered activation. `onStartupFinished`
is available for genuinely background initialization and runs after startup;
do not use `*` merely to open or migrate the database early.

The extension entry bundle should externalize `vscode` because VS Code provides
that module at runtime. `vscode:prepublish` is run by `vsce`; make it run type
checking and production builds for both the extension-host bundle and webview
bundle. Use `.vscodeignore` to omit sources, tests, development dependencies,
source maps if not intended for release, and build configuration—but explicitly
retain:

- the compiled extension entry;
- the compiled webview JS and CSS;
- fonts, icons, images, localization, and other runtime assets;
- SQLite native binaries or runtime packages for that VSIX target;
- manifest, README, changelog, license, and notices required for distribution.

Inspect the final package contents before publishing. A successful source build
does not prove the VSIX contains every dynamic asset or native binary.

Official sources:

- [Current stable VS Code 1.130 release](https://code.visualstudio.com/updates/v1_130)
- [Extension manifest reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Activation events reference](https://code.visualstudio.com/api/references/activation-events)
- [Extension Host runtimes and placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)

## Bundled webview assets

The webview is a separate, isolated document. It cannot directly load arbitrary
`file:` URLs. For every shipped asset:

1. Resolve it below `context.extensionUri`, such as
   `Uri.joinPath(context.extensionUri, "dist", "webview", "index.js")`.
2. Convert it with `webview.asWebviewUri`.
3. Limit `localResourceRoots` to the smallest asset directory (for example,
   only `dist/webview`), rather than the whole workspace.
4. Enable scripts only if necessary.
5. Set `default-src 'none'` and selectively permit scripts, styles, images, and
   fonts from `webview.cspSource`; keep scripts/styles external and use a nonce
   if the chosen build requires one.
6. Sanitize all file contents, paths, settings, model output, and other
   untrusted values rendered into HTML. `localResourceRoots` is not a complete
   security boundary.

Webview `getState`/`setState` stores only JSON-serializable presentation state
and that state is destroyed with the panel. It must not become a second source
of truth for tasks, messages, attempts, or checkpoints. Send mutations to the
extension host and commit them to SQLite; rehydrate the webview from the
extension-owned repository.

Official source:

- [Webview local resources, CSP, lifecycle, and persistence](https://code.visualstudio.com/api/extension-guides/webview)

## Workspace-scoped storage

`workspaceState` is a `Memento`: a small JSON-stringifiable key/value store. It
fits selected tabs, dismissed notices, and the last-opened extension-owned
session ID. It offers no relational query, transaction, or schema-migration
contract.

`storageUri` is the supported place for complex, workspace-specific
extension-owned files. VS Code guarantees the parent directory, not the
extension directory itself; the extension must create it. It is `undefined`
when no folder/workspace is open. Therefore:

- require an open workspace before creating or opening the MVP database;
- use `Uri.joinPath(context.storageUri, "workbench.sqlite")`;
- never derive or depend on paths such as `~/.vscode`, and never read or modify
  VS Code's own workspace-state database;
- keep global preferences in `globalState`, global complex files in
  `globalStorageUri`, and credentials/tokens in `SecretStorage`, not SQLite
  plaintext;
- treat `storageUri` as scoped to VS Code's workspace identity, not as a
  guaranteed canonical Git repository identity. A repository opened through a
  different workspace configuration may receive a different store.

The API is intended for persistent extension data, but the official contract
does not promise an extension-specific backup, export, retention-on-uninstall,
or rollback service. Those must not be assumed.

Official sources:

- [`ExtensionContext` storage API](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
- [Persisting extension data or state](https://code.visualstudio.com/api/advanced-topics/remote-extensions#persisting-extension-data-or-state)
- [Common capabilities: data storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage)

## SQLite and native dependency constraints

A SQLite package with a native Node addon is compiled against an operating
system, CPU architecture, and Node module ABI. VS Code's official guidance says
native modules bundled with an extension must be rebuilt for Electron, and that
remote VS Code Server uses standard Node rather than Electron. The exact ABI is
discoverable at runtime as `process.versions.modules`; it is not an extension
API compatibility guarantee.

For a local-desktop-only MVP, choose one of these explicit release strategies:

1. **Native addon:** publish separate VSIXs for each supported target, initially
   the deliberately supported subset of `darwin-arm64`, `darwin-x64`,
   `win32-x64`, `win32-arm64`, `linux-x64`, and/or `linux-arm64`. Rebuild the
   SQLite addon for VS Code's Electron runtime, include the produced binary,
   and smoke-test it by installing the actual VSIX into every target VS Code
   version in the support range. Repeat this validation whenever VS Code changes
   Electron/Node.
2. **Non-native SQLite adapter:** avoid Electron ABI coupling, accepting its
   own performance, persistence, and API tradeoffs. “Pure JS/WASM” still needs
   explicit testing; VS Code does not certify the adapter.

Marketplace platform-specific extensions have been selected by VS Code since
1.61. `vsce` publishes/packages them with `--target`; an untargeted package is a
fallback for platforms without a matching package. Do not publish a universal
fallback that accidentally contains a single-platform native binary. If remote
SSH, WSL, Dev Containers, Alpine/musl, or VS Code for Web are out of scope,
exclude them from the support claim instead of relying on a local binary to
fail at load time.

Official sources:

- [Using native Node.js modules](https://code.visualstudio.com/api/advanced-topics/remote-extensions#using-native-nodejs-modules)
- [Platform-specific extension publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)

## Schema upgrades and rollback compatibility

VS Code has no extension-data migration hook separate from normal activation.
The extension must gate its own startup:

1. Open the database before starting workers or presenting writable state.
2. Read an explicit schema version (for example SQLite `user_version` or a
   one-row metadata table).
3. If the version is supported but old, checkpoint/close prior connections,
   make a restorable backup, and execute ordered forward migrations in
   transactions.
4. Verify invariants before committing each migration; record both schema and
   data-format versions.
5. If the database version is newer than the running extension's maximum
   supported version, **do not migrate downward and do not write**. Show a
   recovery action: reinstall a compatible newer extension, open read-only if
   that is demonstrably safe, export, or restore a versioned backup.
6. After a crash, detect incomplete attempts and recover from committed
   checkpoints. Database safety cannot depend on `deactivate`: VS Code's
   `ExtensionContext.subscriptions` documentation says asynchronous dispose
   functions are not awaited.

Choose and document one rollback policy before the first public release:

- **Compatibility window:** every schema change remains readable/writable by
  the previous supported extension version; or
- **Forward-only with restore:** a downgrade refuses access to a newer schema
  and offers a backup made immediately before migration.

The second is simpler and safer for the MVP. Test at least fresh install,
upgrade from every previously released schema, interrupted migration, newest
code reopening the migrated database, and old code encountering the new schema.
Installing an older extension through VS Code is not sufficient rollback
testing.

## Update and Marketplace distribution constraints

`@vscode/vsce` is the official package/publish tool. A Marketplace release
requires a publisher and a monotonically managed extension version. Marketplace
users normally receive enabled-extension updates automatically, with a default
delay currently documented as two hours; VS Code then asks to restart the
Extension Host. Users can disable update checking/auto-update or install another
published version. An extension installed from a VSIX has auto-update disabled
by default.

Consequences for the release contract:

- Never assume an upgrade is user-attended or that all intermediate releases
  were installed. Migrations must handle a jump from any supported old schema.
- Never require `deactivate` from the prior version to prepare the database.
- Publish all target-specific VSIXs for one release consistently and verify the
  Marketplace serves the correct target.
- Keep an installable prior extension version and pre-migration database backup
  for recovery, but describe them as separate code and data recovery artifacts.
- Test package install, activation, database open/migration, webview asset
  loading, restart, update, and manual downgrade using packaged VSIXs—not only
  the Extension Development Host.
- Treat Marketplace distribution and direct VSIX distribution as distinct
  channels because their default auto-update behavior differs.

Official sources:

- [Publishing extensions and VSIXs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Marketplace install, auto-update, and “Install Another Version”](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
- [VSIX auto-update default introduced in VS Code 1.92](https://code.visualstudio.com/updates/v1_92#_disable-auto-update-for-extensions-installed-via-vsix)

## Recommended MVP release gate

Before calling a build distributable:

1. Fix the supported VS Code range and desktop platform/architecture matrix.
2. Produce target-specific VSIXs if SQLite is native.
3. Inspect each VSIX and install it into clean profiles on every supported
   target.
4. Verify contributed command/view activation and webview restoration without
   eager startup activation.
5. Verify every webview resource loads from the packaged extension under the
   production CSP.
6. Verify a fresh workspace, missing storage directory, no-workspace window,
   ordinary restart, abrupt Extension Host termination, and corrupt database
   handling.
7. Verify all supported schema-upgrade jumps plus the newer-schema/older-code
   refusal path.
8. Verify Marketplace-style update and manual VSIX install/downgrade behavior.

Passing these gates is an extension-owned release guarantee. VS Code provides
the host and distribution mechanisms, not the database compatibility guarantee.
