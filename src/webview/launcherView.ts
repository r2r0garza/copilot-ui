import * as vscode from "vscode";

export class LauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "bridgit.launcher";

  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px 12px; color: var(--vscode-sideBar-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-weight) var(--vscode-font-size) var(--vscode-font-family); }
  .eyebrow { margin: 0 0 7px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 7px 0 18px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
  button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 11px; border: 1px solid var(--vscode-button-background); border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; font-weight: 600; cursor: pointer; text-align: left; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .arrow { font-size: 16px; font-weight: 400; line-height: 1; }
  .note { display: flex; gap: 7px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
  .mark { color: var(--vscode-testing-iconPassed); }
</style></head><body><p class="eyebrow">Bridgit</p><h1>Agent Workbench</h1><p>Open the full editor to work with durable repository agents.</p><button id="open"><span>Open Workbench</span><span class="arrow" aria-hidden="true">→</span></button><div class="note"><span class="mark" aria-hidden="true">●</span><span>Local-first · repository scoped</span></div><script>const vscode = acquireVsCodeApi(); document.getElementById('open').addEventListener('click', () => vscode.postMessage({ command: 'open' }));</script></body></html>`;
    view.webview.onDidReceiveMessage((message: unknown) => { if (typeof message === "object" && message !== null && (message as { command?: unknown }).command === "open") void vscode.commands.executeCommand("bridgit.openWorkbench"); });
  }
}
