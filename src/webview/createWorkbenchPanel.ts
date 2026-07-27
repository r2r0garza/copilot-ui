import * as vscode from "vscode";

import { WorkspaceStore, type ChatRecord, type TurnRecord } from "../adapters/sqlite/workspaceStore";
import { bundledOrchestrator, listChatAgents, resolveAvailableChatAgent, selectAvailableModel } from "../features/chats";
import type { EffectiveModelSnapshot, ResourceCatalogState, ResourceSnapshot } from "../features/resources";
import {
  ChatToolDispatcher,
  chatModelToolName,
  chatModelTools,
  reconcileWorkspaceOperations,
  resolveChatModelToolIdentity,
  type ChatToolApproval,
} from "../features/tools";
import type { Runtime } from "../runtime/createRuntime";
import { renderChatsView, type ChatViewState } from "./chatView";
import { renderAssistantMarkdown } from "./markdown";
import { renderResourceCatalog } from "./resourceView";

const VIEW_TYPE = "bridgit.workbench";

export function createWorkbenchPanel(
  context: vscode.ExtensionContext,
  _runtime: Runtime,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    "Bridgit Workbench",
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );

  let store: WorkspaceStore | undefined;
  const getStore = (): WorkspaceStore => {
    if (store) return store;
    store = new WorkspaceStore((context.storageUri ?? context.globalStorageUri).fsPath);
    const repositoryRoot = _runtime.resources.getState().workspaceRoot;
    if (repositoryRoot) {
      const recovered = reconcileWorkspaceOperations(store, repositoryRoot);
      const applied = recovered.filter(({ classification }) => classification === "applied").length;
      const notApplied = recovered.filter(({ classification }) => classification === "not-applied").length;
      const inconclusive = recovered.filter(({ classification }) => classification === "inconclusive").length;
      if (notApplied > 0) {
        void vscode.window.showInformationMessage(
          `Bridgit recovered ${operationCount(notApplied)}: no repository change was applied, and the operation was not retried.`,
        );
      }
      if (applied > 0) {
        void vscode.window.showInformationMessage(
          `Bridgit recovered ${operationCount(applied)} and confirmed the repository change was already applied. It was not replayed.`,
        );
      }
      if (inconclusive > 0) {
        void vscode.window.showWarningMessage("Bridgit blocked repository mutations because an interrupted Tool call could not be reconciled.");
      }
    }
    return store;
  };
  let selectedChatId: string | undefined;
  let showingTrash = false;
  const activeCancellations = new Map<string, { readonly attemptId: string; readonly source: vscode.CancellationTokenSource }>();
  let resourceState = _runtime.resources.getState();
  let draftAgentIdentity = bundledOrchestrator.identity;
  const currentState = (): ChatViewState => chatState(getStore(), selectedChatId, showingTrash, resourceState, draftAgentIdentity);
  const sendState = (messageType: "chat-state" | "chat-resource-state" = "chat-state"): Thenable<boolean> => {
    const state = currentState();
    selectedChatId = state.selectedChatId;
    return panel.webview.postMessage({ type: messageType, html: renderChatsView(state) });
  };
  let initialState: ChatViewState = {
    chats: [],
    selectedChatId: undefined,
    showingTrash: false,
    messages: [],
    ledger: [],
    activeAgentIdentity: bundledOrchestrator.identity,
    agents: listChatAgents(resourceState),
    catalogRevision: resourceState.revision,
    workspaceName: resourceState.workspaceName,
  };
  try { initialState = currentState(); selectedChatId = initialState.selectedChatId; } catch { /* The panel remains usable and surfaces storage errors on Send. */ }
  panel.webview.html = renderWorkbench(panel.webview, initialState, resourceState);
  const resourceSubscription = _runtime.resources.onDidChange((state) => {
    resourceState = state;
    void panel.webview.postMessage({ type: "resource-state", html: renderResourceCatalog(state) });
    void sendState("chat-resource-state");
  });
  panel.onDidDispose(() => resourceSubscription.dispose());

  const executeResponse = async (targetChat: ChatRecord, turn: TurnRecord): Promise<void> => {
    const authority = getStore();
    let activeAttemptId: string | undefined;
    let cancellation: vscode.CancellationTokenSource | undefined;
    try {
      if (!resolveAvailableChatAgent(resourceState, targetChat.agentIdentity)) throw new Error("This Chat’s Agent is no longer available. Select an available Agent to start a new Chat.");
      const models = await vscode.lm.selectChatModels();
      const agent = resolveAvailableChatAgent(resourceState, targetChat.agentIdentity);
      if (!agent) {
        const failedAttempt = authority.createResponseAttempt(turn.turnId, targetChat.requestedModelId);
        authority.transitionAttempt(failedAttempt.attemptId, "failed");
        throw new Error("This Chat’s Agent changed before its Resource Snapshot could be pinned.");
      }
      let modelSelection;
      try {
        modelSelection = selectAvailableModel(targetChat.requestedModelId, agent.model, models.map((model) => model.id));
      } catch (error) {
        const failedAttempt = authority.createResponseAttempt(turn.turnId, targetChat.requestedModelId);
        authority.transitionAttempt(failedAttempt.attemptId, "blocked");
        throw error;
      }
      const model = models.find((candidate) => candidate.id === modelSelection.effectiveModelId);
      if (!model) throw new Error("effective-model-disappeared");
      const attempt = authority.createResponseAttempt(turn.turnId, targetChat.requestedModelId, undefined, model.id);
      activeAttemptId = attempt.attemptId;
      const resourceSnapshot = _runtime.resources.createSnapshot(attempt.attemptId, agent, modelSnapshot(model, modelSelection.source));
      authority.pinResourceSnapshot(attempt.attemptId, resourceSnapshot.snapshotId, JSON.stringify(resourceSnapshot), resourceSnapshot.createdAt);
      authority.transitionAttempt(attempt.attemptId, "running");
      cancellation = new vscode.CancellationTokenSource();
      activeCancellations.set(targetChat.chatId, { attemptId: attempt.attemptId, source: cancellation });
      await sendState();
      if (targetChat.title === "New chat" && attempt.ordinal === 1) {
        authority.setChatTitle(targetChat.chatId, await generateChatTitle(model, turn.content, cancellation.token));
      }
      const repositoryRoot = resourceState.workspaceRoot;
      if (!repositoryRoot) throw new Error("Open a repository folder before using Chat.");
      const dispatcher = new ChatToolDispatcher({
        store: authority,
        repositoryRoot,
        chatId: targetChat.chatId,
        attemptId: attempt.attemptId,
        snapshot: resourceSnapshot,
        requestApproval: async ({ tool, affectedTargets, riskSummary }) => {
          if (cancellation?.token.isCancellationRequested) return "deny";
          authority.transitionAttempt(attempt.attemptId, "waiting-for-approval");
          await sendState();
          const detail = [
            riskSummary,
            affectedTargets.length ? `Targets: ${affectedTargets.join(", ")}` : "Target: active repository",
            "The exact Tool, scope, snapshot, decision, and outcome will be recorded locally.",
          ].join("\n\n");
          const choice = await vscode.window.showWarningMessage(
            `${resourceSnapshot.agentIdentity} wants to run ${tool.identity}.`,
            { modal: true, detail },
            "Allow once",
            "Allow for this Chat",
            "Deny",
          );
          if (cancellation?.token.isCancellationRequested) return "deny";
          authority.transitionAttempt(attempt.attemptId, "running");
          await sendState();
          return approvalFromChoice(choice);
        },
      });
      const output = await runChatModelWithTools(
        model,
        resourceSnapshot,
        buildChatContext(authority, targetChat.chatId),
        dispatcher,
        cancellation.token,
        async (visible) => {
          authority.checkpointOutput(turn.turnId, visible);
          await panel.webview.postMessage({ type: "chat-stream", html: renderAssistantMarkdown(visible) });
        },
      );
      if (cancellation.token.isCancellationRequested) throw new vscode.CancellationError();
      authority.appendOutput(turn.turnId, output || "The model returned no visible text.");
      authority.transitionAttempt(attempt.attemptId, "succeeded");
      await sendState();
    } catch (error) {
      if (activeAttemptId) {
        try {
          const requestedCancellation = cancellation?.token.isCancellationRequested === true;
          authority.transitionAttempt(activeAttemptId, requestedCancellation ? "cancelled" : "failed");
        } catch { /* Preserve the original classified failure. */ }
      }
      await sendState();
      if (!(error instanceof vscode.CancellationError) && cancellation?.token.isCancellationRequested !== true) {
        await panel.webview.postMessage({ type: "chat-error", message: error instanceof Error ? error.message : "Unable to send this Chat message." });
      }
    } finally {
      if (activeCancellations.get(targetChat.chatId)?.attemptId === activeAttemptId) activeCancellations.delete(targetChat.chatId);
      cancellation?.dispose();
    }
  };

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isResourceRefresh(message)) {
      const state = _runtime.resources.refresh();
      resourceState = state;
      await panel.webview.postMessage({ type: "resource-state", html: renderResourceCatalog(state) });
      await sendState("chat-resource-state");
      return;
    }
    if (isAgentSelect(message)) {
      try {
        const agent = resolveAvailableChatAgent(resourceState, message.agentIdentity);
        if (!agent) throw new Error("Select an available Agent from the active Resource Catalog.");
        draftAgentIdentity = agent.identity;
        const current = selectedChatId ? getStore().getChat(selectedChatId) : undefined;
        if (current?.agentIdentity !== agent.identity) {
          selectedChatId = getStore().createChat(agent.identity, null).chatId;
          showingTrash = false;
        }
        await sendState();
      } catch (error) {
        await panel.webview.postMessage({ type: "chat-error", message: error instanceof Error ? error.message : "Unable to select this Agent." });
      }
      return;
    }
    if (isChatAction(message)) {
      try {
        const authority = getStore(); const selected = selectedChatId;
        if (message.action === "new") {
          const agent = resolveAvailableChatAgent(resourceState, draftAgentIdentity) ?? bundledOrchestrator;
          draftAgentIdentity = agent.identity;
          selectedChatId = authority.createChat(agent.identity, null).chatId;
          showingTrash = false;
        }
        else if (message.action === "toggle-trash") showingTrash = !showingTrash;
        else if (message.action === "select") {
          const chat = message.chatId ? authority.getChat(message.chatId) : undefined;
          if (chat) { selectedChatId = chat.chatId; draftAgentIdentity = chat.agentIdentity; }
        }
        else if (!selected) throw new Error("select-or-create-a-chat-first");
        else if (message.action === "cancel-attempt") {
          const active = activeCancellations.get(selected);
          if (!active) throw new Error("chat-has-no-active-response");
          active.source.cancel();
          return;
        }
        else if (message.action === "retry-attempt") {
          const prior = message.attemptId ? authority.getResponseAttempt(message.attemptId) : undefined;
          const chat = authority.getChat(selected);
          const turn = prior ? authority.listTurns(selected).find((candidate) => candidate.turnId === prior.turnId) : undefined;
          if (!prior || !chat || !turn || !["blocked", "failed", "cancelled", "interrupted"].includes(prior.state)) throw new Error("response-attempt-not-retryable");
          if (authority.attemptHasUnsettledOperation(prior.attemptId)) throw new Error("Reconcile the prior Tool outcome before retrying this response.");
          await executeResponse(chat, turn);
          return;
        }
        else if (message.action === "generate-summary") {
          const chat = authority.getChat(selected);
          const agent = chat ? resolveAvailableChatAgent(resourceState, chat.agentIdentity) : undefined;
          if (!chat || !agent) throw new Error("chat-agent-unavailable");
          if (activeCancellations.has(chat.chatId)) throw new Error("Wait for the active response before generating a summary.");
          const models = await vscode.lm.selectChatModels();
          const selection = selectAvailableModel(chat.requestedModelId, agent.model, models.map((model) => model.id));
          const model = models.find((candidate) => candidate.id === selection.effectiveModelId);
          if (!model) throw new Error("effective-model-disappeared");
          const turns = authority.listTurns(chat.chatId);
          if (turns.length === 0) throw new Error("chat-has-no-history");
          const summaryCancellation = new vscode.CancellationTokenSource();
          try {
            const summary = await generateConversationSummary(model, buildChatContext(authority, chat.chatId), summaryCancellation.token);
            authority.createSummary(chat.chatId, summary, `explicit:model:${model.id}:through-turn:${turns.at(-1)?.turnId}`);
          } finally {
            summaryCancellation.dispose();
          }
        }
        else if (message.action === "add-ledger") {
          if (!message.content?.trim()) throw new Error("ledger-content-empty");
          authority.appendLedger(selected, message.kind?.trim() || "note", message.content, "explicit-user-entry");
        }
        else if (message.action === "correct-ledger") {
          if (!message.entryId || !message.content?.trim()) throw new Error("ledger-correction-invalid");
          authority.correctLedger(message.entryId, message.content, `user-correction:${message.rationale?.trim() || "corrected in Workbench"}`);
        }
        else if (message.action === "fork") { selectedChatId = authority.forkChat(selected, authority.getChat(selected)?.agentIdentity ?? "bundled:orchestrator").chatId; showingTrash = false; }
        else if (message.action === "trash") { activeCancellations.get(selected)?.source.cancel(); authority.trashChat(selected); selectedChatId = authority.listChats()[0]?.chatId; showingTrash = false; }
        else if (message.action === "restore") { authority.restoreChat(selected); showingTrash = false; }
        else if (message.action === "rename") { if (!message.title?.trim()) throw new Error("chat-title-empty"); authority.setChatTitle(selected, message.title); }
        else if (message.action === "delete") { authority.deleteChatPermanently(selected, true); selectedChatId = authority.listChats(true)[0]?.chatId; }
        await sendState();
      } catch (error) { await panel.webview.postMessage({ type: "chat-error", message: error instanceof Error ? error.message : "Unable to update this Chat." }); }
      return;
    }
    if (!isSendMessage(message)) return;
    const content = message.content.trim();
    if (!content) return;
    try {
      const authority = getStore();
      const chat = selectedChatId ? authority.getChat(selectedChatId) : undefined;
      const targetChat = chat ?? authority.createChat(draftAgentIdentity, null);
      selectedChatId = targetChat.chatId;
      if (!resolveAvailableChatAgent(resourceState, targetChat.agentIdentity)) throw new Error("This Chat’s Agent is no longer available. Select an available Agent to start a new Chat.");
      const turn = authority.submitTurn(targetChat.chatId, content);
      await panel.webview.postMessage({ type: "chat-user-markdown", html: renderAssistantMarkdown(content) });
      await executeResponse(targetChat, turn);
    } catch (error) {
      await panel.webview.postMessage({ type: "chat-error", message: error instanceof Error ? error.message : "Unable to send this Chat message." });
    }
  });
  context.subscriptions.push(panel, { dispose: () => store?.close() });
  return panel;
}

function renderWorkbench(webview: vscode.Webview, state: ChatViewState, resources: ResourceCatalogState): string {
  const nonce = createNonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Bridgit Workbench</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { height: 100vh; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-weight) var(--vscode-font-size) var(--vscode-font-family); }
      button { color: inherit; font: inherit; }
      .workbench { height: 100vh; display: grid; grid-template-columns: 188px minmax(0, 1fr); overflow: hidden; }
      .rail { height: 100vh; padding: 18px 10px; overflow-y: auto; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .brand { display: flex; gap: 9px; align-items: center; margin: 3px 10px 26px; font-weight: 700; letter-spacing: .02em; }
      .brand-mark { width: 20px; height: 20px; display: grid; place-items: center; border: 1px solid var(--vscode-focusBorder); color: var(--vscode-focusBorder); font-size: 12px; }
      .navigation { display: grid; gap: 3px; }
      .nav-button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; background: transparent; border: 0; border-radius: 3px; cursor: pointer; text-align: left; color: var(--vscode-sideBar-foreground); }
      .nav-button:hover { background: var(--vscode-list-hoverBackground); }
      .nav-button[aria-selected="true"] { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
      .nav-icon { width: 16px; color: var(--vscode-descriptionForeground); text-align: center; }
      .nav-button[aria-selected="true"] .nav-icon { color: inherit; }
      .rail-footer { margin: 28px 10px 0; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.5; }
      .content { min-width: 0; height: 100vh; overflow: hidden; padding: clamp(22px, 4vw, 54px); }
      .view { display: none; max-width: 1180px; margin: 0 auto; }
      .view[data-active="true"] { display: block; }
      .eyebrow { margin: 0 0 8px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(25px, 3vw, 38px); font-weight: 600; letter-spacing: -.025em; }
      .lede { max-width: 660px; margin: 12px 0 30px; color: var(--vscode-descriptionForeground); font-size: 14px; line-height: 1.6; }
      .board { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .card { min-height: 155px; padding: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); }
      .card--wide { grid-column: span 2; }
      .card-heading { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 16px; font-weight: 600; }
      .status { padding: 2px 7px; border: 1px solid var(--vscode-badge-background); border-radius: 99px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 11px; font-weight: 600; }
      .status--quiet { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); background: transparent; }
      .card p, .empty-state p { margin: 0; color: var(--vscode-descriptionForeground); line-height: 1.55; }
      .empty-state { padding: clamp(28px, 7vw, 80px) 18px; border-top: 1px solid var(--vscode-panel-border); text-align: center; }
      .empty-state h2 { margin: 0 0 9px; font-size: 18px; font-weight: 600; }
      .empty-state p { max-width: 480px; margin: 0 auto; }
      .subtasks { display: grid; gap: 9px; }
      .subtask { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--vscode-panel-border); }
      .subtask:last-child { border-bottom: 0; }
      .subtask small { color: var(--vscode-descriptionForeground); }
      .chat-view { height: calc(100vh - 44px); max-width: 1280px; overflow-y: auto; padding: 0 2px 42px; scrollbar-gutter: stable; }
      .chat-masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
      .chat-masthead .lede { margin-bottom: 22px; }
      .chat-actions, .chat-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
      .chat-actions { margin-top: 19px; }
      .new-chat-action { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
      .chat-context-strip { display: grid; grid-template-columns: minmax(280px, 1.65fr) minmax(150px, .7fr) minmax(190px, .9fr); margin-bottom: 14px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .agent-picker, .context-cell { min-height: 82px; display: flex; flex-direction: column; justify-content: center; gap: 5px; padding: 12px 16px; border-right: 1px solid var(--vscode-panel-border); }
      .context-cell:last-child { border-right: 0; }
      .context-label { color: var(--vscode-descriptionForeground); font-size: 9px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
      .context-value { font-size: 14px; font-weight: 650; }
      .context-detail { min-width: 0; overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .agent-select-wrap { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 10px; align-items: center; }
      .agent-select-wrap select { width: 100%; min-width: 0; padding: 0 24px 0 0; border: 0; outline: 0; color: var(--vscode-foreground); background: transparent; font: 650 14px var(--vscode-font-family); cursor: pointer; }
      .agent-select-wrap select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 3px; }
      .chat-shell { min-height: 430px; height: calc(100vh - 300px); display: grid; grid-template-columns: 218px minmax(0, 1fr); border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
      .session-panel { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .session-panel-header, .conversation-header { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--vscode-panel-border); background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent), transparent); }
      .session-panel-header .eyebrow { margin-bottom: 2px; font-size: 9px; }
      .session-panel-header h2 { margin: 0; font-size: 13px; font-weight: 650; }
      .session-list { min-height: 0; padding: 7px; overflow-y: auto; }
      .session-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 9px; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; cursor: pointer; }
      .session-item:hover { background: var(--vscode-list-hoverBackground); }
      .session-item[aria-current="true"] { border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
      .session-copy { min-width: 0; display: grid; gap: 4px; }
      .session-copy strong { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .session-copy small { overflow: hidden; color: var(--vscode-descriptionForeground); font: 9px var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
      .session-tag { padding: 2px 4px; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 8px; letter-spacing: .06em; text-transform: uppercase; }
      .session-empty { display: grid; place-items: center; gap: 8px; padding: 38px 10px; color: var(--vscode-descriptionForeground); text-align: center; }
      .session-empty > span { font-size: 20px; }
      .session-empty p { margin: 0; font-size: 11px; }
      .conversation-panel { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto auto; }
      .conversation-header { padding-inline: 16px; }
      .conversation-identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .conversation-identity > div { min-width: 0; display: grid; gap: 3px; }
      .conversation-identity strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .agent-monogram { width: 30px; height: 30px; display: grid; flex: 0 0 auto; place-items: center; border: 1px solid var(--vscode-focusBorder); color: var(--vscode-focusBorder); background: color-mix(in srgb, var(--vscode-focusBorder) 7%, transparent); font: 700 10px var(--vscode-editor-font-family); }
      .quiet-action, .danger-action { padding: 7px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: transparent; cursor: pointer; }
      .quiet-action:hover, .danger-action:hover { background: var(--vscode-list-hoverBackground); }
      .danger-action { color: var(--vscode-errorForeground); }
      .toolbar-input { min-width: 190px; padding: 7px 9px; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 3px; background: var(--vscode-input-background); font: inherit; }
      .transcript { min-height: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 15px; padding: 22px; overflow-y: auto; background-image: linear-gradient(color-mix(in srgb, var(--vscode-panel-border) 25%, transparent) 1px, transparent 1px); background-size: 100% 42px; }
      .message { width: fit-content; max-width: min(82%, 680px); flex: 0 0 auto; border: 1px solid var(--vscode-panel-border); border-left: 2px solid var(--vscode-testing-iconPassed); background: color-mix(in srgb, var(--vscode-textBlockQuote-background) 82%, var(--vscode-editor-background)); overflow-wrap: anywhere; }
      .message header { display: flex; justify-content: space-between; gap: 12px; padding: 6px 11px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font: 9px var(--vscode-editor-font-family); letter-spacing: .08em; }
      .attempt-state { color: var(--vscode-errorForeground); text-transform: uppercase; }
      .message > div { padding: 9px 11px 10px; white-space: pre-wrap; line-height: 1.5; }
      .message.user { align-self: flex-end; border-left: 1px solid var(--vscode-panel-border); border-right: 2px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
      .message.assistant { align-self: flex-start; }
      .message.markdown > div { white-space: normal; }
      .message.markdown p { margin: 0 0 9px; }
      .message.markdown p:last-child { margin-bottom: 0; }
      .message.markdown ul, .message.markdown ol { margin: 7px 0; padding-left: 22px; }
      .message.markdown blockquote { margin: 8px 0; padding-left: 10px; color: var(--vscode-descriptionForeground); border-left: 2px solid var(--vscode-textBlockQuote-border); }
      .message.markdown code { padding: 1px 4px; border-radius: 2px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: .92em; }
      .message.markdown pre { max-width: 100%; margin: 8px 0; padding: 9px 10px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); }
      .message.markdown pre code { padding: 0; background: transparent; }
      .message.markdown a { color: var(--vscode-textLink-foreground); }
      .message.markdown h1, .message.markdown h2, .message.markdown h3 { margin: 12px 0 7px; font-size: 1em; }
      .markdown-image-placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
      .transcript-empty { width: min(460px, 90%); margin: auto; text-align: center; }
      .empty-glyph { display: block; margin-bottom: 13px; color: var(--vscode-focusBorder); font-size: 29px; }
      .transcript-empty h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
      .transcript-empty p { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.55; }
      .session-context { border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .session-context > summary { display: flex; justify-content: space-between; gap: 12px; padding: 8px 14px; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 10px; }
      .session-context-grid { max-height: 220px; display: grid; grid-template-columns: 1fr 1fr; overflow-y: auto; border-top: 1px solid var(--vscode-panel-border); }
      .session-context-grid > section { min-width: 0; padding: 12px 14px; }
      .session-context-grid > section + section { border-left: 1px solid var(--vscode-panel-border); }
      .context-section-heading, .context-record header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .context-section-heading { margin-bottom: 9px; }
      .context-section-heading h3 { margin: 0; font-size: 12px; }
      .context-section-heading .eyebrow { margin-bottom: 2px; font-size: 8px; }
      .context-record { margin-top: 7px; padding: 9px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
      .context-record strong { font-size: 10px; text-transform: capitalize; }
      .context-record small { overflow: hidden; color: var(--vscode-descriptionForeground); font: 8px var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
      .context-record p, .context-empty { margin: 7px 0 0; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
      .text-action { margin-top: 5px; padding: 0; border: 0; color: var(--vscode-textLink-foreground); background: transparent; cursor: pointer; font-size: 9px; }
      .ledger-editor { display: grid; gap: 7px; margin: 7px 0 10px; padding: 9px; border: 1px solid var(--vscode-focusBorder); background: var(--vscode-editor-background); }
      .ledger-editor input, .ledger-editor textarea { width: 100%; min-height: 32px; padding: 7px 8px; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); font: inherit; }
      .ledger-editor textarea { min-height: 64px; resize: vertical; }
      .ledger-editor-actions { display: flex; justify-content: flex-end; gap: 7px; }
      .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 12px 14px 14px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .composer-field { min-width: 0; display: grid; gap: 5px; }
      .composer-hint { color: var(--vscode-descriptionForeground); font-size: 9px; }
      .composer-hint strong { color: var(--vscode-foreground); font-weight: 500; }
      .chat-error { min-height: 0; margin: 0; padding: 0 14px; color: var(--vscode-errorForeground); background: var(--vscode-sideBar-background); font-size: 11px; }
      .chat-error:not(:empty) { padding-top: 9px; }
      textarea { min-height: 42px; max-height: 180px; resize: none; overflow-y: hidden; padding: 10px; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px; background: var(--vscode-input-background); font: inherit; line-height: 21px; }
      textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
      .send { align-self: end; padding: 9px 14px; color: var(--vscode-button-foreground); border: 0; border-radius: 2px; background: var(--vscode-button-background); cursor: pointer; font-weight: 600; }
      .send:hover { background: var(--vscode-button-hoverBackground); }
      .send:disabled, textarea:disabled { cursor: not-allowed; opacity: .55; }
      .composer-send { display: flex; align-items: center; gap: 7px; }
      .resource-view { height: calc(100vh - 44px); max-width: 1280px; overflow-y: auto; padding: 0 2px 48px; scrollbar-gutter: stable; }
      .resource-masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
      .resource-masthead .lede { margin-bottom: 22px; }
      .refresh-action { display: flex; gap: 7px; align-items: center; margin-top: 19px; white-space: nowrap; }
      .catalog-strip { display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)) minmax(180px, 1.5fr); margin-bottom: 18px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .catalog-count, .catalog-revision { min-height: 68px; display: flex; align-items: center; gap: 9px; padding: 13px 16px; border-right: 1px solid var(--vscode-panel-border); }
      .catalog-count strong { font-size: 21px; font-variant-numeric: tabular-nums; }
      .catalog-count > span:last-child, .catalog-revision span { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .07em; }
      .catalog-revision { border-right: 0; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; }
      .catalog-revision code { color: var(--vscode-textLink-foreground); font-size: 12px; letter-spacing: .06em; }
      .state-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--vscode-descriptionForeground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-descriptionForeground) 16%, transparent); }
      .state-dot--available { background: var(--vscode-testing-iconPassed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent); }
      .state-dot--unavailable { background: var(--vscode-editorWarning-foreground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, transparent); }
      .state-dot--invalid { background: var(--vscode-errorForeground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent); }
      .resource-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: start; gap: 14px; }
      .resource-group, .diagnostic-ledger { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
      .resource-group > summary, .diagnostic-ledger > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 69px; padding: 13px 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent), transparent); }
      .resource-group > summary { cursor: pointer; list-style: none; user-select: none; }
      .resource-group > summary::-webkit-details-marker { display: none; }
      .resource-group > summary:hover { background-color: var(--vscode-list-hoverBackground); }
      .resource-group > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
      .resource-group[open] > summary, .diagnostic-ledger > header { border-bottom: 1px solid var(--vscode-panel-border); }
      .resource-group h2, .diagnostic-ledger h2 { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: .01em; }
      .resource-group summary p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
      .resource-group-meta { display: flex; align-items: center; gap: 9px; }
      .resource-total { min-width: 25px; padding: 3px 7px; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font: 11px var(--vscode-editor-font-family); text-align: center; }
      .resource-chevron { color: var(--vscode-descriptionForeground); font-size: 16px; line-height: 1; transform: rotate(-90deg); transition: transform 120ms ease; }
      .resource-group[open] .resource-chevron { transform: rotate(0); }
      .resource-list { min-height: 176px; }
      .resource-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 11px; align-items: start; padding: 13px 15px; border-bottom: 1px solid var(--vscode-panel-border); }
      .resource-row:last-child { border-bottom: 0; }
      .resource-row .state-dot { margin-top: 5px; }
      .resource-copy { min-width: 0; }
      .resource-name { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
      .resource-name strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .resource-name code { color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
      .resource-copy p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
      .resource-status { display: none; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
      .resource-empty { margin: 0; padding: 22px 16px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
      .diagnostic-ledger { margin-top: 14px; }
      .diagnostic-ledger .eyebrow { margin-bottom: 3px; }
      .diagnostic-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .diagnostic { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 7px 10px; align-items: center; padding: 13px 15px; border-right: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border); }
      .diagnostic:nth-child(2n) { border-right: 0; }
      .diagnostic-severity { padding: 2px 5px; border: 1px solid currentColor; font-size: 9px; text-transform: uppercase; letter-spacing: .07em; }
      .diagnostic--error .diagnostic-severity { color: var(--vscode-errorForeground); }
      .diagnostic--warning .diagnostic-severity { color: var(--vscode-editorWarning-foreground); }
      .diagnostic--info .diagnostic-severity { color: var(--vscode-textLink-foreground); }
      .diagnostic code { color: var(--vscode-descriptionForeground); font-size: 10px; }
      .diagnostic strong { overflow: hidden; text-overflow: ellipsis; text-align: right; white-space: nowrap; }
      .diagnostic p { grid-column: 1 / -1; margin: 1px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
      @media (max-width: 980px) { .resource-grid { grid-template-columns: 1fr; } .resource-list { min-height: auto; } .chat-context-strip { grid-template-columns: 1fr 1fr; } .agent-picker { grid-column: 1 / -1; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } }
      @media (max-width: 760px) { .workbench { grid-template-columns: 58px minmax(0, 1fr); } .brand span, .nav-label, .rail-footer { display: none; } .brand { justify-content: center; margin-inline: 0; } .nav-button { justify-content: center; padding-inline: 4px; } .board { grid-template-columns: 1fr; } .card--wide { grid-column: auto; } .content { padding: 24px 18px; } .chat-masthead, .resource-masthead { display: block; } .chat-actions { justify-content: flex-start; margin: 0 0 16px; } .refresh-action { margin: 0 0 16px; } .chat-shell { height: auto; grid-template-columns: 1fr; } .session-panel { max-height: 190px; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .conversation-panel { min-height: 440px; } .session-context-grid { grid-template-columns: 1fr; } .session-context-grid > section + section { border-left: 0; border-top: 1px solid var(--vscode-panel-border); } .catalog-strip { grid-template-columns: repeat(3, 1fr); } .catalog-revision { grid-column: 1 / -1; border-top: 1px solid var(--vscode-panel-border); } .diagnostic-list { grid-template-columns: 1fr; } .diagnostic { border-right: 0; } }
      @media (max-width: 480px) { .chat-context-strip { grid-template-columns: 1fr; } .agent-picker, .context-cell { grid-column: auto; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .context-cell:last-child { border-bottom: 0; } .conversation-header { align-items: flex-start; } .chat-toolbar { justify-content: flex-start; } .message { max-width: 94%; } .composer { grid-template-columns: 1fr; } .composer-send { justify-content: center; } }
    </style>
  </head>
  <body>
    <main class="workbench">
      <aside class="rail" aria-label="Workbench navigation">
        <div class="brand"><span class="brand-mark">B</span><span>Bridgit</span></div>
        <nav class="navigation" role="tablist" aria-label="Workbench areas">
          ${navigationButton("tasks", "◈", "Tasks", true)}
          ${navigationButton("chats", "◌", "Chats")}
          ${navigationButton("activity", "≡", "Activity")}
          ${navigationButton("agents", "◇", "Resources")}
          ${navigationButton("memory", "◫", "Memory")}
          ${navigationButton("settings", "⚙", "Settings")}
        </nav>
        <p class="rail-footer">Local-first<br>Repository workbench</p>
      </aside>
      <section class="content">
        ${tasksView()}
        ${renderChatsView(state)}
        ${emptyView("activity", "Activity", "Meaningful outcomes", "Recovery notices, approvals, and execution outcomes will form a concise chronological record here.")}
        ${renderResourceCatalog(resources)}
        ${emptyView("memory", "Memory", "Explicit, inspectable memory", "Project and Personal Memory stay separate from session-local ledgers and require explicit confirmation.")}
        ${emptyView("settings", "Settings", "Repository-scoped Workbench settings", "Model selection, tools, authority, storage, and native resource locations will be configured here.")}
      </section>
    </main>
    <script nonce="${nonce}">
      const buttons = [...document.querySelectorAll('.nav-button')];
      for (const button of buttons) button.addEventListener('click', () => {
        const target = button.dataset.target;
        for (const candidate of buttons) candidate.setAttribute('aria-selected', String(candidate === button));
        for (const view of document.querySelectorAll('.view')) view.dataset.active = String(view.id === target);
        if (target === 'chats') requestAnimationFrame(scrollToLatest);
      });
      const vscode = acquireVsCodeApi(); const transcript = () => document.querySelector('#transcript'); const chatError = () => document.querySelector('#chat-error'); const scrollToLatest = () => { const element = transcript(); if (element) element.scrollTop = element.scrollHeight; }; const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const resizeComposer = (input) => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden'; };
      document.addEventListener('input', (event) => { if (event.target instanceof HTMLTextAreaElement && event.target.id === 'chat-input') resizeComposer(event.target); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && event.target instanceof HTMLTextAreaElement && event.target.id === 'chat-input') { event.preventDefault(); event.target.form?.requestSubmit(); } });
      document.addEventListener('submit', (event) => { if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'chat-form') return; event.preventDefault(); const input = document.querySelector('#chat-input'); const element = transcript(); const error = chatError(); const agent = document.querySelector('.conversation-identity strong')?.textContent || 'Agent'; if (input instanceof HTMLTextAreaElement && input.value.trim() && element) { const content = input.value; element.querySelector('.transcript-empty')?.remove(); element.innerHTML += '<article id="pending-user-message" class="message markdown user"><header><span>YOU</span></header><div>' + escapeHtml(content) + '</div></article><article id="streaming-response" class="message markdown assistant"><header><span>' + escapeHtml(agent) + '</span></header><div></div></article>'; scrollToLatest(); if (error) error.textContent = 'Sending…'; vscode.postMessage({ type: 'chat-send', content }); input.value = ''; resizeComposer(input); } });
      document.addEventListener('change', (event) => { if (event.target instanceof HTMLSelectElement && event.target.id === 'chat-agent-select') vscode.postMessage({ type: 'chat-agent-select', agentIdentity: event.target.value }); });
      const saveRename = () => { const title = document.querySelector('#rename-input')?.value || ''; vscode.postMessage({ type: 'chat-action', action: 'rename', title }); };
      document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('#resource-refresh')) vscode.postMessage({ type: 'resource-refresh' }); });
      document.addEventListener('click', (event) => { if (!(event.target instanceof Element)) return; const control = event.target.closest('[data-chat-action]'); if (!control) return; const action = control.dataset.chatAction; const toolbar = document.querySelector('#chat-toolbar'); const selectedTitle = document.querySelector('.session-item[aria-current="true"] span')?.textContent || ''; if (action === 'rename') { if (toolbar) { toolbar.innerHTML = '<input id="rename-input" class="toolbar-input" aria-label="Chat title" value="' + escapeHtml(selectedTitle) + '"><button data-chat-action="rename-save" class="send" type="button">Save</button><button data-chat-action="rename-cancel" class="quiet-action" type="button">Cancel</button>'; const input = document.querySelector('#rename-input'); input?.focus(); input?.select(); } return; } if (action === 'rename-cancel') { vscode.postMessage({ type: 'chat-action', action: 'select' }); return; } if (action === 'rename-save') { saveRename(); return; } if (action === 'add-ledger-open' || action === 'correct-ledger-open') { const slot = document.querySelector('#ledger-editor-slot'); if (!slot) return; const correcting = action === 'correct-ledger-open'; const content = correcting ? control.dataset.entryContent || '' : ''; slot.innerHTML = '<div class="ledger-editor" data-mode="' + (correcting ? 'correct' : 'add') + '" data-entry-id="' + escapeHtml(control.dataset.entryId || '') + '"><label class="context-label" for="ledger-content">' + (correcting ? 'Corrected entry' : 'Ledger note') + '</label><textarea id="ledger-content" aria-label="' + (correcting ? 'Corrected Ledger entry' : 'New Ledger note') + '">' + escapeHtml(content) + '</textarea>' + (correcting ? '<label class="context-label" for="ledger-rationale">Correction rationale</label><input id="ledger-rationale" aria-label="Correction rationale" value="User correction in Workbench">' : '') + '<div class="ledger-editor-actions"><button data-chat-action="ledger-editor-cancel" class="quiet-action" type="button">Cancel</button><button data-chat-action="ledger-editor-save" class="send" type="button">Save</button></div></div>'; const input = document.querySelector('#ledger-content'); input?.focus(); if (correcting && input instanceof HTMLTextAreaElement) input.select(); return; } if (action === 'ledger-editor-cancel') { const slot = document.querySelector('#ledger-editor-slot'); if (slot) slot.innerHTML = ''; return; } if (action === 'ledger-editor-save') { const editor = control.closest('.ledger-editor'); const content = editor?.querySelector('#ledger-content')?.value || ''; if (!content.trim()) { const error = chatError(); if (error) error.textContent = 'Ledger content cannot be empty.'; return; } if (editor?.dataset.mode === 'correct') { const rationale = editor.querySelector('#ledger-rationale')?.value || 'User correction in Workbench'; vscode.postMessage({ type: 'chat-action', action: 'correct-ledger', entryId: editor.dataset.entryId, content, rationale }); } else { vscode.postMessage({ type: 'chat-action', action: 'add-ledger', kind: 'note', content }); } control.setAttribute('disabled', ''); control.textContent = 'Saving…'; return; } if (action === 'delete') { if (toolbar) toolbar.innerHTML = '<span class="muted">Permanently delete this private Chat? Repository changes, promoted Memory, and surviving forks remain.</span><button data-chat-action="delete-confirm" class="danger-action" type="button">Confirm delete</button><button data-chat-action="delete-cancel" class="quiet-action" type="button">Cancel</button>'; return; } if (action === 'delete-cancel') { vscode.postMessage({ type: 'chat-action', action: 'select' }); return; } if (action === 'delete-confirm') { vscode.postMessage({ type: 'chat-action', action: 'delete' }); return; } vscode.postMessage({ type: 'chat-action', action, chatId: control.dataset.chatId, attemptId: control.dataset.attemptId }); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'rename-input') { event.preventDefault(); saveRename(); } });
      const replaceView = (id, html) => { const current = document.querySelector('#' + id); if (!current) return; const active = current.dataset.active; const template = document.createElement('template'); template.innerHTML = html; const next = template.content.firstElementChild; if (next) { next.dataset.active = active; current.replaceWith(next); } };
      const refreshChatResources = (html) => { const prior = document.querySelector('#chat-input'); const draft = prior instanceof HTMLTextAreaElement ? prior.value : ''; const focused = prior === document.activeElement; replaceView('chats', html); const next = document.querySelector('#chat-input'); if (next instanceof HTMLTextAreaElement && !next.disabled) { next.value = draft; resizeComposer(next); if (focused) next.focus(); } };
      window.addEventListener('message', (event) => { const message = event.data; if (message.type === 'chat-state') { replaceView('chats', message.html); scrollToLatest(); } if (message.type === 'chat-resource-state') refreshChatResources(message.html); if (message.type === 'chat-user-markdown') { const pending = document.querySelector('#pending-user-message > div'); if (pending) { pending.innerHTML = message.html; pending.parentElement?.removeAttribute('id'); scrollToLatest(); } } if (message.type === 'chat-stream') { let stream = document.querySelector('#streaming-response > div'); const element = transcript(); if (!stream && element) { const agent = document.querySelector('.conversation-identity strong')?.textContent || 'Agent'; element.innerHTML += '<article id="streaming-response" class="message markdown assistant"><header><span>' + escapeHtml(agent) + '</span></header><div></div></article>'; stream = document.querySelector('#streaming-response > div'); } if (stream) { stream.innerHTML = message.html; scrollToLatest(); } } if (message.type === 'chat-error') { const error = chatError(); if (error) error.textContent = message.message; } if (message.type === 'resource-state') replaceView('agents', message.html); });
    </script>
  </body>
</html>`;
}

function chatState(
  store: WorkspaceStore,
  requestedChatId: string | undefined,
  showingTrash: boolean,
  resources: ResourceCatalogState,
  draftAgentIdentity: string,
): ChatViewState {
  const chats = store.listChats(true).filter((chat) => showingTrash ? Boolean(chat.trashedAt) : !chat.trashedAt);
  const selectedChatId = chats.some((chat) => chat.chatId === requestedChatId) ? requestedChatId : chats[0]?.chatId;
  const chat = selectedChatId ? store.getChat(selectedChatId) : undefined;
  const activeAgentIdentity = chat?.agentIdentity
    ?? resolveAvailableChatAgent(resources, draftAgentIdentity)?.identity
    ?? bundledOrchestrator.identity;
  const attempts = chat ? store.listResponseAttempts(chat.chatId) : [];
  const latestAttemptForTurn = new Map<string, typeof attempts[number]>();
  for (const attempt of attempts) latestAttemptForTurn.set(attempt.turnId, attempt);
  const messages = chat ? [
    ...store.listTurns(chat.chatId).map((turn) => ({ role: "user" as const, content: turn.content, createdAt: turn.submittedAt })),
    ...store.listOutputs(chat.chatId).map((output) => ({ role: "assistant" as const, content: output.content, createdAt: output.createdAt, attemptState: latestAttemptForTurn.get(output.turnId)?.state })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)) : [];
  const activeAttempt = [...attempts].reverse().find((attempt) => ["preparing", "running", "waiting-for-approval"].includes(attempt.state));
  const latestAttempt = attempts.at(-1);
  const retryAttemptId = !activeAttempt && latestAttempt && ["blocked", "failed", "cancelled", "interrupted"].includes(latestAttempt.state) ? latestAttempt.attemptId : undefined;
  const summaries = chat ? store.listSummaries(chat.chatId) : [];
  const activeSummary = summaries.find((summary) => summary.active);
  return {
    chats: chats.map((item) => ({
      chatId: item.chatId,
      label: item.title,
      agentIdentity: item.agentIdentity,
      trashed: Boolean(item.trashedAt),
      forked: Boolean(item.originChatId),
      forkOriginDeleted: item.forkOriginDeleted,
    })),
    selectedChatId,
    showingTrash,
    messages: messages.map(({ role, content, ...message }) => ({ role, content, ...message })),
    activeAttemptId: activeAttempt?.attemptId,
    retryAttemptId,
    summary: activeSummary ? { content: activeSummary.content, provenance: activeSummary.provenance, version: summaries.findIndex((summary) => summary.summaryId === activeSummary.summaryId) + 1 } : undefined,
    ledger: chat ? store.listLedger(chat.chatId).map(({ entryId, kind, content, provenance, status }) => ({ entryId, kind, content, provenance, status })) : [],
    repositoryWriteLockHolder: store.repositoryWriteLockHolder(),
    activeAgentIdentity,
    agents: listChatAgents(resources),
    catalogRevision: resources.revision,
    workspaceName: resources.workspaceName,
  };
}

async function runChatModelWithTools(
  model: vscode.LanguageModelChat,
  snapshot: ResourceSnapshot,
  context: readonly ChatContextMessage[],
  dispatcher: ChatToolDispatcher,
  token: vscode.CancellationToken,
  checkpoint: (visible: string) => Promise<void>,
): Promise<string> {
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(`Follow these repository Agent instructions for this response:\n\n${snapshot.agent.instructions}`),
    ...context.map((message) => message.role === "user"
      ? vscode.LanguageModelChatMessage.User(message.content)
      : vscode.LanguageModelChatMessage.Assistant(message.content)),
  ];
  const tools = chatModelTools(snapshot).map((tool): vscode.LanguageModelChatTool => ({
    name: chatModelToolName(tool.identity),
    description: `${tool.description} Bridgit identity: ${tool.identity}.`,
    inputSchema: tool.inputSchema,
  }));
  let visible = "";
  let invocationCount = 0;
  const maxRounds = 8;
  const maxInvocations = 16;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await model.sendRequest(messages, {
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    }, token);
    const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
    const calls: vscode.LanguageModelToolCallPart[] = [];
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        assistantParts.push(part);
        visible += part.value;
        await checkpoint(visible);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantParts.push(part);
        calls.push(part);
      }
    }
    if (calls.length === 0) return visible;
    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
    const results: vscode.LanguageModelToolResultPart[] = [];
    for (const call of calls) {
      invocationCount += 1;
      const identity = resolveChatModelToolIdentity(snapshot, call.name);
      const result = invocationCount <= maxInvocations
        ? identity
          ? await dispatcher.invoke(call.callId, identity, call.input)
          : dispatcher.reject(call.callId, call.name, call.input, "tool-not-in-pinned-workbench-snapshot")
        : dispatcher.reject(call.callId, call.name, call.input, "tool-call-budget-exhausted");
      results.push(new vscode.LanguageModelToolResultPart(call.callId, [
        new vscode.LanguageModelTextPart(JSON.stringify(result)),
      ]));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
    if (invocationCount >= maxInvocations) {
      const notice = "\n\nBridgit stopped after the bounded Tool-call limit was reached.";
      visible += notice;
      await checkpoint(visible);
      return visible;
    }
  }

  const notice = "\n\nBridgit stopped after the bounded Tool-call round limit was reached.";
  visible += notice;
  await checkpoint(visible);
  return visible;
}

interface ChatContextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

function buildChatContext(store: WorkspaceStore, chatId: string): readonly ChatContextMessage[] {
  const summary = store.getActiveSummary(chatId);
  const ledger = store.listLedger(chatId).filter((entry) => entry.status === "active");
  const prefix: ChatContextMessage[] = [];
  if (summary) prefix.push({ role: "user", content: `Active Conversation Summary (${summary.provenance}):\n${summary.content}` });
  if (ledger.length) prefix.push({
    role: "user",
    content: `Active Session Ledger:\n${ledger.map((entry) => `- [${entry.kind}] ${entry.content} (provenance: ${entry.provenance})`).join("\n")}`,
  });
  const history = [
    ...store.listTurns(chatId).map((turn) => ({ role: "user" as const, content: turn.content, createdAt: turn.submittedAt })),
    ...store.listFinalOutputs(chatId).map((output) => ({ role: "assistant" as const, content: output.content, createdAt: output.createdAt })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(({ role, content }) => ({ role, content }));
  return [...prefix, ...history];
}

function approvalFromChoice(choice: string | undefined): ChatToolApproval {
  if (choice === "Allow once") return "once";
  if (choice === "Allow for this Chat") return "session";
  return "deny";
}

function operationCount(count: number): string {
  return `${count} interrupted Tool operation${count === 1 ? "" : "s"}`;
}

function modelSnapshot(model: vscode.LanguageModelChat, selectionSource: EffectiveModelSnapshot["selectionSource"]): EffectiveModelSnapshot {
  return {
    id: model.id,
    name: model.name,
    vendor: model.vendor,
    family: model.family,
    version: model.version,
    maxInputTokens: model.maxInputTokens,
    selectionSource,
  };
}
async function generateChatTitle(model: vscode.LanguageModelChat, firstMessage: string, token: vscode.CancellationToken): Promise<string> {
  try {
    const prompt = `Write a short, descriptive conversation title based on the first user message below. Aim for 5 to 7 words; never use more than 7. Return only the title, with no labels, quotes, or explanation.\n\n${firstMessage}`;
    const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
    let title = "";
    for await (const fragment of response.text) title += fragment;
    const words = title.replace(/["'`*_#.:!?]/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 7);
    if (words.length) return words.join(" ");
  } catch { /* Keep a useful local fallback if the snapshotted model cannot title this Chat. */ }
  return fallbackChatTitle(firstMessage);
}
async function generateConversationSummary(model: vscode.LanguageModelChat, context: readonly ChatContextMessage[], token: vscode.CancellationToken): Promise<string> {
  const transcript = context.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
  const prompt = `Create a concise factual Conversation Summary for the transcript below. Preserve decisions, constraints, unresolved questions, and important repository observations. Do not invent facts. Return only the summary.\n\n${transcript}`;
  const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
  let summary = "";
  for await (const fragment of response.text) summary += fragment;
  if (!summary.trim()) throw new Error("summary-model-returned-empty-output");
  return summary.trim();
}
function fallbackChatTitle(firstMessage: string): string { const words = firstMessage.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 7); return words.length ? words.join(" ") : "New chat"; }
function escapeHtml(value: string): string { return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character); }
function isSendMessage(value: unknown): value is { type: "chat-send"; content: string } { return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "chat-send" && typeof (value as { content?: unknown }).content === "string"; }
function isResourceRefresh(value: unknown): value is { type: "resource-refresh" } { return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "resource-refresh"; }
function isAgentSelect(value: unknown): value is { type: "chat-agent-select"; agentIdentity: string } { return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "chat-agent-select" && typeof (value as { agentIdentity?: unknown }).agentIdentity === "string"; }
function isChatAction(value: unknown): value is {
  type: "chat-action";
  action: "new" | "toggle-trash" | "select" | "rename" | "fork" | "trash" | "restore" | "delete" | "cancel-attempt" | "retry-attempt" | "generate-summary" | "add-ledger" | "correct-ledger";
  chatId?: string;
  title?: string;
  attemptId?: string;
  entryId?: string;
  kind?: string;
  content?: string;
  rationale?: string;
} { return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "chat-action" && ["new", "toggle-trash", "select", "rename", "fork", "trash", "restore", "delete", "cancel-attempt", "retry-attempt", "generate-summary", "add-ledger", "correct-ledger"].includes(String((value as { action?: unknown }).action)); }

function navigationButton(id: string, icon: string, label: string, active = false): string {
  return `<button class="nav-button" role="tab" aria-selected="${active}" data-target="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${label}</span></button>`;
}

function tasksView(): string {
  return `<section id="tasks" class="view" data-active="true">
    <p class="eyebrow">Workbench</p>
    <h1>Tasks</h1>
    <p class="lede">A calm command center for durable autonomous work. The Runtime will keep execution, recovery, and repository authority here—while Chat stays available alongside it.</p>
    <div class="board">
      <article class="card card--wide"><div class="card-heading"><span>Active Task</span><span class="status status--quiet">No active task</span></div><p>Start a Task to establish its contract, route subtasks, and observe its durable execution here.</p></article>
      <article class="card"><div class="card-heading"><span>Repository</span><span class="status status--quiet">Ready</span></div><p>This Workbench is scoped to the open repository and its approved linked roots.</p></article>
      <article class="card card--wide"><div class="card-heading"><span>Subtasks</span><span class="status status--quiet">Awaiting task</span></div><div class="subtasks"><div class="subtask"><span>Confirm a Task contract</span><small>Next</small></div><div class="subtask"><span>Route eligible Agents</span><small>Then</small></div><div class="subtask"><span>Observe durable completion</span><small>After</small></div></div></article>
      <article class="card"><div class="card-heading"><span>Queue</span><span class="status status--quiet">0</span></div><p>Queued work will retain its dependency order and recovery state.</p></article>
    </div>
  </section>`;
}

function emptyView(id: string, heading: string, eyebrow: string, description: string): string {
  return `<section id="${id}" class="view" data-active="false"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><div class="empty-state"><h2>${heading} is ready for its Runtime connection.</h2><p>${description}</p></div></section>`;
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
