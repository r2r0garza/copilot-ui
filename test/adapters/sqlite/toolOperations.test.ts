import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";
import { authorityReviewConfirmationHash, type AuthorityGrant } from "../../../src/features/execution-authority";

test("records denials and intent before handoff without persisting secret-shaped input", () => {
  const fixture = workspace();
  const denied = fixture.store.recordToolIntent({
    operationKey: hash("denied"),
    parentKind: "response-attempt",
    parentId: fixture.attemptId,
    effectClass: "repository-write",
    authorityGrantId: null,
    authorityReviewId: null,
    resourceSnapshotId: fixture.snapshotId,
    targetFingerprint: hash("denied-target"),
    toolIdentity: "files/write",
    decisionCode: "denied",
    input: { path: "denied.txt", nested: { apiKey: "do-not-store" } },
    affectedTargets: ["repo:denied.txt"],
  }, "2026-07-27T00:00:10.000Z");

  assert.equal(denied.state, "failed");
  assert.equal(fixture.store.listOperationAttempts(denied.operationId).length, 0);
  const audit = fixture.store.listToolAudits(denied.operationId)[0]!;
  assert.equal(audit.decisionCode, "denied");
  assert.equal(audit.outcomeCode, "denied");
  assert.deepEqual(audit.sanitizedInput.nested, { apiKey: "[redacted]" });
  assert.throws(() => fixture.store.beginToolEffect(denied.operationId), /not-ready/);
  fixture.store.close();
});

test("recovers an interrupted mutation behind a barrier and appends reconciliation evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-operation-recovery-"));
  const fixture = workspace(directory);
  const operation = allowedOperation(fixture, "unknown");
  fixture.store.beginToolEffect(operation.operationId, "2026-07-27T00:00:11.000Z");
  fixture.store.close();

  const recovered = new WorkspaceStore(directory);
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "outcome-unknown");
  assert.equal(recovered.operationHasActiveBarrier(operation.operationId), true);
  assert.throws(() => recovered.beginToolEffect(operation.operationId), /not-ready/);
  recovered.startOperationReconciliation(operation.operationId, "2026-07-27T00:00:12.000Z");
  const evidence = recovered.recordReconciliation(operation.operationId, "inconclusive", { observation: "target-state-ambiguous", token: "never-store" }, "2026-07-27T00:00:13.000Z");
  assert.equal(evidence.classification, "inconclusive");
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "outcome-unknown");
  assert.equal(recovered.operationHasActiveBarrier(operation.operationId), true);
  assert.equal(recovered.listToolAuditCorrections(operation.operationId)[0]?.sanitizedDelta.token, "[redacted]");

  recovered.startOperationReconciliation(operation.operationId, "2026-07-27T00:00:14.000Z");
  recovered.recordReconciliation(operation.operationId, "not-applied", { observation: "precondition-still-present" }, "2026-07-27T00:00:15.000Z");
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "retry-wait");
  assert.equal(recovered.operationHasActiveBarrier(operation.operationId), true);
  recovered.beginToolEffect(operation.operationId, "2026-07-27T00:00:16.000Z");
  recovered.recordToolOutcome(operation.operationId, "applied", { status: "written", password: "never-store" }, ["repo:file.txt"], "2026-07-27T00:00:17.000Z");
  assert.equal(recovered.getDurableOperation(operation.operationId)?.state, "succeeded");
  assert.equal(recovered.operationHasActiveBarrier(operation.operationId), false);
  assert.equal(recovered.listOperationAttempts(operation.operationId).length, 2);
  const retryResult = recovered.listToolAuditCorrections(operation.operationId).at(-1)?.sanitizedDelta.sanitizedResult as Readonly<Record<string, unknown>>;
  assert.equal(retryResult.password, "[redacted]");

  const reconciledApplied = allowedOperation({ ...fixture, store: recovered }, "reconciled-applied");
  recovered.beginToolEffect(reconciledApplied.operationId, "2026-07-27T00:00:18.000Z");
  recovered.markToolOutcomeUnknown(reconciledApplied.operationId, "2026-07-27T00:00:19.000Z");
  recovered.startOperationReconciliation(reconciledApplied.operationId, "2026-07-27T00:00:20.000Z");
  recovered.recordReconciliation(reconciledApplied.operationId, "applied", { observation: "postcondition-present" }, "2026-07-27T00:00:21.000Z");
  assert.equal(recovered.getDurableOperation(reconciledApplied.operationId)?.state, "succeeded");
  assert.equal(recovered.operationHasActiveBarrier(reconciledApplied.operationId), false);
  recovered.close();
});

test("uses stable Operation Keys, accepts known outcomes, and rejects audit rewriting", () => {
  const fixture = workspace();
  const operation = allowedOperation(fixture, "stable");
  const same = allowedOperation(fixture, "stable");
  assert.equal(same.operationId, operation.operationId);
  assert.throws(() => fixture.store.recordToolIntent({
    ...allowedInput(fixture, "stable"),
    input: { path: "different.txt" },
  }), /operation-key-conflict/);
  assert.throws(() => fixture.store.recordToolIntent({
    ...allowedInput(fixture, "invalid-target"),
    affectedTargets: ["repo:../outside"],
  }), /affected-target-invalid/);

  fixture.store.beginToolEffect(operation.operationId);
  fixture.store.recordToolOutcome(operation.operationId, "applied", { status: "ok" }, ["repo:file.txt"]);
  assert.equal(fixture.store.getDurableOperation(operation.operationId)?.state, "succeeded");
  const auditId = fixture.store.listToolAudits(operation.operationId)[0]!.auditId;
  fixture.store.close();

  const database = new Database(join(fixture.directory, "bridgit.sqlite"));
  assert.throws(() => database.prepare("UPDATE tool_audit_records SET sanitized_input_json = '{}' WHERE audit_id = ?").run(auditId), /tool-audit-immutable/);
  assert.throws(() => database.prepare("DELETE FROM tool_audit_records WHERE audit_id = ?").run(auditId), /tool-audit-append-only/);
  database.close();
});

function workspace(directory = mkdtempSync(join(tmpdir(), "bridgit-operation-"))): {
  readonly directory: string;
  readonly store: WorkspaceStore;
  readonly attemptId: string;
  readonly snapshotId: string;
  readonly grant: AuthorityGrant;
} {
  const store = new WorkspaceStore(directory);
  const chat = store.createChat("reviewer", null);
  const turn = store.submitTurn(chat.chatId, "Use a repository Tool.");
  const attempt = store.createResponseAttempt(turn.turnId, null, "2026-07-27T00:00:00.000Z", "model-a");
  const snapshotId = hash(JSON.stringify({ attemptId: attempt.attemptId, model: "model-a" }));
  const content = JSON.stringify({ snapshotId, attemptId: attempt.attemptId, model: "model-a" });
  store.pinResourceSnapshot(attempt.attemptId, snapshotId, content, "2026-07-27T00:00:01.000Z");
  const review = store.createAuthorityReview({
    owner: { kind: "chat", id: chat.chatId },
    grantScope: "chat-session",
    effectClass: "repository-write",
    capabilities: ["tool:files/write"],
    resourceSnapshotId: null,
    riskSummary: "Allows the exact repository write Tool.",
  }, "2026-07-27T00:00:02.000Z");
  const grant = store.resolveAuthorityReview(review.reviewId, "approved", authorityReviewConfirmationHash(review), null, "2026-07-27T00:00:03.000Z")!;
  return { directory, store, attemptId: attempt.attemptId, snapshotId, grant };
}

function allowedOperation(fixture: ReturnType<typeof workspace>, identity: string) {
  return fixture.store.recordToolIntent(allowedInput(fixture, identity), "2026-07-27T00:00:10.000Z");
}

function allowedInput(fixture: ReturnType<typeof workspace>, identity: string) {
  return {
    operationKey: hash(`operation:${identity}`),
    parentKind: "response-attempt" as const,
    parentId: fixture.attemptId,
    effectClass: "repository-write" as const,
    authorityGrantId: fixture.grant.grantId,
    authorityReviewId: fixture.grant.reviewId,
    resourceSnapshotId: fixture.snapshotId,
    targetFingerprint: hash(`target:${identity}`),
    toolIdentity: "files/write",
    decisionCode: "allowed" as const,
    input: { path: "file.txt", contentFingerprint: hash("content") },
    affectedTargets: ["repo:file.txt"],
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
