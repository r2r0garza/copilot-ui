import { createHash } from "node:crypto";
import * as vscode from "vscode";

import {
  ResourceCatalogController,
  type AgentResource,
  type EffectiveModelSnapshot,
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
    this.controller = new ResourceCatalogController(
      workspace?.uri.fsPath ?? null,
      workspace?.name,
      undefined,
      registeredExtensionTools,
    );
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

  public createSnapshot(attemptId: string, agent: AgentResource, effectiveModel: EffectiveModelSnapshot, now?: string): ResourceSnapshot {
    return this.controller.createSnapshot(attemptId, agent, effectiveModel, now);
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

function registeredExtensionTools(): readonly ToolResource[] {
  return vscode.lm.tools.map((tool) => {
    const inputSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
    return {
      identity: tool.name,
      description: tool.description,
      origin: "extension",
      effectClass: "ambient",
      status: "available",
      inputSchema,
      inputSchemaFingerprint: createHash("sha256").update(JSON.stringify(inputSchema)).digest("hex"),
      resultSchema: {},
    };
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
