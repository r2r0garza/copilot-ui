# Verify chat-session interoperability and durable extension storage

Researched 2026-07-24 against the current stable VS Code API documentation and
the `microsoft/vscode` API declarations.

## Answer

The extension cannot use a supported stable API to enumerate, open, write, or
continue VS Code/Copilot Chat's stored sessions. It must own its chat and task
records.

Use a versioned, extension-owned SQLite database under
`ExtensionContext.storageUri` as the MVP's canonical repository-workspace store.
Use `workspaceState` only for small JSON-serializable UI state. Do not read or
modify VS Code's internal workspace-storage database or chat-session files.

## Evidence

### Copilot Chat session interoperability

- The stable `chat` namespace exposes `createChatParticipant`, but no session
  enumeration, loading, mutation, or continuation API. See the official
  [`vscode.d.ts` chat namespace](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L20113-L20122).
- A participant receives `ChatContext.history`, which is only the messages so
  far in the **current** chat session and currently only messages for that
  participant. The official guide is even more explicit: a participant can
  access only messages where it was mentioned. This is request-time context,
  not a session-store interface. See
  [`ChatContext`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L19664-L19673)
  and [Use the chat message history](https://code.visualstudio.com/api/extension-guides/ai/chat#use-the-chat-message-history).
- VS Code has a `chatSessionsProvider` proposal that lets an extension register
  and supply **its own** URI-addressed session items and content. It does not
  expose the built-in/Copilot session store. It is also a proposed API, which
  VS Code documents as unstable, Insiders-only, and unsuitable for published
  extensions. See the
  [proposed declaration](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts)
  and [Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api).

**MVP consequence:** the extension's sidebar/editor Chat mode should render and
continue extension-owned sessions. A separate optional Copilot Chat participant
could receive its own current-participant history, but it would not make the two
session stores interoperable. Do not base the MVP on the proposed provider API.

### Supported extension-owned storage

- `workspaceState` is a workspace-context `Memento`. Its API is key/value
  `get`/`update`; values must be JSON-stringifiable. It provides no
  multi-record transaction or query contract. See
  [`ExtensionContext.workspaceState`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L8415-L8440)
  and [`Memento`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L8573-L8621).
- `storageUri` is a workspace-specific private directory intended for
  extension-owned files; its directory creation is the extension's
  responsibility and it is `undefined` when no workspace/folder is open. See
  [`ExtensionContext.storageUri`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts#L8490-L8510)
  and [Data Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage).
- VS Code's remote-extension guidance calls `storageUri`/`globalStorageUri`
  “safe” URIs for data more complicated than key/value state and warns against
  depending on VS Code's private path conventions. See
  [Persisting extension data or state](https://code.visualstudio.com/api/advanced-topics/remote-extensions#persisting-extension-data-or-state).
- Desktop local and remote extension hosts run Node.js, so a desktop-only MVP
  can bundle a SQLite implementation. VS Code supplies the storage location,
  not a public SQLite/database service. A future web-extension target would
  need a different persistence adapter. See
  [Extension Host runtimes](https://code.visualstudio.com/api/advanced-topics/extension-host#extension-host-runtimes).

`workspaceState` is appropriate for selected view, last-opened session ID, and
other disposable UI preferences. `globalState`/`globalStorageUri` are the wrong
scope for repository history, while `SecretStorage` is only for sensitive
values and is global rather than repository-scoped.

## Storage decision for the spec

1. Require one open workspace folder for the MVP. Treat VS Code's workspace
   identity as the persistence scope and open
   `Uri.joinPath(context.storageUri, "workbench.sqlite")`.
2. Store chat sessions, ordered turns, task roots, subtasks/dependencies,
   assignments, attempts, tool-call records, checkpoints, events, and model
   metadata in SQLite. Keep large tool artifacts as extension-owned files under
   `storageUri`, referenced by database rows.
3. Commit every externally meaningful state transition transactionally. On
   activation, identify attempts left `running`, mark them `interrupted`, and
   resume from the last committed checkpoint. This makes process, machine, and
   network failures recoverable without trusting an in-memory task graph.
4. Maintain an explicit schema version and ordered forward migrations. Run each
   migration in a database transaction before starting workers; retain a backup
   before migrations that rewrite data. This migration protocol is
   extension-owned because VS Code provides no schema-migration API.
5. Use WAL mode and foreign-key enforcement where supported by the selected
   SQLite library. Serialize task-state transitions through one persistence
   service so a crash cannot leave related task/checkpoint/event rows partially
   updated.
6. Keep this database private and untracked. Git-sharing applies to repository
   artifacts such as `.github/agents`, `.github/skills`, project memories, and
   produced code. If session/task sharing becomes a requirement, specify an
   explicit sanitized export/import format rather than committing the live
   database.

## Important scope caveat

`storageUri` is scoped to the VS Code workspace identity, not guaranteed to be a
canonical Git-repository identity. Opening the same repository through a
different workspace configuration can yield a separate store. The MVP should
state this behavior, require a single-folder workspace, and defer cross-workspace
store discovery/merging unless it becomes a product requirement.
