import type { Disposable, Uri } from "vscode";

import type { AgentService } from "../features/agents";
import type { AttentionService } from "../features/attention";
import type { ChatService } from "../features/chats";
import type { ExecutionAuthorityService } from "../features/execution-authority";
import type { MemoryService } from "../features/memory";
import type { ResourceService } from "../features/resources";
import type { TaskService } from "../features/tasks";

export interface Runtime extends Disposable {
  readonly agents: AgentService;
  readonly attention: AttentionService;
  readonly chats: ChatService;
  readonly executionAuthority: ExecutionAuthorityService;
  readonly memory: MemoryService;
  readonly resources: ResourceService;
  readonly tasks: TaskService;
}

export interface CreateRuntimeOptions {
  readonly workspaceStorageUri: Uri | undefined;
}

/**
 * Composition root for extension-host domain services. Feature implementations
 * are intentionally introduced behind these interfaces as M1 grows.
 */
export function createRuntime(_options: CreateRuntimeOptions): Runtime {
  return {
    agents: unavailableService("agents"),
    attention: unavailableService("attention"),
    chats: unavailableService("chats"),
    executionAuthority: unavailableService("execution authority"),
    memory: unavailableService("memory"),
    resources: unavailableService("resources"),
    tasks: unavailableService("tasks"),
    dispose(): void {
      // Future adapters own cleanup through this root.
    },
  };
}

function unavailableService<T extends object>(feature: string): T {
  return new Proxy({} as T, {
    get(): never {
      throw new Error(`Bridgit ${feature} is not available yet.`);
    },
  });
}
