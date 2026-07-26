import * as vscode from "vscode";

import {
  ResourceCatalogController,
  type AgentResource,
  type ResourceCatalogState,
  type ResourceService,
  type ResourceSubscription,
  type ResourceSnapshot,
  type ToolResource,
} from "../../features/resources";

const RESOURCE_PATTERNS = [
  ".github/agents/*.agent.md",
  ".github/skills/*/SKILL.md",
  ".vscode/mcp.json",
] as const;

/** VS Code adapter for the single active repository workspace. */
export class VsCodeWorkspaceResourceService implements ResourceService {
  private readonly controller: ResourceCatalogController;
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];

  public constructor() {
    const workspace = activeWorkspace();
    this.controller = new ResourceCatalogController(workspace?.uri.fsPath ?? null, workspace?.name);
    this.rebuildWatchers(workspace);
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const next = activeWorkspace();
      this.controller.setWorkspace(next?.uri.fsPath ?? null, next?.name);
      this.rebuildWatchers(next);
    }));
  }

  public getState(): ResourceCatalogState {
    return this.controller.getState();
  }

  public refresh(): ResourceCatalogState {
    return this.controller.refresh();
  }

  public setWorkspace(workspaceRoot: string | null, workspaceName?: string): ResourceCatalogState {
    return this.controller.setWorkspace(workspaceRoot, workspaceName);
  }

  public onDidChange(listener: (state: ResourceCatalogState) => void): ResourceSubscription {
    return this.controller.onDidChange(listener);
  }

  public createSnapshot(agent: AgentResource, effectiveModelId: string, tools: readonly ToolResource[], now?: string): ResourceSnapshot {
    return this.controller.createSnapshot(agent, effectiveModelId, tools, now);
  }

  public dispose(): void {
    this.disposeWatchers();
    for (const disposable of this.disposables) disposable.dispose();
    this.controller.dispose();
  }

  private rebuildWatchers(workspace: vscode.WorkspaceFolder | undefined): void {
    this.disposeWatchers();
    if (!workspace) return;
    this.watchers = RESOURCE_PATTERNS.map((pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, pattern));
      watcher.onDidCreate(() => this.controller.refresh());
      watcher.onDidChange(() => this.controller.refresh());
      watcher.onDidDelete(() => this.controller.refresh());
      return watcher;
    });
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
  }
}

function activeWorkspace(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}
