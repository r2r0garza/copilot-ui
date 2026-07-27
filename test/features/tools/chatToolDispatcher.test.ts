import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";
import { authorityReviewConfirmationHash } from "../../../src/features/execution-authority";
import { pinSnapshot, type AgentResource, type ResourceSnapshot, type ToolResource } from "../../../src/features/resources";
import {
  ChatToolDispatcher,
  chatModelToolName,
  chatModelTools,
  reconcileWorkspaceOperations,
  repositoryToolCatalog,
  resolveChatModelToolIdentity,
} from "../../../src/features/tools";

test("exposes only pinned supported Workbench Tools and executes audited reads", async () => {
  const fixture = workspace([
    ...repositoryToolCatalog,
    extensionTool("copilot/readFile"),
  ]);
  writeFileSync(join(fixture.repositoryRoot, "README.md"), "hello\n");
  let approvals = 0;
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => { approvals += 1; return "deny"; },
  });

  assert.deepEqual(chatModelTools(fixture.snapshot).map((tool) => tool.identity), repositoryToolCatalog.map((tool) => tool.identity));
  const modelName = chatModelToolName("files/read");
  assert.match(modelName, /^[A-Za-z0-9_-]+$/);
  assert.equal(resolveChatModelToolIdentity(fixture.snapshot, modelName), "files/read");
  const result = await dispatcher.invoke("call-read", "files/read", { path: "README.md" });

  assert.equal(result.ok, true);
  assert.equal(result.result?.content, "hello\n");
  assert.equal(approvals, 0);
  const audit = fixture.store.listToolAudits(result.operationId!)[0]!;
  assert.equal(audit.decisionCode, "allowed");
  assert.equal(audit.outcomeCode, "applied");
  assert.match(String(audit.sanitizedResult?.content), /^\[content:6 bytes sha256:/);
  fixture.store.close();
});

test("records a denied write without handing an effect to the repository", async () => {
  const fixture = workspace(repositoryToolCatalog);
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => "deny",
  });
  const result = await dispatcher.invoke("call-denied", "files/write", {
    path: "denied.txt",
    mode: "create",
    content: "must not exist",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "user-denied");
  assert.match(result.error?.message ?? "", /user denied/i);
  assert.match(result.error?.message ?? "", /Do not suggest changing repository permissions/);
  assert.equal(existsSync(join(fixture.repositoryRoot, "denied.txt")), false);
  const audit = fixture.store.listToolAudits(result.operationId!)[0]!;
  assert.equal(audit.decisionCode, "denied");
  assert.equal(audit.outcomeCode, "denied");
  assert.match(String((audit.sanitizedInput.arguments as Readonly<Record<string, unknown>>).content), /^\[content:/);
  fixture.store.close();
});

test("audits model-emitted unknown and over-budget calls as side-effect-free denials", () => {
  const fixture = workspace(repositoryToolCatalog);
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => "deny",
  });
  const unknown = dispatcher.reject("call-unknown", "hallucinated_tool", { password: "never-store" }, "tool-not-in-pinned-workbench-snapshot");
  const overBudget = dispatcher.reject("call-budget", chatModelToolName("files/write"), { path: "never.txt", content: "never" }, "tool-call-budget-exhausted");

  assert.equal(unknown.error?.code, "tool-not-in-pinned-workbench-snapshot");
  assert.equal(overBudget.error?.code, "tool-call-budget-exhausted");
  assert.equal(existsSync(join(fixture.repositoryRoot, "never.txt")), false);
  const unknownAudit = fixture.store.listToolAudits(unknown.operationId!)[0]!;
  const budgetAudit = fixture.store.listToolAudits(overBudget.operationId!)[0]!;
  assert.equal(unknownAudit.toolIdentity, "model/unknown-tool");
  assert.equal(unknownAudit.decisionCode, "denied");
  assert.equal((unknownAudit.sanitizedInput.arguments as Readonly<Record<string, unknown>>).password, "[redacted]");
  assert.equal(budgetAudit.toolIdentity, "files/write");
  assert.equal(budgetAudit.decisionCode, "denied");
  fixture.store.close();
});

test("keeps Chat read-only and interactive while a Task owns the Repository Write Lock", async () => {
  const fixture = workspace(repositoryToolCatalog);
  writeFileSync(join(fixture.repositoryRoot, "README.md"), "read while locked\n");
  assert.equal(fixture.store.acquireRepositoryWriteLock("task-42"), true);
  let approvals = 0;
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => { approvals += 1; return "once"; },
  });

  const read = await dispatcher.invoke("call-locked-read", "files/read", { path: "README.md" });
  const write = await dispatcher.invoke("call-locked-write", "files/write", { path: "blocked.txt", mode: "create", content: "blocked" });

  assert.equal(read.ok, true);
  assert.equal(write.ok, false);
  assert.equal(write.error?.code, "repository-write-lock-held");
  assert.equal(approvals, 0);
  assert.equal(existsSync(join(fixture.repositoryRoot, "blocked.txt")), false);
  assert.equal(fixture.store.repositoryWriteLockHolder(), "task-42");
  assert.equal(fixture.store.listToolAudits(write.operationId!)[0]?.decisionCode, "denied");
  fixture.store.releaseRepositoryWriteLock("task-42");
  fixture.store.close();
});

test("uses a one-shot grant, write lock, and durable outcome for an approved write", async () => {
  const fixture = workspace(repositoryToolCatalog);
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => "once",
  });
  const result = await dispatcher.invoke("call-approved", "files/write", {
    path: "approved.txt",
    mode: "create",
    content: "approved\n",
  });

  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(fixture.repositoryRoot, "approved.txt"), "utf8"), "approved\n");
  assert.equal(fixture.store.repositoryWriteLocked(), false);
  assert.equal(fixture.store.getDurableOperation(result.operationId!)?.state, "succeeded");
  assert.equal(fixture.store.listAuthorityGrants({ kind: "chat", id: fixture.chatId })[0]?.consumedAt !== null, true);
  fixture.store.close();
});

test("closes a proven-not-applied failure without replaying or retaining a workspace barrier", async () => {
  const fixture = workspace(repositoryToolCatalog);
  writeFileSync(join(fixture.repositoryRoot, "existing.txt"), "existing\n");
  const dispatcher = new ChatToolDispatcher({
    ...fixture.options,
    requestApproval: async () => "once",
  });
  const result = await dispatcher.invoke("call-not-applied", "files/write", {
    path: "existing.txt",
    mode: "create",
    content: "replacement that must not be written\n",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.recovery, "not-applied");
  assert.equal(readFileSync(join(fixture.repositoryRoot, "existing.txt"), "utf8"), "existing\n");
  assert.equal(fixture.store.getDurableOperation(result.operationId!)?.state, "cancelled");
  assert.equal(fixture.store.workspaceMutationBlocked(), false);
  assert.equal(
    fixture.store.listToolAuditCorrections(result.operationId!).some((correction) => correction.reasonCode === "not-applied-retry-abandoned"),
    true,
  );
  fixture.store.close();
});

test("classifies an interrupted write on restart and clears its stale write lock without replay", () => {
  const fixture = workspace(repositoryToolCatalog);
  const review = fixture.store.createAuthorityReview({
    owner: { kind: "chat", id: fixture.chatId },
    grantScope: "chat-once",
    effectClass: "repository-write",
    capabilities: ["tool:files/write"],
    resourceSnapshotId: fixture.snapshot.snapshotId,
    riskSummary: "Create recover.txt.",
  });
  const grant = fixture.store.resolveAuthorityReview(review.reviewId, "approved", authorityReviewConfirmationHash(review))!;
  const content = "already applied\n";
  const intendedSha256 = hash(content);
  const operation = fixture.store.recordToolIntent({
    operationKey: hash("restart-operation"),
    parentKind: "response-attempt",
    parentId: fixture.attemptId,
    effectClass: "repository-write",
    authorityGrantId: grant.grantId,
    authorityReviewId: review.reviewId,
    resourceSnapshotId: fixture.snapshot.snapshotId,
    targetFingerprint: hash("recover.txt"),
    toolIdentity: "files/write",
    decisionCode: "allowed",
    input: {
      callId: "call-restart",
      arguments: { path: "recover.txt", mode: "create", content: `[content:${Buffer.byteLength(content)} bytes sha256:${intendedSha256}]` },
      precondition: {},
      intendedSha256,
      policyReason: "explicit-grant",
    },
    affectedTargets: ["repo:recover.txt"],
  });
  assert.equal(fixture.store.acquireRepositoryWriteLock(operation.operationId), true);
  fixture.store.beginToolEffect(operation.operationId);
  writeFileSync(join(fixture.repositoryRoot, "recover.txt"), content);
  fixture.store.close();

  const recovered = new WorkspaceStore(fixture.storageRoot);
  assert.equal(recovered.repositoryWriteLocked(), false);
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "outcome-unknown");
  const outcomes = reconcileWorkspaceOperations(recovered, fixture.repositoryRoot);
  assert.deepEqual(outcomes, [{ operationId: operation.operationId, classification: "applied" }]);
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "succeeded");
  assert.equal(recovered.operationHasActiveBarrier(operation.operationId), false);
  assert.equal(readFileSync(join(fixture.repositoryRoot, "recover.txt"), "utf8"), content);
  recovered.close();
});

function workspace(tools: readonly ToolResource[]): {
  readonly repositoryRoot: string;
  readonly storageRoot: string;
  readonly store: WorkspaceStore;
  readonly chatId: string;
  readonly attemptId: string;
  readonly snapshot: ResourceSnapshot;
  readonly options: {
    readonly store: WorkspaceStore;
    readonly repositoryRoot: string;
    readonly chatId: string;
    readonly attemptId: string;
    readonly snapshot: ResourceSnapshot;
  };
} {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "bridgit-chat-tools-repo-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "bridgit-chat-tools-store-"));
  mkdirSync(join(repositoryRoot, ".git"));
  const store = new WorkspaceStore(storageRoot);
  const chat = store.createChat("reviewer", null);
  const turn = store.submitTurn(chat.chatId, "Use a Tool.");
  const attempt = store.createResponseAttempt(turn.turnId, null, undefined, "model-a");
  const agent: AgentResource = {
    identity: "reviewer",
    description: "Review repository files.",
    instructions: "Use the repository Tools when needed.",
    model: null,
    tools: null,
    status: "available",
  };
  const snapshot = pinSnapshot(
    { agents: [agent], skills: [], mcpServers: [], tools, diagnostics: [] },
    agent,
    {
      id: "model-a",
      name: "Model A",
      vendor: "test",
      family: "test",
      version: "1",
      maxInputTokens: 1000,
      selectionSource: "auto",
    },
    attempt.attemptId,
  );
  store.pinResourceSnapshot(attempt.attemptId, snapshot.snapshotId, JSON.stringify(snapshot), snapshot.createdAt);
  const options = {
    store,
    repositoryRoot,
    chatId: chat.chatId,
    attemptId: attempt.attemptId,
    snapshot,
  };
  return { repositoryRoot, storageRoot, store, chatId: chat.chatId, attemptId: attempt.attemptId, snapshot, options };
}

function extensionTool(identity: string): ToolResource {
  return {
    identity,
    description: "Extension Tool",
    origin: "extension",
    effectClass: "ambient",
    status: "available",
    inputSchema: {},
    inputSchemaFingerprint: hash("{}"),
    resultSchema: {},
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
