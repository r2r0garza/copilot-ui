import * as vscode from "vscode";

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

  panel.webview.html = renderWorkbench(panel.webview);
  context.subscriptions.push(panel);
  return panel;
}

function renderWorkbench(webview: vscode.Webview): string {
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
      body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-weight) var(--vscode-font-size) var(--vscode-font-family); }
      button { color: inherit; font: inherit; }
      .workbench { min-height: 100vh; display: grid; grid-template-columns: 188px minmax(0, 1fr); }
      .rail { padding: 18px 10px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
      .brand { display: flex; gap: 9px; align-items: center; margin: 3px 10px 26px; font-weight: 700; letter-spacing: .02em; }
      .brand-mark { width: 20px; height: 20px; display: grid; place-items: center; border: 1px solid var(--vscode-focusBorder); color: var(--vscode-focusBorder); font-size: 12px; }
      .navigation { display: grid; gap: 3px; }
      .nav-button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; background: transparent; border: 0; border-radius: 3px; cursor: pointer; text-align: left; color: var(--vscode-sideBar-foreground); }
      .nav-button:hover { background: var(--vscode-list-hoverBackground); }
      .nav-button[aria-selected="true"] { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
      .nav-icon { width: 16px; color: var(--vscode-descriptionForeground); text-align: center; }
      .nav-button[aria-selected="true"] .nav-icon { color: inherit; }
      .rail-footer { margin: 28px 10px 0; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.5; }
      .content { min-width: 0; padding: clamp(22px, 4vw, 54px); }
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
        ${emptyView("chats", "Chats", "Session-first conversations", "Create a session to begin a durable, model-backed conversation. Sessions, turns, and response attempts will appear here.")}
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
    </script>
  </body>
</html>`;
}

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
