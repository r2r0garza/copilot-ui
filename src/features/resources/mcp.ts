import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { secretMinimizedEnvironment } from "../execution-authority";
import type { Diagnostic, McpServer, ResourceStatus } from "./catalog";

export type McpTransport = "stdio" | "http" | "sse";
export type McpInputType = "promptString" | "pickString" | "command";
export type McpTrustDecision = "trusted" | "denied";

export interface McpInputDefinition {
  readonly id: string;
  readonly type: McpInputType;
  readonly description: string;
  readonly password: boolean;
  readonly defaultValue?: string;
  readonly options?: readonly string[];
  readonly command?: string;
  readonly args?: unknown;
}

export interface McpServerDefinition {
  readonly identity: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly url?: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly inputIds: readonly string[];
  readonly requiresOAuth: boolean;
  readonly fingerprint: string;
}

export interface McpConfiguration {
  readonly servers: readonly McpServer[];
  readonly definitions: ReadonlyMap<string, McpServerDefinition>;
  readonly inputs: ReadonlyMap<string, McpInputDefinition>;
  readonly diagnostics: readonly Diagnostic[];
  readonly topLevelValid: boolean;
}

export interface McpInputPort {
  prompt(input: McpInputDefinition): Promise<string | undefined>;
  pick(input: McpInputDefinition): Promise<string | undefined>;
  executeCommand(input: McpInputDefinition): Promise<unknown>;
}

export interface McpTrustBinding {
  readonly fingerprint: string;
  readonly decision: McpTrustDecision;
}

export interface McpOAuthPort {
  authorize(server: McpServerDefinition): Promise<{ readonly credentialHandle: string } | undefined>;
}

export interface McpVariableValues {
  readonly workspaceFolder: string;
  readonly workspaceFolderBasename: string;
  readonly userHome: string;
  readonly pathSeparator: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly inputs: Readonly<Record<string, string>>;
}

export interface McpConnectionPlan {
  readonly serverIdentity: string;
  readonly fingerprint: string;
  readonly isolationKey: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly url?: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly inheritProcessEnvironment: false;
  readonly requiresOAuth: boolean;
}

export type McpConnectionPreparation =
  | { readonly status: "ready"; readonly plan: McpConnectionPlan }
  | { readonly status: "blocked"; readonly reasonCode: "server-not-trusted" | "server-trust-denied" | "input-required" | "variable-unresolved"; readonly detail: string };

const SERVER_IDENTITY = /^[A-Za-z0-9._-]+$/;
const VARIABLE_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Reads the canonical repository MCP file without starting servers, prompting
 * for input, executing commands, or beginning OAuth.
 */
export function readMcpConfiguration(file: string): McpConfiguration {
  const diagnostics: Diagnostic[] = [];
  if (!existsSync(file)) return { servers: [], definitions: new Map(), inputs: new Map(), diagnostics, topLevelValid: true };
  let bytes: Buffer;
  try { bytes = readFileSync(file); }
  catch { return invalidTopLevel("MCP configuration could not be read during refresh.", diagnostics); }
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return invalidTopLevel(decoded.reason, diagnostics);

  let source: unknown;
  try {
    source = JSON.parse(decoded.value);
  } catch {
    return invalidTopLevel("Malformed top-level MCP JSON.", diagnostics);
  }
  if (!isRecord(source) || !isRecord(source.servers)) return invalidTopLevel("MCP configuration has no servers mapping.", diagnostics);

  const inputs = parseInputs(source.inputs, diagnostics);
  if (!inputs.ok) return { servers: [], definitions: new Map(), inputs: inputs.values, diagnostics, topLevelValid: false };

  if (source.sandbox !== undefined) {
    addDiagnostic(diagnostics, "mcp", "mcp.sandbox-ignored", "warning", "Top-level sandbox settings are ignored because sandboxed servers are unavailable.");
  }

  const servers: McpServer[] = [];
  const definitions = new Map<string, McpServerDefinition>();
  for (const [identity, value] of Object.entries(source.servers).sort(([left], [right]) => left.localeCompare(right))) {
    const parsed = parseServer(identity, value, inputs.values, diagnostics);
    servers.push(parsed.resource);
    if (parsed.definition && parsed.resource.status === "available") definitions.set(identity, parsed.definition);
  }
  return { servers, definitions, inputs: inputs.values, diagnostics, topLevelValid: true };
}

/** Resolves exactly one native input, and only from an explicit user action. */
export async function resolveMcpInput(input: McpInputDefinition, port: McpInputPort, userInitiated: boolean): Promise<string | undefined> {
  if (!userInitiated) throw new Error("mcp-input-requires-user-action");
  if (input.type === "promptString") return port.prompt(input);
  if (input.type === "pickString") return port.pick(input);
  const result = await port.executeCommand(input);
  if (result === undefined || result === null) return undefined;
  if (typeof result !== "string") throw new Error("mcp-command-input-must-return-string");
  return result;
}

/**
 * Produces an isolated connection plan. The caller still owns the actual
 * process/network handoff and OAuth flow.
 */
export function prepareMcpConnection(
  server: McpServerDefinition,
  trust: McpTrustBinding | undefined,
  values: McpVariableValues,
): McpConnectionPreparation {
  if (trust?.fingerprint !== server.fingerprint) return { status: "blocked", reasonCode: "server-not-trusted", detail: "The exact MCP Server configuration is not trusted." };
  if (trust.decision === "denied") return { status: "blocked", reasonCode: "server-trust-denied", detail: "The exact MCP Server configuration was denied." };
  const missingInput = server.inputIds.find((id) => values.inputs[id] === undefined);
  if (missingInput) return { status: "blocked", reasonCode: "input-required", detail: `Input '${missingInput}' requires a user action.` };

  try {
    const resolve = (value: string): string => substituteVariables(value, values);
    const environment = secretMinimizedEnvironment({
      host: {},
      explicit: Object.fromEntries(Object.entries(server.environment).map(([key, value]) => [key, resolve(value)])),
    });
    const headers = Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, resolve(value)]));
    const command = server.command === undefined ? undefined : resolve(server.command);
    const url = server.url === undefined ? undefined : resolve(server.url);
    const cwd = server.cwd === undefined ? undefined : resolve(server.cwd);
    const args = server.args.map(resolve);
    return {
      status: "ready",
      plan: {
        serverIdentity: server.identity,
        fingerprint: server.fingerprint,
        isolationKey: `${server.identity}:${server.fingerprint}`,
        transport: server.transport,
        command,
        url,
        args,
        cwd,
        environment,
        headers,
        inheritProcessEnvironment: false,
        requiresOAuth: server.requiresOAuth,
      },
    };
  } catch (error) {
    return { status: "blocked", reasonCode: "variable-unresolved", detail: error instanceof Error ? error.message : "Variable resolution failed." };
  }
}

/** OAuth may begin only from an explicit user action and returns an opaque handle, never tokens. */
export async function startMcpOAuth(
  server: McpServerDefinition,
  port: McpOAuthPort,
  userInitiated: boolean,
): Promise<{ readonly credentialHandle: string } | undefined> {
  if (!userInitiated) throw new Error("mcp-oauth-requires-user-action");
  if (!server.requiresOAuth) throw new Error("mcp-server-does-not-require-oauth");
  const result = await port.authorize(server);
  if (result && !result.credentialHandle.trim()) throw new Error("mcp-oauth-handle-invalid");
  return result;
}

function parseServer(
  identity: string,
  value: unknown,
  inputs: ReadonlyMap<string, McpInputDefinition>,
  diagnostics: Diagnostic[],
): { resource: McpServer; definition?: McpServerDefinition } {
  const resourceName = `mcp:${identity}`;
  const sourceFingerprint = fingerprint(canonicalJson(value));
  const invalid = (reason: string, code = "mcp.server-invalid"): { resource: McpServer } => {
    addDiagnostic(diagnostics, resourceName, code, "error", reason);
    return { resource: mcpResource(identity, "invalid", reason, undefined, sourceFingerprint) };
  };
  if (!SERVER_IDENTITY.test(identity)) return invalid("Server identity may contain only letters, numbers, '.', '_', and '-'.");
  if (!isRecord(value)) return invalid("Server configuration must be an object.");

  const command = optionalString(value.command);
  const url = optionalString(value.url);
  const declaredType = optionalString(value.type);
  if (command.invalid || url.invalid || declaredType.invalid) return invalid("Server command, URL, and type must be strings.");
  const hasCommand = command.value !== undefined;
  const hasUrl = url.value !== undefined;
  if (hasCommand === hasUrl) return invalid("Configure exactly one command or URL.");

  let transport: McpTransport;
  if (hasCommand) {
    if (declaredType.value !== undefined && declaredType.value !== "stdio") return invalid("Command servers must use the stdio transport.");
    transport = "stdio";
  } else {
    if (declaredType.value !== "http" && declaredType.value !== "sse") return invalid("URL servers must declare type 'http' or 'sse'.");
    transport = declaredType.value;
  }

  const args = stringArray(value.args, []);
  const environment = stringRecord(value.env);
  const headers = stringRecord(value.headers);
  const cwd = optionalString(value.cwd);
  if (!args || !environment || !headers || cwd.invalid) return invalid("Arguments, cwd, environment, or headers have an invalid shape.");
  try { secretMinimizedEnvironment({ host: {}, explicit: environment }); }
  catch (error) { return invalid(error instanceof Error ? error.message : "Execution environment is invalid.", "mcp.environment-prohibited"); }
  if (value.envFile !== undefined) return invalid("Environment files are not loaded implicitly.", "mcp.env-file-prohibited");

  if (value.dev !== undefined) addDiagnostic(diagnostics, resourceName, "mcp.dev-ignored", "warning", "Native MCP dev.watch and dev.debug settings are ignored.");
  const enterpriseOAuth = isRecord(value.oauth) && (value.oauth.type === "enterprise-managed" || value.oauth.type === "enterprise-managed-oauth");
  if (value.sandboxEnabled !== undefined && typeof value.sandboxEnabled !== "boolean") return invalid("sandboxEnabled must be a boolean.");
  const unsupported = value.sandboxEnabled === true || enterpriseOAuth;
  const reason = value.sandboxEnabled === true
    ? "Sandbox-enabled servers are unavailable because the Workbench cannot reuse VS Code's sandbox."
    : enterpriseOAuth
      ? "Preview enterprise-managed OAuth is unavailable."
      : undefined;

  const referencedInputIds = collectInputIds({ command: command.value, url: url.value, args, cwd: cwd.value, environment, headers });
  const missing = referencedInputIds.find((id) => !inputs.has(id));
  if (missing) return invalid(`Server references undefined input '${missing}'.`, "mcp.input-undefined");
  const unknownVariable = collectVariables({ command: command.value, url: url.value, args, cwd: cwd.value, environment, headers })
    .find((variable) => !supportedVariable(variable));
  if (unknownVariable) return invalid(`Server references unsupported variable '\${${unknownVariable}}'.`, "mcp.variable-unsupported");

  const requiresOAuth = value.oauth !== undefined;
  if (requiresOAuth && !isRecord(value.oauth)) return invalid("OAuth configuration must be an object.");
  if (containsLiteralSecret(environment) || containsLiteralSecret(headers) || containsLiteralSecret(value.oauth)) {
    return invalid("Secret-like MCP values must use an input reference or SecretStorage handle.", "mcp.literal-secret-prohibited");
  }
  const configurationFingerprint = fingerprint(canonicalJson({
    transport,
    command: command.value,
    url: url.value,
    args,
    cwd: cwd.value,
    environment,
    headers,
    oauth: value.oauth,
  }));
  const definition: McpServerDefinition = {
    identity,
    transport,
    command: command.value,
    url: url.value,
    args,
    cwd: cwd.value,
    environment,
    headers,
    inputIds: referencedInputIds,
    requiresOAuth,
    fingerprint: configurationFingerprint,
  };
  if (reason) addDiagnostic(diagnostics, resourceName, "mcp.server-unavailable", "warning", reason);
  return {
    resource: mcpResource(identity, unsupported ? "unavailable" : "available", reason, definition),
    definition,
  };
}

function parseInputs(value: unknown, diagnostics: Diagnostic[]): { ok: boolean; values: Map<string, McpInputDefinition> } {
  const values = new Map<string, McpInputDefinition>();
  if (value === undefined) return { ok: true, values };
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "mcp", "mcp.inputs-invalid", "error", "Top-level MCP inputs must be an array.");
    return { ok: false, values };
  }
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !SERVER_IDENTITY.test(item.id) || values.has(item.id)) {
      addDiagnostic(diagnostics, "mcp", "mcp.input-invalid", "error", "Each MCP input requires a unique valid string ID.");
      continue;
    }
    const description = typeof item.description === "string" ? item.description : "";
    const password = item.password === true;
    const defaultValue = typeof item.default === "string" ? item.default : undefined;
    if (item.type === "promptString") {
      values.set(item.id, { id: item.id, type: item.type, description, password, defaultValue });
    } else if (item.type === "pickString" && Array.isArray(item.options) && item.options.length > 0 && item.options.every((option) => typeof option === "string")) {
      values.set(item.id, { id: item.id, type: item.type, description, password: false, defaultValue, options: item.options });
    } else if (item.type === "command" && typeof item.command === "string") {
      values.set(item.id, { id: item.id, type: item.type, description, password: false, command: item.command, args: item.args });
    } else {
      addDiagnostic(diagnostics, `mcp-input:${item.id}`, "mcp.input-invalid", "error", "Input type or required fields are invalid.");
    }
  }
  return { ok: true, values };
}

function mcpResource(
  name: string,
  status: ResourceStatus,
  reason?: string,
  definition?: McpServerDefinition,
  sourceFingerprint?: string,
): McpServer {
  return {
    name,
    fingerprint: definition?.fingerprint ?? sourceFingerprint ?? fingerprint(`invalid:${name}`),
    status,
    reason,
    transport: definition?.transport ?? null,
    inputIds: definition?.inputIds ?? [],
    requiresOAuth: definition?.requiresOAuth ?? false,
  };
}

function invalidTopLevel(reason: string, diagnostics: Diagnostic[]): McpConfiguration {
  addDiagnostic(diagnostics, "mcp", "mcp.top-level-invalid", "error", reason);
  return { servers: [], definitions: new Map(), inputs: new Map(), diagnostics, topLevelValid: false };
}

function collectInputIds(value: unknown): string[] {
  return [...new Set(collectVariables(value).filter((variable) => variable.startsWith("input:")).map((variable) => variable.slice("input:".length)))].sort();
}

function collectVariables(value: unknown): string[] {
  const found: string[] = [];
  const walk = (item: unknown): void => {
    if (typeof item === "string") {
      for (const match of item.matchAll(VARIABLE_PATTERN)) found.push(match[1]);
    } else if (Array.isArray(item)) {
      item.forEach(walk);
    } else if (isRecord(item)) {
      Object.values(item).forEach(walk);
    }
  };
  walk(value);
  return found;
}

function supportedVariable(variable: string): boolean {
  return ["workspaceFolder", "workspaceFolderBasename", "userHome", "pathSeparator"].includes(variable)
    || variable.startsWith("env:")
    || variable.startsWith("input:");
}

function substituteVariables(value: string, values: McpVariableValues): string {
  return value.replace(VARIABLE_PATTERN, (_match, variable: string) => {
    if (variable === "workspaceFolder") return values.workspaceFolder;
    if (variable === "workspaceFolderBasename") return values.workspaceFolderBasename;
    if (variable === "userHome") return values.userHome;
    if (variable === "pathSeparator") return values.pathSeparator;
    if (variable.startsWith("input:")) {
      const input = values.inputs[variable.slice("input:".length)];
      if (input !== undefined) return input;
    }
    if (variable.startsWith("env:")) {
      const environment = values.environment[variable.slice("env:".length)];
      if (environment !== undefined) return environment;
    }
    throw new Error(`Variable '\${${variable}}' is unresolved.`);
  });
}

function containsLiteralSecret(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (!/secret|token|password|authorization|api[-_]?key/i.test(key) || typeof item !== "string") return false;
    return !item.includes("${input:");
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function optionalString(value: unknown): { value?: string; invalid: boolean } {
  return value === undefined ? { invalid: false } : typeof value === "string" ? { value, invalid: false } : { invalid: true };
}

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] | undefined {
  return value === undefined ? fallback : Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return {};
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string") ? value as Record<string, string> : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeUtf8(bytes: Buffer): { ok: true; value: string } | { ok: false; reason: string } {
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "MCP configuration is not valid UTF-8." };
  }
}

function addDiagnostic(diagnostics: Diagnostic[], resource: string, code: string, severity: Diagnostic["severity"], message: string): void {
  diagnostics.push({ resource, code, severity, message });
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
