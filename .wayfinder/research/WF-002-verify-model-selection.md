# Evidence: Verify Copilot model discovery and selection constraints

Checked 2026-07-24 against the current official VS Code documentation and the
VS Code 1.117.0 public API declaration.

## Findings

### Discovery and explicit selection

- `vscode.lm.selectChatModels()` is the public discovery API. Its selector can
  match `vendor`, `family`, `version`, and `id`; omitting the selector returns
  all models. It can return multiple models or an empty array. The public API
  does not promise an ordering.
- For Copilot-backed models, query `{ vendor: "copilot" }`, then let the user
  choose from the returned `LanguageModelChat` values. The consumer-visible
  metadata is `name`, `id`, `vendor`, `family`, `version`, and
  `maxInputTokens`.
- Model IDs, families, and versions are opaque/provider-defined and may change.
  Persist a requested selection as at least `{ vendor, id }`, with family and
  version as diagnostic/fallback metadata; never persist the model object.
- The available set is dynamic. Subscribe to
  `vscode.lm.onDidChangeChatModels`, re-query on change and before a resumed
  request, and handle a saved model no longer resolving.

Sources:

- [VS Code 1.117 API: `LanguageModelChat`, selector, errors, and `selectChatModels`](https://github.com/microsoft/vscode/blob/1.117.0/src/vscode-dts/vscode.d.ts#L20237-L20378)
- [VS Code 1.117 API: model-change event and discovery semantics](https://github.com/microsoft/vscode/blob/1.117.0/src/vscode-dts/vscode.d.ts#L20732-L20765)
- [Language Model API guide: selecting and using models](https://code.visualstudio.com/api/extension-guides/ai/language-model#_send-the-language-model-request)

### Copilot Chat's selected model is not global extension state

- A registered native Chat participant receives the model currently selected
  for that request as `ChatRequest.model`; the declaration explicitly says not
  to retain it beyond that request.
- The public API exposes no getter/event for the selected model of another
  Copilot Chat session. Therefore a standalone sidebar/editor webview cannot
  observe or inherit Copilot Chat's current model selection. It must own its
  model selector. A native Chat participant could honor `request.model`, but
  that does not transfer the selection into the extension-owned workbench.

Source:

- [VS Code 1.117 API: request-scoped `ChatRequest.model`](https://github.com/microsoft/vscode/blob/1.117.0/src/vscode-dts/vscode.d.ts#L19850-L19898)

### Meaning of “Auto”

- In VS Code's own Chat UI, Auto is a routing feature: VS Code evaluates task
  complexity and real-time availability for each request, and the user can
  inspect the concrete model used afterward.
- `vscode.lm` exposes neither that router nor an Auto selector flag. Consequently,
  an Auto option in this extension must be explicitly extension-owned and must
  not claim to mirror Copilot Chat Auto.
- MVP contract: label it **Auto (extension)** in explanatory UI; resolve it for
  each request from the live Copilot model list using a documented, ordered
  fallback policy; record both `requestedSelection: "auto"` and the concrete
  `{ vendor, id, family, version }` used for every turn/attempt. Never rely on
  the array order returned by `selectChatModels`.

Source:

- [VS Code language-model docs: Auto model selection](https://code.visualstudio.com/docs/agent-customization/language-models#_use-auto-model-selection)

### Consent, availability, quota, and failure states

- Copilot model use requires per-extension user consent. Current API
  declarations say the first `sendRequest` can show consent UI and therefore
  must only occur from a user action. The guide is stricter and says
  `selectChatModels` should also be called from a user-initiated action. Follow
  the stricter rule.
- `ExtensionContext.languageModelAccessInformation.canSendRequest(model)` is a
  non-interactive preflight over persisted permission: `true` means allowed,
  `false` denied, and `undefined` means the model is missing or consent has not
  yet been requested. Its `onDidChange` event reports access changes.
- A model request can reject with `LanguageModelError`:
  `NoPermissions` (consent/access), `NotFound` (model disappeared), `Blocked`
  (including exceeded quota), or `Unknown` with a provider error in `cause`.
  Network and provider errors can also surface while consuming the response
  stream.
- No public API reports remaining quota or reset time. The UI can expose the
  classified error and retry status, but cannot promise when quota becomes
  available.
- Business/Enterprise policy can limit available models, and model availability
  changes over time. An empty discovery result is valid and must be handled.

Sources:

- [VS Code 1.117 API: consent and request failure contract](https://github.com/microsoft/vscode/blob/1.117.0/src/vscode-dts/vscode.d.ts#L20265-L20298)
- [VS Code 1.117 API: access preflight](https://github.com/microsoft/vscode/blob/1.117.0/src/vscode-dts/vscode.d.ts#L20851-L20868)
- [Language Model API guide: consent, errors, availability, and rate limiting](https://code.visualstudio.com/api/extension-guides/ai/language-model#_considerations)
- [VS Code language-model docs: organization policy and availability](https://code.visualstudio.com/docs/agent-customization/language-models#_change-the-model-for-chat)

## MVP implications

1. Model discovery/consent preflight must run from the user's Chat send or Task
   submission action. A newly submitted autonomous task should not enter the
   durable run queue until the selected/Auto-resolved model is discovered and
   consent is established.
2. On restart, silently re-resolve the stored model and check persisted access.
   Platform authorization cannot be bypassed: if consent is missing, durable
   state must become `waiting_for_model_authorization` until the user resumes
   from an explicit action. This is an external platform constraint, not an
   agent clarification pause.
3. Explicit selection fails over only according to a user-visible configured
   fallback policy; it must not silently change a specifically chosen model
   unless that policy permits it. Auto re-resolves on every request/attempt.
4. Handle `NotFound` by re-discovery, `Blocked` with durable bounded backoff,
   `NoPermissions` by waiting for user authorization, and transient/stream
   failures with idempotent retry from the last durable checkpoint. Always show
   the effective model and last classified failure in task/session status.

