import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkspaceStore } from "../../adapters/sqlite/workspaceStore";
import {
  authorize,
  authorityReviewConfirmationHash,
  grantIsActive,
  validateRepositoryPath,
  type AuthorityGrant,
  type EffectClass,
  type ReconciliationClassification,
  type ToolRequest,
} from "../execution-authority";
import type { ResourceSnapshot, ToolResource } from "../resources";
import { SafeGitExecutor, type GitStatusResult } from "./gitTools";
import { RepositoryToolExecutor, type RepositoryReadResult } from "./repositoryTools";

const SUPPORTED_TOOLS = new Set(["files/list", "files/read", "files/write", "git/status", "git/stage", "git/commit"]);

export type ChatToolApproval = "once" | "session" | "deny";

export interface ChatToolApprovalRequest {
  readonly tool: ToolResource;
  readonly affectedTargets: readonly string[];
  readonly riskSummary: string;
}

export interface ChatToolDispatcherOptions {
  readonly store: WorkspaceStore;
  readonly repositoryRoot: string;
  readonly chatId: string;
  readonly attemptId: string;
  readonly snapshot: ResourceSnapshot;
  readonly requestApproval: (request: ChatToolApprovalRequest) => Promise<ChatToolApproval>;
}

export interface ChatToolInvocationResult {
  readonly ok: boolean;
  readonly operationId?: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: {
    readonly code: string;
    readonly message?: string;
    readonly recovery?: ReconciliationClassification;
  };
}

/** The only pinned Tool definitions currently executable by the Chat dispatcher. */
export function chatModelTools(snapshot: ResourceSnapshot): readonly ToolResource[] {
  return snapshot.tools.filter((tool) =>
    tool.origin === "workbench"
    && tool.status === "available"
    && SUPPORTED_TOOLS.has(tool.identity),
  );
}

/** VS Code model Tool names cannot contain the slash used by durable Tool identities. */
export function chatModelToolName(identity: string): string {
  const readable = identity.replace(/[^A-Za-z0-9_-]/g, "_");
  return `bridgit_${readable}_${fingerprint(identity).slice(0, 8)}`;
}

export function resolveChatModelToolIdentity(snapshot: ResourceSnapshot, modelToolName: string): string | undefined {
  return chatModelTools(snapshot).find((tool) => chatModelToolName(tool.identity) === modelToolName)?.identity;
}

/**
 * Routes a model Tool call through the pinned snapshot, exact authority,
 * immutable intent/audit, single-writer lock, and known-outcome boundary.
 */
export class ChatToolDispatcher {
  private readonly repository: RepositoryToolExecutor;
  private git: SafeGitExecutor | undefined;

  public constructor(private readonly options: ChatToolDispatcherOptions) {
    this.repository = new RepositoryToolExecutor(options.repositoryRoot);
  }

  public async invoke(callId: string, identity: string, rawInput: unknown): Promise<ChatToolInvocationResult> {
    const tool = chatModelTools(this.options.snapshot).find((candidate) => candidate.identity === identity);
    if (!tool) return { ok: false, error: { code: "tool-not-in-pinned-workbench-snapshot" } };
    const input = asRecord(rawInput);
    const paths = toolPaths(identity, input);
    const affectedTargets = paths.map((path) => `repo:${path || "."}`);
    const requestWithoutKey = {
      tool: identity,
      effect: tool.effectClass,
      input,
      paths,
    } satisfies Omit<ToolRequest, "operationKey">;
    const request: ToolRequest = {
      ...requestWithoutKey,
      operationKey: fingerprint({ attemptId: this.options.attemptId, callId, ...requestWithoutKey }),
    };
    const targetFingerprint = fingerprint({
      repositoryRoot: resolve(this.options.repositoryRoot),
      identity,
      paths,
      inputSchemaFingerprint: tool.inputSchemaFingerprint,
    });
    const owner = { kind: "chat" as const, id: this.options.chatId };
    const authorityContext = { owner, resourceSnapshotId: this.options.snapshot.snapshotId };
    const capabilities = toolCapabilities(identity);
    let grant = this.options.store.listAuthorityGrants(owner).find((candidate) =>
      grantIsActive(candidate, authorityContext)
      && candidate.effectClass === tool.effectClass
      && capabilities.every((capability) => candidate.capabilities.includes(capability)),
    );
    let reviewId = grant?.reviewId ?? null;
    let userDenied = false;

    if (tool.effectClass !== "read" && !grant && !this.options.store.repositoryWriteLocked() && !this.options.store.workspaceMutationBlocked()) {
      const approval = await this.options.requestApproval({
        tool,
        affectedTargets,
        riskSummary: riskSummary(identity, affectedTargets),
      });
      userDenied = approval === "deny";
      const grantScope = approval === "session" ? "chat-session" : "chat-once";
      const review = this.options.store.createAuthorityReview({
        owner,
        grantScope,
        effectClass: tool.effectClass,
        capabilities,
        resourceSnapshotId: grantScope === "chat-once" ? this.options.snapshot.snapshotId : null,
        riskSummary: riskSummary(identity, affectedTargets),
      });
      reviewId = review.reviewId;
      grant = this.options.store.resolveAuthorityReview(
        review.reviewId,
        approval === "deny" ? "denied" : "approved",
        authorityReviewConfirmationHash(review),
      );
    }

    const decision = authorize(
      request,
      grant,
      this.options.repositoryRoot,
      this.options.store.repositoryWriteLocked() || this.options.store.workspaceMutationBlocked(),
      authorityContext,
    );
    const precondition = decision.allowed ? this.capturePrecondition(identity, input) : {};
    const auditInput = auditInputFor(callId, input, precondition);
    const operation = this.options.store.recordToolIntent({
      operationKey: request.operationKey,
      parentKind: "response-attempt",
      parentId: this.options.attemptId,
      effectClass: tool.effectClass,
      authorityGrantId: decision.allowed ? grant?.grantId ?? null : null,
      authorityReviewId: reviewId,
      resourceSnapshotId: this.options.snapshot.snapshotId,
      targetFingerprint,
      toolIdentity: identity,
      decisionCode: decision.allowed ? "allowed" : "denied",
      input: { ...auditInput, policyReason: decision.reason },
      affectedTargets,
    });
    if (!decision.allowed) {
      return {
        ok: false,
        operationId: operation.operationId,
        error: {
          code: userDenied ? "user-denied" : decision.reason,
          ...(userDenied
            ? { message: "The user denied this Tool call. Do not suggest changing repository permissions or retrying unless the user asks." }
            : {}),
        },
      };
    }

    let lockHeld = false;
    if (tool.effectClass !== "read") {
      lockHeld = this.options.store.acquireRepositoryWriteLock(operation.operationId);
      if (!lockHeld) {
        this.options.store.beginToolEffect(operation.operationId);
        this.options.store.recordToolOutcome(operation.operationId, "not-applied", { code: "repository-write-lock-held" }, affectedTargets);
        return { ok: false, operationId: operation.operationId, error: { code: "repository-write-lock-held" } };
      }
    }

    if (grant?.scope === "chat-once") this.options.store.consumeAuthorityGrant(grant.grantId);
    this.options.store.beginToolEffect(operation.operationId);
    try {
      const result = this.execute(identity, input);
      this.options.store.recordToolOutcome(operation.operationId, "applied", auditResult(result), affectedTargets);
      return { ok: true, operationId: operation.operationId, result: result as Readonly<Record<string, unknown>> };
    } catch (error) {
      const code = error instanceof Error ? error.message : "tool-execution-failed";
      if (tool.effectClass === "read") {
        this.options.store.recordToolOutcome(operation.operationId, "failed", { code }, affectedTargets);
        return { ok: false, operationId: operation.operationId, error: { code } };
      }
      this.options.store.markToolOutcomeUnknown(operation.operationId);
      const recovery = reconcileOperation(this.options.store, this.options.repositoryRoot, operation.operationId, precondition);
      return { ok: false, operationId: operation.operationId, error: { code, recovery } };
    } finally {
      if (lockHeld) this.options.store.releaseRepositoryWriteLock(operation.operationId);
    }
  }

  private execute(identity: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    if (identity.startsWith("files/")) return this.repository.invoke(identity, input) as unknown as Readonly<Record<string, unknown>>;
    this.git ??= new SafeGitExecutor(this.options.repositoryRoot);
    return this.git.invoke(identity, input) as unknown as Readonly<Record<string, unknown>>;
  }

  private capturePrecondition(identity: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    try {
      if (identity === "files/write" && typeof input.path === "string") {
        const path = validateRepositoryPath(this.options.repositoryRoot, input.path);
        if (!existsSync(resolve(this.options.repositoryRoot, path))) return { targetExists: false };
        const current = this.repository.invoke("files/read", { path, maxBytes: 1024 * 1024 }) as RepositoryReadResult;
        return { targetExists: true, targetSha256: current.sha256 };
      }
      if (identity === "git/stage" || identity === "git/commit") {
        this.git ??= new SafeGitExecutor(this.options.repositoryRoot);
        const status = this.git.invoke("git/status", {}) as GitStatusResult;
        return { head: status.head, indexFingerprint: status.indexFingerprint };
      }
    } catch {
      return { captureError: "tool-precondition-unavailable" };
    }
    return {};
  }
}

/** Reconciles interrupted mutations from the last Extension Host process without replaying them. */
export function reconcileWorkspaceOperations(store: WorkspaceStore, repositoryRoot: string): readonly {
  readonly operationId: string;
  readonly classification: ReconciliationClassification;
}[] {
  return store.listOperationsAwaitingReconciliation().map((operation) => {
    const audit = store.listToolAudits(operation.operationId)[0];
    const precondition = isRecord(audit?.sanitizedInput.precondition) ? audit.sanitizedInput.precondition : {};
    return {
      operationId: operation.operationId,
      classification: reconcileOperation(store, repositoryRoot, operation.operationId, precondition),
    };
  });
}

function reconcileOperation(
  store: WorkspaceStore,
  repositoryRoot: string,
  operationId: string,
  suppliedPrecondition: Readonly<Record<string, unknown>>,
): ReconciliationClassification {
  const audit = store.listToolAudits(operationId)[0];
  if (!audit) throw new Error("tool-audit-not-found");
  const input = isRecord(audit.sanitizedInput.arguments) ? audit.sanitizedInput.arguments : {};
  const precondition = Object.keys(suppliedPrecondition).length > 0
    ? suppliedPrecondition
    : isRecord(audit.sanitizedInput.precondition) ? audit.sanitizedInput.precondition : {};
  let classification: ReconciliationClassification = "inconclusive";
  let observation = "postcondition-ambiguous";

  try {
    if (audit.toolIdentity === "files/write") {
      const path = typeof input.path === "string" ? validateRepositoryPath(repositoryRoot, input.path) : "";
      const intendedSha256 = typeof audit.sanitizedInput.intendedSha256 === "string" ? audit.sanitizedInput.intendedSha256 : null;
      const expectedSha256 = typeof input.expectedSha256 === "string" ? input.expectedSha256 : null;
      const absolute = resolve(repositoryRoot, path);
      if (path && existsSync(absolute)) {
        const current = new RepositoryToolExecutor(repositoryRoot).invoke("files/read", { path, maxBytes: 1024 * 1024 }) as RepositoryReadResult;
        if (current.sha256 === intendedSha256) {
          classification = "applied";
          observation = "intended-content-present";
        } else if (precondition.targetExists === true && current.sha256 === precondition.targetSha256) {
          classification = "not-applied";
          observation = "file-precondition-unchanged";
        } else if (input.mode === "replace" && current.sha256 === expectedSha256) {
          classification = "not-applied";
          observation = "replace-precondition-still-present";
        }
      } else if (path && (input.mode === "create" || precondition.targetExists === false)) {
        classification = "not-applied";
        observation = "file-target-remains-absent";
      }
    } else if (audit.toolIdentity === "git/stage" || audit.toolIdentity === "git/commit") {
      const status = new SafeGitExecutor(repositoryRoot).invoke("git/status", {}) as GitStatusResult;
      if (status.head === precondition.head && status.indexFingerprint === precondition.indexFingerprint) {
        classification = "not-applied";
        observation = "git-precondition-unchanged";
      }
    }
  } catch {
    classification = "inconclusive";
    observation = "reconciliation-observation-failed";
  }

  store.startOperationReconciliation(operationId);
  store.recordReconciliation(operationId, classification, { observation });
  if (classification === "not-applied") store.abandonOperationRetry(operationId);
  return classification;
}

function auditInputFor(
  callId: string,
  input: Readonly<Record<string, unknown>>,
  precondition: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const arguments_ = { ...input };
  let intendedSha256: string | undefined;
  if (typeof arguments_.content === "string") {
    intendedSha256 = createHash("sha256").update(arguments_.content).digest("hex");
    arguments_.content = `[content:${Buffer.byteLength(arguments_.content, "utf8")} bytes sha256:${intendedSha256}]`;
  }
  return { callId, arguments: arguments_, precondition, ...(intendedSha256 ? { intendedSha256 } : {}) };
}

function auditResult(result: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (typeof result.content !== "string") return result;
  return {
    ...result,
    content: `[content:${Buffer.byteLength(result.content, "utf8")} bytes sha256:${createHash("sha256").update(result.content).digest("hex")}]`,
  };
}

function toolPaths(identity: string, input: Readonly<Record<string, unknown>>): readonly string[] {
  if (identity === "files/list") return [typeof input.path === "string" ? input.path : "."];
  if (identity === "files/read" || identity === "files/write") return typeof input.path === "string" ? [input.path] : [];
  if (identity === "git/stage") return Array.isArray(input.paths) ? input.paths.filter((value): value is string => typeof value === "string") : [];
  return [];
}

function toolCapabilities(identity: string): readonly string[] {
  return identity === "git/stage" || identity === "git/commit"
    ? [`tool:${identity}`, "local-commit"]
    : [`tool:${identity}`];
}

function riskSummary(identity: string, affectedTargets: readonly string[]): string {
  return `${identity} requests a repository mutation${affectedTargets.length ? ` affecting ${affectedTargets.join(", ")}` : ""}.`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("tool-input-must-be-object");
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
