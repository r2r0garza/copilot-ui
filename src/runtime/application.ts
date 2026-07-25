/** A host-owned application request, shared by the Webview gateway and tests. */
export interface ApplicationRequest {
  readonly name: string;
  readonly payload: unknown;
}

/** The application layer returns data only after Runtime policy accepts a request. */
export interface ApplicationResult {
  readonly status: "accepted" | "rejected";
  readonly payload?: unknown;
  readonly reasonCode?: string;
}

export interface ApplicationCommandHandler {
  execute(request: ApplicationRequest, ports: RuntimePorts): Promise<ApplicationResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface IdentityPort {
  next(): string;
}

/**
 * Replaceable environmental dependencies for the headless Runtime profile.
 * Each concrete adapter will be specified by its feature as it is introduced.
 */
export interface RuntimePorts {
  readonly clock: ClockPort;
  readonly identity: IdentityPort;
  readonly models: object;
  readonly tools: object;
  readonly fileSystem: object;
  readonly git: object;
  readonly mcp: object;
  readonly secrets: object;
  readonly notifications: object;
  readonly authority: object;
  readonly userResponses: object;
  readonly crashPoints: object;
}
