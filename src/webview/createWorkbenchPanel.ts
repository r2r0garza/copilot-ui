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

  panel.webview.html = renderPlaceholder();
  context.subscriptions.push(panel);
  return panel;
}

function renderPlaceholder(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Bridgit Workbench</title></head>
  <body>
    <main>
      <h1>Bridgit Workbench</h1>
      <p>The durable Chat walking skeleton is being assembled.</p>
    </main>
  </body>
</html>`;
}
