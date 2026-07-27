import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isAlias, isMap, isScalar, parseDocument, visit, type Node, type Pair } from "yaml";

import { repositoryToolCatalog } from "../tools/repositoryTools";
import { readMcpConfiguration, type McpTransport } from "./mcp";

export type ResourceStatus = "available" | "unavailable" | "invalid";
export type ToolOrigin = "workbench" | "extension" | "mcp";
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  readonly resource: string;
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

export interface AgentResource {
  readonly identity: string;
  readonly description: string;
  readonly instructions: string;
  readonly model: string | readonly string[] | null;
  readonly tools: readonly string[] | null;
  readonly status: ResourceStatus;
  readonly reason?: string;
}

export interface SkillResource {
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly disableModelInvocation: boolean;
  readonly status: ResourceStatus;
  readonly reason?: string;
}

export interface McpServer {
  readonly name: string;
  readonly fingerprint: string;
  readonly status: ResourceStatus;
  readonly reason?: string;
  readonly transport: McpTransport | null;
  readonly inputIds: readonly string[];
  readonly requiresOAuth: boolean;
}

export interface ToolResource {
  readonly identity: string;
  readonly description: string;
  readonly origin: ToolOrigin;
  readonly effectClass: "read" | "repository-write" | "ambient";
  readonly status: ResourceStatus;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly inputSchemaFingerprint: string;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly reason?: string;
}

export interface ResourceCatalog {
  readonly agents: readonly AgentResource[];
  readonly skills: readonly SkillResource[];
  readonly mcpServers: readonly McpServer[];
  readonly tools: readonly ToolResource[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ResourceSnapshot {
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly createdAt: string;
  readonly catalogRevision: number;
  readonly agentIdentity: string;
  readonly agent: AgentResource;
  readonly effectiveModelId: string;
  readonly effectiveModel: EffectiveModelSnapshot;
  readonly tools: readonly ToolResource[];
  readonly unresolvedToolSelectors: readonly string[];
  readonly catalogFingerprint: string;
}

export interface EffectiveModelSnapshot {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;
  readonly selectionSource: "requested" | "agent" | "auto";
}

const AGENT_FRONTMATTER_BYTES = 32 * 1024;
const AGENT_FILE_BYTES = 256 * 1024;
const AGENT_INSTRUCTION_CHARACTERS = 30_000;
const SKILL_NAME_CHARACTERS = 64;
const SKILL_DESCRIPTION_CHARACTERS = 1024;
const BUNDLED_PROTECTED_IDENTITIES = new Set(["memory-manager", "skill-creator", "agent-creator"]);
const AGENT_FIELDS = new Set([
  "name", "description", "argument-hint", "tools", "agents", "model",
  "user-invocable", "disable-model-invocation", "infer", "target", "handoffs",
  "hooks", "mcp-servers", "metadata",
]);
const SKILL_FIELDS = new Set([
  "name", "description", "argument-hint", "user-invocable",
  "disable-model-invocation", "context",
]);

/** Fixed, shallow repository discovery. Invalid entries are isolated from valid peers. */
export function discoverResources(root: string, additionalTools: readonly ToolResource[] = []): ResourceCatalog {
  const diagnostics: Diagnostic[] = [];
  const agents = discoverAgents(join(root, ".github", "agents"), diagnostics);
  const skills = discoverSkills(join(root, ".github", "skills"), diagnostics);
  const mcp = readMcpConfiguration(join(root, ".vscode", "mcp.json"));
  diagnostics.push(...mcp.diagnostics);
  const mcpServers = mcp.servers;
  const tools = mergeToolCatalog([...repositoryToolCatalog, ...additionalTools], diagnostics);
  return { agents, skills, mcpServers, tools, diagnostics };
}

/** Skill instructions are intentionally read only after selection. */
export function loadSkillInstructions(root: string, skillName: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) throw new Error("Invalid Skill name.");
  const file = join(root, ".github", "skills", skillName, "SKILL.md");
  if (!existsSync(file)) throw new Error("SKILL.md is missing.");
  const parsed = readFrontmatterFile(file);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.body;
}

export interface ToolSelection {
  readonly tools: readonly ToolResource[];
  readonly unresolved: readonly string[];
}

/**
 * Resolves the native Agent allowlist exactly. Unknown, unavailable, invalid,
 * and identity-colliding Tools stay unresolved and are never substituted.
 */
export function resolveToolSelection(catalog: readonly ToolResource[], allowlist: readonly string[] | null): ToolSelection {
  const identityCounts = new Map<string, number>();
  for (const tool of catalog) identityCounts.set(tool.identity, (identityCounts.get(tool.identity) ?? 0) + 1);
  const eligible = catalog.filter((tool) => tool.status === "available" && identityCounts.get(tool.identity) === 1);
  if (allowlist === null) return { tools: eligible, unresolved: [] };

  const selected = new Set<string>();
  const unresolved: string[] = [];
  for (const selector of allowlist) {
    const matches = validToolSelector(selector)
      ? eligible.filter((tool) => matchesToolSelector(tool.identity, selector))
      : [];
    if (matches.length === 0) unresolved.push(selector);
    for (const tool of matches) selected.add(tool.identity);
  }
  return {
    tools: eligible.filter((tool) => selected.has(tool.identity)),
    unresolved,
  };
}

export function selectTools(available: readonly ToolResource[], allowlist: readonly string[] | null): readonly ToolResource[] {
  return resolveToolSelection(available, allowlist).tools;
}

export function pinSnapshot(
  catalog: ResourceCatalog,
  agent: AgentResource,
  effectiveModel: EffectiveModelSnapshot,
  attemptId: string,
  now = new Date().toISOString(),
  catalogRevision = 0,
): ResourceSnapshot {
  const selection = resolveToolSelection(catalog.tools, agent.tools);
  const catalogFingerprint = fingerprint(JSON.stringify(catalog));
  const pinned = immutableClone({
    attemptId,
    createdAt: now,
    catalogRevision,
    agentIdentity: agent.identity,
    agent,
    effectiveModelId: effectiveModel.id,
    effectiveModel,
    tools: selection.tools,
    unresolvedToolSelectors: selection.unresolved,
    catalogFingerprint,
  });
  return deepFreeze({ snapshotId: fingerprint(JSON.stringify(pinned)), ...pinned });
}

function discoverAgents(directory: string, diagnostics: Diagnostic[]): AgentResource[] {
  if (!existsSync(directory)) return [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  const agents = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const identity = entry.name.slice(0, -".agent.md".length);
      try { return parseAgent(join(directory, entry.name), identity, diagnostics); }
      catch {
        return invalidAgent(
          { identity, description: "", instructions: "", model: null, tools: null, status: "invalid" },
          diagnostics,
          `agent:${identity}`,
          "agent.read-failed",
          "Agent source could not be read during refresh.",
        );
      }
    });

  const identities = new Map<string, number[]>();
  for (const [index, agent] of agents.entries()) {
    const key = agent.identity.toLowerCase();
    identities.set(key, [...(identities.get(key) ?? []), index]);
  }
  for (const [identity, indexes] of identities) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const agent = agents[index];
      agents[index] = { ...agent, status: "invalid", reason: "Identity conflicts case-insensitively with another Repository Agent." };
      addDiagnostic(diagnostics, `agent:${agent.identity}`, "agent.identity-collision", "error", `Agent identity conflicts case-insensitively with '${identity}'.`);
    }
  }
  return agents;
}

function mergeToolCatalog(tools: readonly ToolResource[], diagnostics: Diagnostic[]): readonly ToolResource[] {
  const identities = new Map<string, number[]>();
  for (const [index, tool] of tools.entries()) {
    identities.set(tool.identity, [...(identities.get(tool.identity) ?? []), index]);
  }

  const merged = tools.map((tool) => ({ ...tool }));
  for (const [identity, indexes] of identities) {
    if (indexes.length < 2) continue;
    const origins = [...new Set(indexes.map((index) => tools[index].origin))].sort();
    for (const index of indexes) {
      merged[index] = {
        ...merged[index],
        status: "invalid",
        reason: `Tool identity conflicts across catalog sources (${origins.join(", ")}).`,
      };
    }
    addDiagnostic(
      diagnostics,
      `tool:${identity}`,
      "tool.identity-collision",
      "error",
      `Tool identity is registered ${indexes.length} times across ${origins.join(", ")} origins; every conflicting Tool was disabled.`,
    );
  }
  return merged;
}

function validToolSelector(selector: string): boolean {
  if (selector.length === 0 || selector.trim() !== selector) return false;
  const wildcard = selector.indexOf("*");
  return wildcard === -1 || (selector.endsWith("/*") && wildcard === selector.length - 1 && selector.length > 2);
}

function matchesToolSelector(identity: string, selector: string): boolean {
  return selector === identity || (selector.endsWith("/*") && identity.startsWith(selector.slice(0, -1)));
}

function parseAgent(file: string, identity: string, diagnostics: Diagnostic[]): AgentResource {
  const resource = `agent:${identity}`;
  const fallback: AgentResource = { identity, description: "", instructions: "", model: null, tools: null, status: "invalid" };
  const bytes = readFileSync(file);
  if (bytes.byteLength > AGENT_FILE_BYTES) return invalidAgent(fallback, diagnostics, resource, "agent.file-too-large", "Agent file exceeds 256 KiB.");
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return invalidAgent(fallback, diagnostics, resource, "agent.invalid-utf8", decoded.reason);
  const split = splitFrontmatter(decoded.value);
  if (!split.ok) return invalidAgent(fallback, diagnostics, resource, "agent.frontmatter-invalid", split.reason);
  if (Buffer.byteLength(split.yaml, "utf8") > AGENT_FRONTMATTER_BYTES) return invalidAgent(fallback, diagnostics, resource, "agent.frontmatter-too-large", "Agent frontmatter exceeds 32 KiB.");
  const parsed = parseYamlMapping(split.yaml);
  if (!parsed.ok) return invalidAgent({ ...fallback, instructions: split.body }, diagnostics, resource, "agent.yaml-invalid", parsed.reason);

  warnUnknownFields(resource, parsed.value, AGENT_FIELDS, diagnostics);
  if (parsed.value.infer !== undefined) addDiagnostic(diagnostics, resource, "agent.infer-deprecated", "warning", "The deprecated 'infer' field is accepted for compatibility.");
  if (parsed.value["mcp-servers"] !== undefined || parsed.value.metadata !== undefined) addDiagnostic(diagnostics, resource, "agent.cloud-fields-ignored", "info", "Cloud-only MCP servers or metadata are ignored locally.");

  const description = stringValue(parsed.value.description);
  const model = stringOrStringList(parsed.value.model);
  const tools = stringList(parsed.value.tools);
  const agents = stringList(parsed.value.agents);
  const userInvocable = booleanValue(parsed.value["user-invocable"], true);
  const disableModelInvocation = booleanValue(parsed.value["disable-model-invocation"], false);
  const identityValid = /^[A-Za-z0-9._-]+$/.test(identity) && !BUNDLED_PROTECTED_IDENTITIES.has(identity.toLowerCase());
  const fieldsValid = description !== null && description.trim().length > 0
    && optionalString(parsed.value.name)
    && optionalString(parsed.value["argument-hint"])
    && optionalString(parsed.value.target)
    && model !== undefined;
  const invocationValid = userInvocable !== null && disableModelInvocation !== null;
  const listsValid = tools !== undefined && agents !== undefined;
  const instructionsValid = split.body.trim().length > 0 && [...split.body].length <= AGENT_INSTRUCTION_CHARACTERS;
  if (!identityValid || !fieldsValid || !invocationValid || !listsValid || !instructionsValid) {
    return invalidAgent(
      { ...fallback, description: description ?? "", instructions: split.body, model: model ?? null, tools: tools ?? null },
      diagnostics,
      resource,
      "agent.schema-invalid",
      "Agent identity, native fields, description, or instructions are invalid.",
    );
  }

  const target = stringValue(parsed.value.target);
  const hasHooks = parsed.value.hooks !== undefined;
  const unavailable = hasHooks || (target !== null && target !== "vscode") || (userInvocable === false && disableModelInvocation === true);
  const reason = hasHooks
    ? "Preview hooks are not runnable."
    : target !== null && target !== "vscode"
      ? `Target '${target}' is not runnable locally.`
      : unavailable
        ? "Agent disables both user and model invocation."
        : undefined;
  if (reason) addDiagnostic(diagnostics, resource, "agent.unavailable", "warning", reason);
  return { identity, description: description ?? "", instructions: split.body, model: model ?? null, tools: tools ?? null, status: unavailable ? "unavailable" : "available", reason };
}

function discoverSkills(directory: string, diagnostics: Diagnostic[]): SkillResource[] {
  if (!existsSync(directory)) return [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      try { return parseSkill(join(directory, entry.name, "SKILL.md"), entry.name, diagnostics); }
      catch {
        return invalidSkill(
          { name: entry.name, description: "", userInvocable: false, disableModelInvocation: false, status: "invalid" },
          diagnostics,
          `skill:${entry.name}`,
          "skill.read-failed",
          "Skill source could not be read during refresh.",
        );
      }
    });
}

function parseSkill(file: string, directoryName: string, diagnostics: Diagnostic[]): SkillResource {
  const resource = `skill:${directoryName}`;
  const fallback: SkillResource = { name: directoryName, description: "", userInvocable: false, disableModelInvocation: false, status: "invalid" };
  if (!existsSync(file)) return invalidSkill(fallback, diagnostics, resource, "skill.file-missing", "SKILL.md is missing.");
  const parsed = readFrontmatterFile(file);
  if (!parsed.ok) return invalidSkill(fallback, diagnostics, resource, "skill.frontmatter-invalid", parsed.reason);
  warnUnknownFields(resource, parsed.values, SKILL_FIELDS, diagnostics);

  const name = stringValue(parsed.values.name);
  const description = stringValue(parsed.values.description);
  const userInvocable = booleanValue(parsed.values["user-invocable"], true);
  const disableModelInvocation = booleanValue(parsed.values["disable-model-invocation"], false);
  const nameValid = name === directoryName && name.length <= SKILL_NAME_CHARACTERS && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
  const valid = nameValid && description !== null && description.trim().length > 0 && description.length <= SKILL_DESCRIPTION_CHARACTERS
    && userInvocable !== null && disableModelInvocation !== null
    && optionalString(parsed.values["argument-hint"])
    && (parsed.values.context === undefined || parsed.values.context === "fork")
    && parsed.body.trim().length > 0;
  if (!valid) return invalidSkill(
    { ...fallback, description: description ?? "", userInvocable: userInvocable ?? false, disableModelInvocation: disableModelInvocation ?? false },
    diagnostics,
    resource,
    "skill.schema-invalid",
    "Skill name, description, invocation fields, or body are invalid.",
  );
  const unavailable = parsed.values.context === "fork";
  const reason = unavailable ? "Fork context is unavailable." : undefined;
  if (reason) addDiagnostic(diagnostics, resource, "skill.unavailable", "warning", reason);
  return { name, description, userInvocable, disableModelInvocation, status: unavailable ? "unavailable" : "available", reason };
}

function readFrontmatterFile(file: string): { ok: true; values: Record<string, unknown>; body: string } | { ok: false; reason: string } {
  const decoded = decodeUtf8(readFileSync(file));
  if (!decoded.ok) return decoded;
  const split = splitFrontmatter(decoded.value);
  if (!split.ok) return split;
  const parsed = parseYamlMapping(split.yaml);
  return parsed.ok ? { ok: true, values: parsed.value, body: split.body } : parsed;
}

function splitFrontmatter(source: string): { ok: true; yaml: string; body: string } | { ok: false; reason: string } {
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  return match ? { ok: true, yaml: match[1], body: match[2] } : { ok: false, reason: "A single YAML frontmatter mapping is required." };
}

function parseYamlMapping(source: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  const document = parseDocument(source, { uniqueKeys: true, merge: false, prettyErrors: false });
  if (document.errors.length > 0) return { ok: false, reason: document.errors[0].message };
  if (!isMap(document.contents)) return { ok: false, reason: "Frontmatter must be a YAML mapping." };
  let forbidden: string | undefined;
  visit(document, {
    Node(_key, node: Node) {
      if (isAlias(node)) forbidden ??= "YAML aliases are not supported.";
      else if ("anchor" in node && node.anchor) forbidden ??= "YAML anchors are not supported.";
      else if (node.tag) forbidden ??= "Custom YAML tags are not supported.";
    },
    Pair(_key, pair: Pair) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") forbidden ??= "YAML mapping keys must be strings.";
      else if (pair.key.value === "<<") forbidden ??= "YAML merge keys are not supported.";
    },
  });
  if (forbidden) return { ok: false, reason: forbidden };
  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : { ok: false, reason: "Frontmatter must be a YAML mapping." };
}

function decodeUtf8(bytes: Buffer): { ok: true; value: string } | { ok: false; reason: string } {
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "Resource is not valid UTF-8." };
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): readonly string[] | null | undefined {
  if (value === undefined) return null;
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringOrStringList(value: unknown): string | readonly string[] | null | undefined {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean | null {
  return value === undefined ? fallback : typeof value === "boolean" ? value : null;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function warnUnknownFields(resource: string, values: Record<string, unknown>, supported: ReadonlySet<string>, diagnostics: Diagnostic[]): void {
  for (const field of Object.keys(values)) {
    if (!supported.has(field)) addDiagnostic(diagnostics, resource, "resource.unknown-field", "warning", `Unknown native field '${field}' is ignored.`);
  }
}

function invalidAgent(agent: AgentResource, diagnostics: Diagnostic[], resource: string, code: string, reason: string): AgentResource {
  addDiagnostic(diagnostics, resource, code, "error", reason);
  return { ...agent, status: "invalid", reason };
}

function invalidSkill(skill: SkillResource, diagnostics: Diagnostic[], resource: string, code: string, reason: string): SkillResource {
  addDiagnostic(diagnostics, resource, code, "error", reason);
  return { ...skill, status: "invalid", reason };
}

function addDiagnostic(diagnostics: Diagnostic[], resource: string, code: string, severity: DiagnosticSeverity, message: string): void {
  diagnostics.push({ resource, code, severity, message });
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function immutableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
