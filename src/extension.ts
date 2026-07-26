import * as vscode from "vscode";

import { createRuntime } from "./runtime/createRuntime";
import { createWorkbenchPanel } from "./webview/createWorkbenchPanel";
import { LauncherViewProvider } from "./webview/launcherView";

export function activate(context: vscode.ExtensionContext): void {
  const runtime = createRuntime({
    workspaceStorageUri: context.storageUri,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LauncherViewProvider.viewType, new LauncherViewProvider()),
    vscode.commands.registerCommand("bridgit.openWorkbench", () => {
      createWorkbenchPanel(context, runtime);
    }),
    runtime,
  );
}

export function deactivate(): void {
  // Runtime resources are disposed through ExtensionContext subscriptions.
}
