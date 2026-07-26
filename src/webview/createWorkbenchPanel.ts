import * as vscode from "vscode";

import { WorkspaceStore } from "../adapters/sqlite/workspaceStore";
import type { Runtime } from "../runtime/createRuntime";

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
  const getStore = (): WorkspaceStore => store ??= new WorkspaceStore((context.storageUri ?? context.globalStorageUri).fsPath);
  const sendState = (): Thenable<boolean> => panel.webview.postMessage({ type: "chat-state", state: chatState(getStore()) });
  let initialState: ChatState = { messages: [] };
  try { initialState = chatState(getStore()); } catch { /* The panel remains usable and surfaces storage errors on Send. */ }
  panel.webview.html = renderWorkbench(panel.webview, initialState);
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!isSendMessage(message)) return;
    const content = message.content.trim();
    if (!content) return;
    try {
      const authority = getStore();
      const chat = authority.listChats()[0] ?? authority.createChat("bundled:orchestrator", null);
      const turn = authority.submitTurn(chat.chatId, content);
      const [model] = await vscode.lm.selectChatModels();
      if (!model) throw new Error("No chat model is available. Sign in to GitHub Copilot and try again.");
      authority.createResponseAttempt(turn.turnId, model.id);
      const cancellation = new vscode.CancellationTokenSource();
      const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(content)], {}, cancellation.token);
      let output = "";
      for await (const fragment of response.text) { output += fragment; await panel.webview.postMessage({ type: "chat-stream", content: output }); }
      authority.appendOutput(turn.turnId, output || "The model returned no visible text.");
      await sendState();
    } catch (error) {
      await panel.webview.postMessage({ type: "chat-error", message: error instanceof Error ? error.message : "Unable to send this Chat message." });
    }
  });
  context.subscriptions.push(panel, { dispose: () => store?.close() });
  return panel;
}

function renderWorkbench(webview: vscode.Webview, state: ChatState): string {
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
      .chat-layout { display: flex; flex-direction: column; gap: 16px; max-width: 800px; }
      .transcript { min-height: 0; display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: 12px; padding: 18px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
      .message { width: fit-content; max-width: min(78%, 620px); padding: 10px 13px; border-radius: 5px; border-left: 2px solid var(--vscode-testing-iconPassed); background: var(--vscode-textBlockQuote-background); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
      .message.user { align-self: flex-end; border-left: 0; border-right: 2px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
      .message.assistant { align-self: flex-start; }
      .composer { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
      .chat-error { min-height: 18px; margin: 0; color: var(--vscode-errorForeground); font-size: 12px; }
      textarea { min-height: 42px; max-height: 322px; resize: none; overflow-y: hidden; padding: 10px; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); font: inherit; line-height: 21px; }
      textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
      .send { align-self: end; padding: 9px 14px; color: var(--vscode-button-foreground); border: 0; border-radius: 2px; background: var(--vscode-button-background); cursor: pointer; font-weight: 600; }
      .view#chats { max-width: none; height: calc(100vh - 108px); min-height: 0; }
      .chat-layout { width: min(100%, 1280px); max-width: none; height: calc(100vh - 240px); min-height: 0; }
      .composer { position: sticky; bottom: 0; padding-top: 10px; background: var(--vscode-editor-background); }
      @media (max-width: 700px) { .workbench { grid-template-columns: 58px minmax(0, 1fr); } .brand span, .nav-label, .rail-footer { display: none; } .brand { justify-content: center; margin-inline: 0; } .nav-button { justify-content: center; padding-inline: 4px; } .board { grid-template-columns: 1fr; } .card--wide { grid-column: auto; } .content { padding: 24px 18px; } }
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
          ${navigationButton("agents", "◇", "Agents")}
          ${navigationButton("memory", "◫", "Memory")}
          ${navigationButton("settings", "⚙", "Settings")}
        </nav>
        <p class="rail-footer">Local-first<br>Repository workbench</p>
      </aside>
      <section class="content">
        ${tasksView()}
        ${chatsView(state)}
        ${emptyView("activity", "Activity", "Meaningful outcomes", "Recovery notices, approvals, and execution outcomes will form a concise chronological record here.")}
        ${emptyView("agents", "Agents", "Repository and bundled agents", "Discovered agents, eligibility, model preferences, and their available resources will appear here.")}
        ${emptyView("memory", "Memory", "Explicit, inspectable memory", "Project and Personal Memory stay separate from session-local ledgers and require explicit confirmation.")}
        ${emptyView("settings", "Settings", "Repository-scoped Workbench settings", "Model selection, tools, authority, storage, and native resource locations will be configured here.")}
      </section>
    </main>
    <script nonce="${nonce}">
      const buttons = [...document.querySelectorAll('.nav-button')];
      const views = [...document.querySelectorAll('.view')];
      for (const button of buttons) button.addEventListener('click', () => {
        const target = button.dataset.target;
        for (const candidate of buttons) candidate.setAttribute('aria-selected', String(candidate === button));
        for (const view of views) view.dataset.active = String(view.id === target);
      });
      const vscode = acquireVsCodeApi(); const form = document.querySelector('#chat-form'); const input = document.querySelector('#chat-input'); const transcript = document.querySelector('#transcript'); const error = document.querySelector('#chat-error'); const scrollToLatest = () => { transcript.scrollTop = transcript.scrollHeight; };
      const resizeComposer = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 322) + 'px'; input.style.overflowY = input.scrollHeight > 322 ? 'auto' : 'hidden'; };
      input?.addEventListener('input', resizeComposer);
      input?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form?.requestSubmit(); } });
      form?.addEventListener('submit', (event) => { event.preventDefault(); const content = input.value; if (content.trim()) { transcript.innerHTML += '<div class="message user"><strong>you</strong><br>' + content.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</div><div id="streaming-response" class="message assistant"><strong>Bridgit</strong><br><span></span></div>'; scrollToLatest(); error.textContent = 'Sending…'; vscode.postMessage({ type: 'chat-send', content }); input.value = ''; resizeComposer(); } });
      window.addEventListener('message', (event) => { const message = event.data; if (message.type === 'chat-state') { transcript.innerHTML = message.state.messages.map((item) => '<div class="message ' + item.role + '"><strong>' + (item.role === 'user' ? 'you' : 'Bridgit') + '</strong><br>' + item.content + '</div>').join('') || '<p class="muted">Start a durable Chat session below.</p>'; scrollToLatest(); error.textContent = ''; } if (message.type === 'chat-stream') { const stream = document.querySelector('#streaming-response span'); if (stream) { stream.textContent = message.content; scrollToLatest(); } } if (message.type === 'chat-error') error.textContent = message.message; }); requestAnimationFrame(scrollToLatest);
    </script>
  </body>
</html>`;
}

interface ChatState { readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[]; }
function chatState(store: WorkspaceStore): ChatState { const chat = store.listChats()[0]; if (!chat) return { messages: [] }; const messages = [...store.listTurns(chat.chatId).map((turn) => ({ role: "user" as const, content: turn.content, createdAt: turn.submittedAt })), ...store.listOutputs(chat.chatId).map((output) => ({ role: "assistant" as const, content: output.content, createdAt: output.createdAt }))].sort((left, right) => left.createdAt.localeCompare(right.createdAt)); return { messages: messages.map(({ role, content }) => ({ role, content })) }; }
function chatsView(state: ChatState): string { return `<section id="chats" class="view" data-active="false"><p class="eyebrow">Session-first conversations</p><h1>Chats</h1><p class="lede">Your messages and model responses are stored locally and rebuild after reload.</p><div class="chat-layout"><div id="transcript" class="transcript">${state.messages.map((item) => `<div class="message ${item.role}"><strong>${item.role === "user" ? "you" : "Bridgit"}</strong><br>${escapeHtml(item.content)}</div>`).join("") || "<p>Start a durable Chat session below.</p>"}</div><p id="chat-error" class="chat-error" role="status"></p><form id="chat-form" class="composer"><textarea id="chat-input" aria-label="Chat message" aria-multiline="true" rows="1" placeholder="Message Bridgit…"></textarea><button class="send" type="submit">Send</button></form></div></section>`; }
function escapeHtml(value: string): string { return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character); }
function isSendMessage(value: unknown): value is { type: "chat-send"; content: string } { return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "chat-send" && typeof (value as { content?: unknown }).content === "string"; }

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
