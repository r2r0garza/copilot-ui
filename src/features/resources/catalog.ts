import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type ResourceStatus = "available" | "unavailable" | "invalid";
export type ToolOrigin = "workbench" | "extension" | "mcp";
export interface Diagnostic { readonly resource: string; readonly message: string; }
export interface AgentResource { readonly identity: string; readonly description: string; readonly instructions: string; readonly model: string | null; readonly tools: readonly string[] | null; readonly status: ResourceStatus; }
export interface SkillResource { readonly name: string; readonly description: string; readonly userInvocable: boolean; readonly status: ResourceStatus; }
export interface McpServer { readonly name: string; readonly fingerprint: string; readonly status: ResourceStatus; readonly reason?: string; }
export interface ToolResource { readonly identity: string; readonly origin: ToolOrigin; readonly status: ResourceStatus; readonly inputSchemaFingerprint: string; }
export interface ResourceCatalog { readonly agents: readonly AgentResource[]; readonly skills: readonly SkillResource[]; readonly mcpServers: readonly McpServer[]; readonly diagnostics: readonly Diagnostic[]; }
export interface ResourceSnapshot { readonly snapshotId: string; readonly createdAt: string; readonly agentIdentity: string; readonly effectiveModelId: string; readonly tools: readonly ToolResource[]; readonly catalogFingerprint: string; }

/** Fixed, shallow repository discovery. Invalid entries are isolated from valid peers. */
export function discoverResources(root: string): ResourceCatalog {
  const diagnostics: Diagnostic[] = [];
  const agents = discoverAgents(join(root, ".github", "agents"), diagnostics);
  const skills = discoverSkills(join(root, ".github", "skills"), diagnostics);
  const mcpServers = discoverMcp(join(root, ".vscode", "mcp.json"), diagnostics);
  return { agents, skills, mcpServers, diagnostics };
}

export function selectTools(available: readonly ToolResource[], allowlist: readonly string[] | null): readonly ToolResource[] {
  if (allowlist === null) return available.filter((tool) => tool.status === "available");
  return available.filter((tool) => tool.status === "available" && allowlist.some((item) => item === tool.identity || (item.endsWith("/*") && tool.identity.startsWith(item.slice(0, -1)))));
}

export function pinSnapshot(catalog: ResourceCatalog, agent: AgentResource, effectiveModelId: string, tools: readonly ToolResource[], now = new Date().toISOString()): ResourceSnapshot {
  const payload = JSON.stringify({ catalog, agent: agent.identity, effectiveModelId, tools });
  const catalogFingerprint = fingerprint(payload);
  return { snapshotId: fingerprint(`${now}:${payload}`), createdAt: now, agentIdentity: agent.identity, effectiveModelId, tools: [...tools], catalogFingerprint };
}

function discoverAgents(directory: string, diagnostics: Diagnostic[]): AgentResource[] {
  if (!existsSync(directory)) return [];
  const seen = new Set<string>();
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md")).map((entry) => {
    const identity = entry.name.slice(0, -".agent.md".length);
    const source = readFileSync(join(directory, entry.name), "utf8");
    const parsed = frontmatter(source);
    const invalid = !/^[A-Za-z0-9._-]+$/.test(identity) || seen.has(identity.toLowerCase()) || !parsed.values.description || !parsed.body.trim();
    seen.add(identity.toLowerCase());
    const unsupported = parsed.values.hooks !== undefined || (parsed.values.target !== undefined && parsed.values.target !== "vscode");
    const status: ResourceStatus = invalid ? "invalid" : unsupported ? "unavailable" : "available";
    if (status !== "available") diagnostics.push({ resource: `agent:${identity}`, message: invalid ? "Invalid identity, description, or instructions." : "Unsupported target or preview hooks." });
    return { identity, description: parsed.values.description ?? "", instructions: parsed.body, model: parsed.values.model ?? null, tools: parsed.lists.tools, status };
  });
}

function discoverSkills(directory: string, diagnostics: Diagnostic[]): SkillResource[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const file = join(directory, entry.name, "SKILL.md");
    if (!existsSync(file)) return { name: entry.name, description: "", userInvocable: false, status: "invalid" as const };
    const parsed = frontmatter(readFileSync(file, "utf8"));
    const unavailable = parsed.values.context === "fork";
    const invalid = parsed.values.name !== entry.name || !parsed.values.description || !parsed.body.trim();
    if (invalid || unavailable) diagnostics.push({ resource: `skill:${entry.name}`, message: invalid ? "Name, description, or body is invalid." : "Fork context is unavailable." });
    return { name: entry.name, description: parsed.values.description ?? "", userInvocable: parsed.values["user-invocable"] !== "false", status: invalid ? "invalid" : unavailable ? "unavailable" : "available" };
  });
}

function discoverMcp(file: string, diagnostics: Diagnostic[]): McpServer[] {
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { diagnostics.push({ resource: "mcp", message: "Malformed top-level MCP JSON." }); return []; }
  if (!parsed || typeof parsed !== "object" || !((parsed as { servers?: unknown }).servers && typeof (parsed as { servers?: unknown }).servers === "object")) { diagnostics.push({ resource: "mcp", message: "MCP configuration has no servers mapping." }); return []; }
  return Object.entries((parsed as { servers: Record<string, unknown> }).servers).map(([name, config]) => {
    const value = config as Record<string, unknown>;
    const unsupported = value.sandboxEnabled === true || value.type === "enterprise-managed-oauth";
    const valid = typeof value === "object" && value !== null && (typeof value.command === "string" || typeof value.url === "string");
    const status: ResourceStatus = !valid ? "invalid" : unsupported ? "unavailable" : "available";
    if (status !== "available") diagnostics.push({ resource: `mcp:${name}`, message: !valid ? "Missing command or URL." : "Unsupported sandbox or OAuth mode." });
    return { name, fingerprint: fingerprint(JSON.stringify(config)), status, reason: status === "available" ? undefined : "Configuration is not runnable." };
  });
}

function frontmatter(source: string): { values: Record<string, string>; lists: Record<string, readonly string[] | null>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { values: {}, lists: {}, body: source };
  const values: Record<string, string> = {}; const lists: Record<string, readonly string[] | null> = {};
  for (const line of match[1].split(/\r?\n/)) { const item = line.match(/^([\w-]+):\s*(.*)$/); if (!item) continue; const [, key, raw] = item; if (raw === "[]") lists[key] = []; else if (raw.startsWith("[") && raw.endsWith("]")) lists[key] = raw.slice(1, -1).split(",").map((value) => value.trim()).filter(Boolean); else values[key] = raw.replace(/^['"]|['"]$/g, ""); }
  return { values, lists, body: match[2] };
}
function fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }
