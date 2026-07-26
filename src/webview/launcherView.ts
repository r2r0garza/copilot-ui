import * as vscode from "vscode";

export class LauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "bridgit.launcher";

  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!doctype html><html lang="en"><body><button id="open">Open Workbench in Editor</button><script>const vscode = acquireVsCodeApi(); document.getElementById('open').addEventListener('click', () => vscode.postMessage({ command: 'open' }));</script></body></html>`;
    view.webview.onDidReceiveMessage((message: unknown) => { if (typeof message === "object" && message !== null && (message as { command?: unknown }).command === "open") void vscode.commands.executeCommand("bridgit.openWorkbench"); });
  }
}
