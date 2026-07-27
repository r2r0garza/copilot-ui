import { createHash } from "node:crypto";

import {
  discoverResources,
  pinSnapshot,
  type AgentResource,
  type ResourceCatalog,
  type ResourceSnapshot,
  type ToolResource,
} from "./catalog";

export interface ResourceCatalogState {
  readonly workspaceRoot: string | null;
  readonly workspaceName: string;
  readonly revision: number;
  readonly refreshedAt: string;
  readonly fingerprint: string;
  readonly catalog: ResourceCatalog;
}

export interface ResourceSubscription {
  dispose(): void;
}

/** Public application boundary for active-workspace resource discovery. */
export interface ResourceService {
  getState(): ResourceCatalogState;
  refresh(): ResourceCatalogState;
  setWorkspace(workspaceRoot: string | null, workspaceName?: string): ResourceCatalogState;
  onDidChange(listener: (state: ResourceCatalogState) => void): ResourceSubscription;
  createSnapshot(agent: AgentResource, effectiveModelId: string, tools: readonly ToolResource[], now?: string): ResourceSnapshot;
  dispose(): void;
}

/**
 * Host-neutral catalog lifecycle. VS Code owns file watching; this controller
 * owns revisioning, subscriptions, and immutable snapshot selection.
 */
export class ResourceCatalogController implements ResourceService {
  private readonly listeners = new Set<(state: ResourceCatalogState) => void>();
  private state: ResourceCatalogState;
  private disposed = false;

  public constructor(
    workspaceRoot: string | null,
    workspaceName = workspaceRoot ? workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace" : "No workspace",
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly additionalTools: () => readonly ToolResource[] = () => [],
  ) {
    this.state = this.discover(workspaceRoot, workspaceName, workspaceRoot === null ? 0 : 1);
  }

  public getState(): ResourceCatalogState {
    return this.state;
  }

  public refresh(): ResourceCatalogState {
    this.assertActive();
    const next = this.discover(this.state.workspaceRoot, this.state.workspaceName, this.state.revision);
    if (next.fingerprint === this.state.fingerprint) return this.state;
    this.state = { ...next, revision: this.state.revision + 1 };
    this.emit();
    return this.state;
  }

  public setWorkspace(workspaceRoot: string | null, workspaceName?: string): ResourceCatalogState {
    this.assertActive();
    const name = workspaceName ?? (workspaceRoot ? workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace" : "No workspace");
    const next = this.discover(workspaceRoot, name, this.state.revision);
    if (next.workspaceRoot === this.state.workspaceRoot && next.workspaceName === this.state.workspaceName && next.fingerprint === this.state.fingerprint) return this.state;
    this.state = { ...next, revision: this.state.revision + 1 };
    this.emit();
    return this.state;
  }

  public onDidChange(listener: (state: ResourceCatalogState) => void): ResourceSubscription {
    this.assertActive();
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public createSnapshot(agent: AgentResource, effectiveModelId: string, tools: readonly ToolResource[], now = this.now()): ResourceSnapshot {
    this.assertActive();
    return pinSnapshot(this.state.catalog, agent, effectiveModelId, tools, now, this.state.revision);
  }

  public dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private discover(workspaceRoot: string | null, workspaceName: string, revision: number): ResourceCatalogState {
    const catalog = workspaceRoot === null
      ? { agents: [], skills: [], mcpServers: [], tools: [], diagnostics: [] }
      : discoverResources(workspaceRoot, this.additionalTools());
    const fingerprint = createHash("sha256").update(JSON.stringify({ workspaceRoot, catalog })).digest("hex");
    return { workspaceRoot, workspaceName, revision, refreshedAt: this.now(), fingerprint, catalog };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("resource-service-disposed");
  }
}
