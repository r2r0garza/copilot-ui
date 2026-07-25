import type {
  ApplicationCommandHandler,
  ApplicationRequest,
  ApplicationResult,
  RuntimePorts,
} from "./application";

export interface HeadlessRuntimeHarness {
  execute(request: ApplicationRequest): Promise<ApplicationResult>;
  readonly ports: RuntimePorts;
}

export interface CreateHeadlessRuntimeHarnessOptions {
  readonly commandHandler: ApplicationCommandHandler;
  readonly ports?: Partial<RuntimePorts>;
}

/**
 * Test profile of the Runtime. It invokes the production application command
 * handler while allowing every environmental dependency to be substituted.
 */
export function createHeadlessRuntimeHarness(
  options: CreateHeadlessRuntimeHarnessOptions,
): HeadlessRuntimeHarness {
  const ports = createRuntimePorts(options.ports);

  return {
    ports,
    execute(request): Promise<ApplicationResult> {
      return options.commandHandler.execute(request, ports);
    },
  };
}

export function createRuntimePorts(overrides: Partial<RuntimePorts> = {}): RuntimePorts {
  return {
    clock: overrides.clock ?? { now: () => new Date(0) },
    identity: overrides.identity ?? { next: () => "headless-identity" },
    models: overrides.models ?? {},
    tools: overrides.tools ?? {},
    fileSystem: overrides.fileSystem ?? {},
    git: overrides.git ?? {},
    mcp: overrides.mcp ?? {},
    secrets: overrides.secrets ?? {},
    notifications: overrides.notifications ?? {},
    authority: overrides.authority ?? {},
    userResponses: overrides.userResponses ?? {},
    crashPoints: overrides.crashPoints ?? {},
  };
}
