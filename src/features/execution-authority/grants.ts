import { createHash } from "node:crypto";

export type AuthorityOwnerKind = "chat" | "task";
export type AuthorityGrantScope = "chat-once" | "chat-session" | "task";
export type AuthorityEffectClass = "read" | "repository-write" | "ambient";
export type AuthorityReviewDecision = "approved" | "denied";
export type AuthorityReviewStatus = "open" | AuthorityReviewDecision | "stale" | "cancelled";

export interface AuthorityOwner {
  readonly kind: AuthorityOwnerKind;
  readonly id: string;
}

export interface AuthorityScope {
  readonly capabilities: readonly string[];
}

export interface AuthorityReview {
  readonly reviewId: string;
  readonly owner: AuthorityOwner;
  readonly version: number;
  readonly grantScope: AuthorityGrantScope;
  readonly effectClass: AuthorityEffectClass;
  readonly requestedScope: AuthorityScope;
  readonly resourceSnapshotId: string | null;
  readonly riskSummary: string;
  readonly status: AuthorityReviewStatus;
  readonly decision: AuthorityReviewDecision | null;
  readonly confirmationHash: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface AuthorityGrant {
  readonly grantId: string;
  readonly reviewId: string;
  readonly owner: AuthorityOwner;
  readonly scope: AuthorityGrantScope;
  readonly effectClass: AuthorityEffectClass;
  readonly capabilities: readonly string[];
  readonly resourceSnapshotId: string | null;
  readonly fingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly consumedAt: string | null;
}

export interface AuthorityContext {
  readonly owner: AuthorityOwner;
  readonly resourceSnapshotId: string | null;
  readonly now?: string;
}

export interface CreateAuthorityReview {
  readonly owner: AuthorityOwner;
  readonly grantScope: AuthorityGrantScope;
  readonly effectClass: AuthorityEffectClass;
  readonly capabilities: readonly string[];
  readonly resourceSnapshotId: string | null;
  readonly riskSummary: string;
  readonly taskPhase?: "admission" | "execution";
}

export function normalizeAuthorityScope(scope: AuthorityScope): AuthorityScope {
  const capabilities = [...new Set(scope.capabilities.map((capability) => capability.trim()))]
    .filter(Boolean)
    .sort();
  if (capabilities.length === 0) throw new Error("authority-scope-empty");
  if (capabilities.some((capability) => !validAuthorityCapability(capability))) throw new Error("authority-capability-invalid");
  return { capabilities };
}

export function validateGrantOwner(owner: AuthorityOwner, scope: AuthorityGrantScope, taskPhase: "admission" | "execution" = "admission"): void {
  if (!owner.id.trim()) throw new Error("authority-owner-empty");
  if (owner.kind === "chat" && scope === "task") throw new Error("chat-cannot-receive-task-authority");
  if (owner.kind === "task" && scope !== "task") throw new Error("task-requires-task-authority");
  if (owner.kind === "task" && taskPhase !== "admission") throw new Error("task-authority-fixed-at-admission");
}

export function authorityGrantFingerprint(grant: Pick<AuthorityGrant, "owner" | "scope" | "effectClass" | "capabilities" | "resourceSnapshotId">): string {
  const normalized = normalizeAuthorityScope({ capabilities: grant.capabilities });
  return createHash("sha256").update(JSON.stringify({
    owner: grant.owner,
    scope: grant.scope,
    effectClass: grant.effectClass,
    capabilities: normalized.capabilities,
    resourceSnapshotId: grant.resourceSnapshotId,
  })).digest("hex");
}

export function authorityReviewConfirmationHash(review: Pick<AuthorityReview, "owner" | "version" | "grantScope" | "effectClass" | "requestedScope" | "resourceSnapshotId" | "riskSummary">): string {
  const requestedScope = normalizeAuthorityScope(review.requestedScope);
  return createHash("sha256").update(JSON.stringify({
    owner: review.owner,
    version: review.version,
    grantScope: review.grantScope,
    effectClass: review.effectClass,
    requestedScope,
    resourceSnapshotId: review.resourceSnapshotId,
    riskSummary: review.riskSummary,
  })).digest("hex");
}

export function grantIsActive(grant: AuthorityGrant, context: AuthorityContext): boolean {
  const now = context.now ?? new Date().toISOString();
  try {
    validateGrantOwner(grant.owner, grant.scope);
    if (grant.owner.kind !== context.owner.kind || grant.owner.id !== context.owner.id) return false;
    if (grant.resourceSnapshotId !== null && grant.resourceSnapshotId !== context.resourceSnapshotId) return false;
    if (grant.revokedAt !== null || grant.consumedAt !== null) return false;
    if (grant.expiresAt !== null && grant.expiresAt <= now) return false;
    return grant.fingerprint === authorityGrantFingerprint(grant);
  } catch {
    return false;
  }
}

function validAuthorityCapability(capability: string): boolean {
  if (capability === "local-commit") return true;
  if (/^(?:tool|ambient):[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(capability)) return true;
  if (/^(?:extension-tool|mcp-server):[A-Za-z0-9._/-]+@[a-f0-9]{64}$/.test(capability)) return true;
  return /^(?:command-family|arbitrary-shell|external-capability):[a-f0-9]{64}$/.test(capability);
}
