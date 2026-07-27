import type { Disposable, Uri } from "vscode";

import type { AgentService } from "../features/agents";
import type { AttentionService } from "../features/attention";
import type { ChatService } from "../features/chats";
import type { ExecutionAuthorityService } from "../features/execution-authority";
import type { MemoryService } from "../features/memory";
import type { ResourceService } from "../features/resources";
import type { TaskService } from "../features/tasks";
import type { ApplicationCommandHandler, ApplicationRequest, ApplicationResult, RuntimePorts } from "./application";

export interface Runtime extends Disposable {
  readonly agents: AgentService;
  readonly attention: AttentionService;
  readonly chats: ChatService;
  readonly executionAuthority: ExecutionAuthorityService;
  readonly memory: MemoryService;
  readonly resources: ResourceService;
  readonly tasks: TaskService;
  execute(request: ApplicationRequest): Promise<ApplicationResult>;
}

export interface CreateRuntimeOptions {
  readonly workspaceStorageUri: Uri | undefined;
  readonly resources?: ResourceService;
  readonly commandHandler?: ApplicationCommandHandler;
  readonly ports?: RuntimePorts;
}

/**
 * Composition root for extension-host domain services. Feature implementations
 * are intentionally introduced behind these interfaces as M1 grows.
 */
export function createRuntime(_options: CreateRuntimeOptions): Runtime {
  const commandHandler = _options.commandHandler ?? unsupportedCommandHandler;
  const ports = _options.ports ?? createUnavailablePorts();

  return {
    agents: unavailableService("agents"),
    attention: unavailableService("attention"),
    chats: unavailableService("chats"),
    executionAuthority: unavailableService("execution authority"),
    memory: unavailableService("memory"),
    resources: _options.resources ?? unavailableService("resources"),
    tasks: unavailableService("tasks"),
    execute(request): Promise<ApplicationResult> {
      return commandHandler.execute(request, ports);
    },
    dispose(): void {
      _options.resources?.dispose();
    },
  };
}

const unsupportedCommandHandler: ApplicationCommandHandler = {
  async execute(): Promise<ApplicationResult> {
    return { status: "rejected", reasonCode: "command-not-implemented" };
  },
};

function createUnavailablePorts(): RuntimePorts {
  const unavailable = unavailableService<object>("runtime port");
  return {
    clock: unavailableService("clock"),
    identity: unavailableService("identity"),
    models: unavailable,
    tools: unavailable,
    fileSystem: unavailable,
    git: unavailable,
    mcp: unavailable,
    secrets: unavailable,
    notifications: unavailable,
    authority: unavailable,
    userResponses: unavailable,
    crashPoints: unavailable,
  };
}

function unavailableService<T extends object>(feature: string): T {
  return new Proxy({} as T, {
    get(): never {
      throw new Error(`Bridgit ${feature} is not available yet.`);
    },
  });
}
