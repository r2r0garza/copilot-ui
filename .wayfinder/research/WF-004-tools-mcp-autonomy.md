# Evidence: tool, MCP, and autonomous execution constraints

Research date: 2026-07-24. Sources are limited to official VS Code
documentation and the stable API reference generated from VS Code's
`vscode.d.ts`.

## Findings

### A custom `vscode.lm` tool loop is feasible, but the extension owns it

- `LanguageModelChat.sendRequest` accepts a `CancellationToken` and
  `LanguageModelChatRequestOptions.tools`. Tool calls arrive as
  `LanguageModelToolCallPart`s; the caller must invoke the tool, append the call
  and result messages, and send the next request. The model never executes a
  tool itself.
  [API reference](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat),
  [tool guide](https://code.visualstudio.com/api/extension-guides/ai/tools#what-is-tool-calling-in-an-llm)
- The extension can pass private tools directly or select registered tools from
  `vscode.lm.tools`. The stable registry contains tools registered by
  extensions through `lm.registerTool`; `lm.invokeTool` can invoke those tools.
  It is not documented as a registry of built-in or MCP tools.
  [lm namespace](https://code.visualstudio.com/api/references/vscode-api#lm),
  [request options](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatRequestOptions)
- Tool calling varies by model. `LanguageModelChat.capabilities.toolCalling` can
  be false or a number limiting how many tools may be supplied. The scheduler
  must fall back or fail clearly when the chosen model lacks tool calling.
  [capabilities](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatCapabilities)
- Registered extension tools shown through native Chat have confirmation UI;
  the official guide says a generic confirmation is always shown for extension
  tools. A private tool dispatcher in this extension's own UI can avoid that
  native confirmation flow, but then the extension is wholly responsible for
  authorization, audit, and containment.
  [tool implementation guide](https://code.visualstudio.com/api/extension-guides/ai/tools#2-tool-implementation)

### Native MCP configuration does not plug into a custom LM loop

- VS Code's supported repository configuration is `.vscode/mcp.json`, not
  `.github/mcp.json`. Workspace MCP configurations can be committed and shared.
  [MCP configuration locations](https://code.visualstudio.com/docs/agent-customization/mcp-servers#_configure-the-mcpjson-file)
- Extensions can publish MCP server definitions with
  `lm.registerMcpServerDefinitionProvider`, after contributing an
  `mcpServerDefinitionProviders` ID. The API is one-way: it lets the editor
  discover servers. The stable `vscode.lm` API exposes no corresponding API to
  enumerate configured MCP servers, enumerate their discovered tools, or invoke
  those tools from an extension-owned `sendRequest` loop.
  [MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp#register-an-mcp-server-in-your-extension),
  [API reference](https://code.visualstudio.com/api/references/vscode-api#McpServerDefinitionProvider)
- Therefore `.github/mcp.json` plus per-agent `mcp` filtering requires an
  extension-owned MCP client/configuration/runtime. Merely translating that
  file into a VS Code MCP definition provider does not make its tools callable
  by the custom workbench.
- Native MCP also has unavoidable trust lifecycle: first start and configuration
  changes prompt for server trust. A server that is not trusted does not start.
  Automatic restart on configuration changes is experimental.
  [MCP trust and startup](https://code.visualstudio.com/docs/agent-customization/mcp-servers#_mcp-server-trust)

### Streaming and cancellation are supported; durable execution is not

- `LanguageModelChatResponse.stream` is an `AsyncIterable` of text and tool-call
  parts. Stream consumption can fail mid-stream. Cancelling the request token or
  breaking iteration cancels consumption, so every model call and tool call
  should share a task/subtask cancellation hierarchy.
  [response stream](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatResponse)
- The API does not specify a single-request lock, so an extension can start
  multiple promises and consume streams concurrently. It also gives no
  concurrency, ordering, fairness, or throughput guarantee. Requests can be
  rejected because consent is absent, a model disappeared, quota is exhausted,
  or another provider error occurred. Parallel subtasks therefore need a
  bounded extension scheduler and independently checkpointed attempts; parallel
  calls are an optimization, not a platform guarantee.
  [sendRequest failure contract](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat),
  [rate-limit guidance](https://code.visualstudio.com/api/extension-guides/ai/language-model#rate-limiting)
- The first LM request for an extension can show consent UI and must originate
  in a user action. Starting a Task can be that action, but completely unattended
  operation cannot begin until consent has already been granted. Later loss of
  permission, model availability, quota, authentication, or network can still
  prevent completion.
  [sendRequest consent contract](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat)

### A VS Code extension is not a durable background worker

- Extension code runs in an extension host associated with the VS Code
  environment/window. VS Code invokes `activate` on an activation event and
  offers `deactivate` for cleanup on shutdown/disable, but there is no public
  durable-job or headless continuation API. A crash, host restart, window close,
  or laptop shutdown loses all in-memory orchestration and in-flight requests.
  [extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host),
  [extension entry points](https://code.visualstudio.com/api/get-started/extension-anatomy#extension-entry-file)
- VS Code restores `workspaceState` for the same workspace and provides a
  workspace-specific `storageUri` for larger data. Durability must be designed
  by the extension: commit task/event/checkpoint state before and after every
  transition, then reconstruct nonterminal work on activation. `deactivate`
  cannot be the sole persistence point because crashes and power loss may skip
  graceful cleanup.
  [data storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage)
- Resumption means replaying from the last durable checkpoint; an interrupted
  model stream or tool invocation cannot be resumed in place. Tool operations
  must be idempotent or reconciled before retry.

### `vscode.lm` alone cannot enforce the proposed hard safety boundary

- A task that executes workspace code requires a trusted workspace. Restricted
  Mode disables agents and limits terminal/tasks/extensions; Task mode should
  declare itself unsupported until `workspace.isTrusted` is true.
  [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust),
  [extension integration](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- Extension-owned file tools can enforce repository confinement at their API
  boundary by resolving and canonicalizing every target, rejecting paths outside
  the selected workspace root, rejecting symlink escapes, and never exposing a
  raw filesystem primitive to the model.
- Arbitrary local commands are different: a normal desktop extension or child
  process is not confined to the repository merely because its working
  directory is there. VS Code's agent terminal sandbox is a separate, preview
  product facility for native agent terminal sessions, not a general sandbox
  API promised to arbitrary extension-spawned processes. It is available only
  on macOS/Linux/WSL2, not Windows.
  [agent sandbox behavior](https://code.visualstudio.com/docs/agents/approvals#_sandbox-agent-commands)
- Native local stdio MCP sandboxing is likewise macOS/Linux only and not
  available on Windows. Unsandboxed local MCP servers can run arbitrary machine
  code; remote MCP tools can cause external side effects. Tool names and model
  descriptions are not a security boundary.
  [MCP sandboxing](https://code.visualstudio.com/docs/agent-customization/mcp-servers#_sandbox-mcp-servers)
- Consequently, the MVP cannot simultaneously promise arbitrary local commands,
  arbitrary repository-configured MCPs, no approvals, cross-platform support,
  and a hard repository-only boundary. To make the boundary truthful, the spec
  must choose one of these:
  1. require an independently enforced sandbox/container and disable Task mode
     execution when it is unavailable; or
  2. omit arbitrary command/MCP execution and expose only extension-owned,
     capability-scoped operations whose effects can be validated.

## Decision for the specification

Treat Task mode as a durable, extension-owned state machine rather than a
background service. It may run sequential or bounded-parallel subtasks while the
workspace extension host is alive, checkpoints every transition, automatically
reconstructs interrupted work on activation, and never pauses for discretionary
questions. It can still reach an explicit externally-blocked state for
unavoidable platform conditions such as missing consent, workspace/MCP trust,
authentication, quota, model removal, or unavailable network; claiming
guaranteed completion despite those conditions would contradict the API.

Use an extension-owned tool registry and dispatcher so agent-level tool/skill/MCP
filters are deterministic. Do not assume native Copilot tools or native
`.vscode/mcp.json` tools are callable from the custom workbench. If the product
retains `.github/mcp.json`, implement and secure an MCP client inside the
extension. Make hard containment a launch precondition: arbitrary commands and
MCPs are enabled only behind a separately enforced sandbox/container; otherwise
Task mode exposes only repo-confined extension tools. Chat while a Task is active
can use the same registry with all mutating tools removed.
