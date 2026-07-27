import { createHash, randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";

import { grantIsActive, type AuthorityContext, type AuthorityGrant } from "./grants";

export type EffectClass = "read" | "repository-write" | "ambient";
export interface ToolRequest {
  readonly tool: string;
  readonly effect: EffectClass;
  readonly input: Record<string, unknown>;
  readonly paths?: readonly string[];
  /** Runtime-derived exact authority categories; model-provided arguments never populate this field. */
  readonly authorityCapabilities?: readonly string[];
  readonly operationKey: string;
}
export interface PolicyDecision { readonly allowed: boolean; readonly reason: string; readonly sanitizedInput: Record<string, unknown>; }
export interface ToolAudit { readonly auditId: string; readonly operationKey: string; readonly tool: string; readonly decision: PolicyDecision; readonly snapshotId: string; readonly createdAt: string; }

export function validateRepositoryPath(repositoryRoot: string, candidate: string): string {
  if (!candidate || candidate.includes("\0") || /^(?:[\\/]|[A-Za-z]:|\\\\|\\\.\\)/.test(candidate)) throw new Error("path-must-be-repository-relative");
  if (candidate.split(/[\\/]+/).some((segment) => segment === "..")) throw new Error("path-parent-traversal-rejected");
  const root = resolve(repositoryRoot); const target = resolve(root, candidate);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("path-outside-repository-boundary");
  return relative(root, target).split(sep).join("/");
}

export function authorize(request: ToolRequest, grant: AuthorityGrant | undefined, repositoryRoot: string, writeLocked: boolean, context?: AuthorityContext): PolicyDecision {
  const sanitizedInput = sanitize(request.input);
  try { for (const path of request.paths ?? []) validateRepositoryPath(repositoryRoot, path); } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : "invalid-path", sanitizedInput }; }
  if (writeLocked && request.effect !== "read") return { allowed: false, reason: "repository-write-lock-held", sanitizedInput };
  if (request.effect === "read") return { allowed: true, reason: "read-only", sanitizedInput };
  if (!grant || !context || !grantIsActive(grant, context)) return { allowed: false, reason: "missing-explicit-authority", sanitizedInput };
  if (grant.effectClass !== request.effect) return { allowed: false, reason: "effect-class-authority-required", sanitizedInput };
  if (!grant.capabilities.includes(`tool:${request.tool}`)) return { allowed: false, reason: "tool-authority-required", sanitizedInput };
  if ((request.tool === "git/stage" || request.tool === "git/commit") && !grant.capabilities.includes("local-commit")) {
    return { allowed: false, reason: "local-commit-authority-required", sanitizedInput };
  }
  if (request.effect === "ambient" && !grant.capabilities.includes(`ambient:${request.tool}`)) return { allowed: false, reason: "ambient-authority-required", sanitizedInput };
  if ((request.authorityCapabilities ?? []).some((capability) => !grant.capabilities.includes(capability))) {
    return { allowed: false, reason: "separate-authority-required", sanitizedInput };
  }
  return { allowed: true, reason: "explicit-grant", sanitizedInput };
}

export function audit(request: ToolRequest, decision: PolicyDecision, snapshotId: string, now = new Date().toISOString()): ToolAudit { return { auditId: randomUUID(), operationKey: request.operationKey, tool: request.tool, decision, snapshotId, createdAt: now }; }
export function operationKey(request: Omit<ToolRequest, "operationKey">): string { return createHash("sha256").update(JSON.stringify({ tool: request.tool, effect: request.effect, input: sanitize(request.input), paths: request.paths })).digest("hex"); }
export function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(input, new WeakSet()) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[redacted-circular]";
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[redacted-circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /secret|token|password|authorization|credential|api[-_]?key/i.test(key)
      ? [key, "[redacted]"]
      : [key, sanitizeValue(item, seen)],
  ));
}
