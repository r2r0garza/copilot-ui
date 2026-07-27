import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";
import { authorityReviewConfirmationHash, grantIsActive } from "../../../src/features/execution-authority";

test("durably pairs a submitted turn with an immutable artifact and event", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-store-")));
  const chat = store.createChat("bundled:orchestrator", "model-a", "2026-07-25T00:00:00.000Z");
  assert.equal(chat.title, "New chat"); store.setChatTitle(chat.chatId, "Plan durable chat recovery");
  const turn = store.submitTurn(chat.chatId, "Hello, Bridgit.", "2026-07-25T00:00:01.000Z");
  const attempt = store.createResponseAttempt(turn.turnId, "model-a", "2026-07-25T00:00:02.000Z");
  const output = store.appendOutput(turn.turnId, "Hello from the model.", "2026-07-25T00:00:03.000Z");

  assert.equal(store.getChat(chat.chatId)?.version, 2); assert.equal(store.getChat(chat.chatId)?.title, "Plan durable chat recovery");
  assert.deepEqual(store.listTurns(chat.chatId), [turn]);
  assert.equal(attempt.state, "preparing");
  assert.equal(store.listOutputs(chat.chatId)[0]?.content, output.content);
  assert.deepEqual(store.listEvents().map((event) => event.name), ["chat.session-created", "chat.title-set", "chat.turn-submitted", "response.preparation-started", "chat.output-appended"]);
  store.close();
});

test("reconstructs the authoritative Chat after reopening workspace storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-reload-"));
  const writer = new WorkspaceStore(directory);
  const chat = writer.createChat("bundled:orchestrator", null, "2026-07-25T00:00:00.000Z");
  writer.submitTurn(chat.chatId, "Recover me.", "2026-07-25T00:00:01.000Z");
  writer.close();
  const reader = new WorkspaceStore(directory);
  assert.equal(reader.listChats()[0]?.chatId, chat.chatId);
  assert.equal(reader.listTurns(chat.chatId)[0]?.content, "Recover me.");
  assert.deepEqual(reader.listEvents().map((event) => event.name), ["chat.session-created", "chat.turn-submitted"]);
  reader.close();
});

test("restores an interrupted streamed response and replaces it with its immutable final output", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-stream-"));
  const writer = new WorkspaceStore(directory);
  const chat = writer.createChat("bundled:orchestrator", null, "2026-07-25T00:00:00.000Z");
  const turn = writer.submitTurn(chat.chatId, "Keep this response.", "2026-07-25T00:00:01.000Z");
  writer.checkpointOutput(turn.turnId, "Partial response", "2026-07-25T00:00:02.000Z");
  writer.close();

  const reader = new WorkspaceStore(directory);
  assert.equal(reader.listOutputs(chat.chatId)[0]?.content, "Partial response");
  reader.appendOutput(turn.turnId, "Complete response", "2026-07-25T00:00:03.000Z");
  assert.deepEqual(reader.listOutputs(chat.chatId).map((output) => output.content), ["Complete response"]);
  reader.close();
});

test("keeps lifecycle, forks, trash, summaries, ledger, and audits append-only", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-m2-")));
  const chat = store.createChat("bundled:orchestrator", null); const turn = store.submitTurn(chat.chatId, "Use a tool");
  const attempt = store.createResponseAttempt(turn.turnId, "model-a", undefined, "model-a");
  const fixture = snapshotFixture({ attemptId: attempt.attemptId, model: "model-a" });
  const snapshotId = fixture.snapshotId;
  const snapshot = store.pinResourceSnapshot(attempt.attemptId, snapshotId, fixture.content);
  assert.equal(snapshot.attemptId, attempt.attemptId);
  assert.equal(store.getResponseAttempt(attempt.attemptId)?.snapshotId, snapshotId);
  store.transitionAttempt(attempt.attemptId, "running"); store.transitionAttempt(attempt.attemptId, "cancelled");
  const ledger = store.appendLedger(chat.chatId, "fact", "User prefers tests", "user-turn"); store.correctLedger(ledger.entryId, "User prefers focused tests", "user-correction");
  store.createSummary(chat.chatId, "Short history", "turns:1");
  assert.equal(store.getActiveSummary(chat.chatId)?.content, "Short history");
  assert.deepEqual(store.listLedger(chat.chatId).map(({ content, status }) => ({ content, status })), [
    { content: "User prefers tests", status: "superseded" },
    { content: "User prefers focused tests", status: "active" },
  ]);
  const denied = store.recordToolIntent({
    operationKey: "d".repeat(64), parentKind: "response-attempt", parentId: attempt.attemptId, effectClass: "repository-write",
    authorityGrantId: null, authorityReviewId: null, resourceSnapshotId: snapshotId, targetFingerprint: "e".repeat(64),
    toolIdentity: "files/write", decisionCode: "denied", input: { token: "never-store" }, affectedTargets: ["repo:denied.txt"],
  });
  assert.equal(store.listToolAudits(denied.operationId)[0]?.sanitizedInput.token, "[redacted]");
  assert.equal(store.acquireRepositoryWriteLock(attempt.attemptId), true); assert.equal(store.repositoryWriteLocked(), true); assert.equal(store.releaseRepositoryWriteLock(attempt.attemptId), true);
  const fork = store.forkChat(chat.chatId, "bundled:orchestrator"); store.trashChat(chat.chatId); assert.equal(store.listChats().length, 1); assert.equal(store.listChats()[0]?.chatId, fork.chatId);
  store.restoreChat(chat.chatId); assert.equal(store.listChats().length, 2); store.close();
});

test("enforces the exact Response Attempt transition matrix and immutable terminal retry", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-attempt-transitions-")));
  const chat = store.createChat("bundled:orchestrator", null);
  const turn = store.submitTurn(chat.chatId, "Retry this durable turn");
  const first = store.createResponseAttempt(turn.turnId, null);
  assert.throws(() => store.transitionAttempt(first.attemptId, "succeeded"), /invalid-attempt-transition/);
  store.transitionAttempt(first.attemptId, "running");
  store.transitionAttempt(first.attemptId, "waiting-for-approval");
  store.transitionAttempt(first.attemptId, "running");
  store.checkpointOutput(turn.turnId, "unfinished");
  store.transitionAttempt(first.attemptId, "cancelled");
  assert.throws(() => store.transitionAttempt(first.attemptId, "running"), /invalid-attempt-transition/);

  const retry = store.createResponseAttempt(turn.turnId, null);
  assert.equal(retry.ordinal, 2);
  assert.notEqual(retry.attemptId, first.attemptId);
  assert.equal(store.listOutputs(chat.chatId)[0]?.content, "unfinished");
  assert.deepEqual(store.listEvents().filter((event) => event.aggregateId === first.attemptId).map((event) => event.name), [
    "response.started",
    "response.approval-requested",
    "response.approval-resolved",
    "response.cancelled",
  ]);
  store.close();
});

test("forks established transcript and session context without coupling deletion", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-fork-context-")));
  const source = store.createChat("bundled:orchestrator", null);
  const turn = store.submitTurn(source.chatId, "Keep this history");
  store.appendOutput(turn.turnId, "History kept");
  store.createSummary(source.chatId, "A compact history", `through-turn:${turn.turnId}`);
  store.appendLedger(source.chatId, "decision", "Keep tests focused", `turn:${turn.turnId}`);

  const fork = store.forkChat(source.chatId, source.agentIdentity);
  assert.deepEqual(store.listTurns(fork.chatId).map((item) => item.content), ["Keep this history"]);
  assert.deepEqual(store.listFinalOutputs(fork.chatId).map((item) => item.content), ["History kept"]);
  assert.equal(store.getActiveSummary(fork.chatId)?.content, "A compact history");
  assert.equal(store.listLedger(fork.chatId)[0]?.content, "Keep tests focused");

  store.trashChat(source.chatId);
  store.deleteChatPermanently(source.chatId, true);
  assert.equal(store.getChat(fork.chatId)?.originChatId, null);
  assert.equal(store.getChat(fork.chatId)?.forkOriginDeleted, true);
  assert.deepEqual(store.listTurns(fork.chatId).map((item) => item.content), ["Keep this history"]);
  store.close();
});

test("pins one exact immutable Resource Snapshot identity per preparing attempt", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-snapshot-")));
  const chat = store.createChat("reviewer", null);
  const turn = store.submitTurn(chat.chatId, "Review this.");
  const attempt = store.createResponseAttempt(turn.turnId, null, "2026-07-27T00:00:00.000Z", "model-a");
  const { snapshotId, content } = snapshotFixture({ attemptId: attempt.attemptId, catalogRevision: 3, effectiveModelId: "model-a" });

  const pinned = store.pinResourceSnapshot(attempt.attemptId, snapshotId, content, "2026-07-27T00:00:01.000Z");
  assert.equal(pinned.snapshotId, snapshotId);
  assert.deepEqual(store.getResourceSnapshot(attempt.attemptId), pinned);
  assert.equal(store.getResponseAttempt(attempt.attemptId)?.effectiveModelId, "model-a");
  assert.equal(store.getResponseAttempt(attempt.attemptId)?.snapshotId, snapshotId);
  assert.throws(() => store.pinResourceSnapshot(attempt.attemptId, snapshotId, content), /already-pinned/);
  assert.throws(() => store.pinResourceSnapshot(attempt.attemptId, "c".repeat(64), content), /identity-mismatch/);
  assert.throws(() => store.pinResourceSnapshot("different-attempt", snapshotId, content), /attempt-mismatch/);
  const tampered = JSON.stringify({ ...JSON.parse(content), effectiveModelId: "model-b" });
  assert.throws(() => store.pinResourceSnapshot(attempt.attemptId, snapshotId, tampered), /checksum-mismatch/);
  store.close();
});

test("binds MCP Server Trust to the exact durable configuration fingerprint", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-mcp-trust-"));
  const firstFingerprint = "a".repeat(64);
  const changedFingerprint = "b".repeat(64);
  const writer = new WorkspaceStore(directory);
  const trusted = writer.resolveMcpTrust("server", firstFingerprint, "trusted", "2026-07-26T00:00:00.000Z");
  assert.equal(trusted.version, 1);
  assert.equal(writer.getMcpTrust("server", changedFingerprint), undefined);
  writer.resolveMcpTrust("server", changedFingerprint, "denied", "2026-07-26T00:01:00.000Z");
  assert.equal(writer.getMcpTrust("server", firstFingerprint), undefined);
  writer.close();

  const reader = new WorkspaceStore(directory);
  assert.equal(reader.getMcpTrust("server", changedFingerprint)?.decision, "denied");
  const revised = reader.resolveMcpTrust("server", changedFingerprint, "trusted", "2026-07-26T00:02:00.000Z");
  assert.equal(revised.version, 2);
  assert.equal(reader.listEvents().filter((event) => event.name === "mcp.server-trust-resolved").length, 3);
  reader.close();
});

test("persists separate fingerprint-bound Chat and Task authority grants", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-authority-"));
  const store = new WorkspaceStore(directory);
  const chat = store.createChat("reviewer", null);
  const snapshotId = "a".repeat(64);
  const chatReview = store.createAuthorityReview({
    owner: { kind: "chat", id: chat.chatId },
    grantScope: "chat-once",
    effectClass: "repository-write",
    capabilities: ["tool:git/commit", "local-commit", "tool:git/commit"],
    resourceSnapshotId: snapshotId,
    riskSummary: "Creates one local commit without hooks or remote effects.",
  }, "2026-07-27T00:00:00.000Z");
  assert.deepEqual(chatReview.requestedScope.capabilities, ["local-commit", "tool:git/commit"]);
  assert.throws(() => store.resolveAuthorityReview(chatReview.reviewId, "approved", "wrong"), /confirmation-mismatch/);
  const chatGrant = store.resolveAuthorityReview(chatReview.reviewId, "approved", authorityReviewConfirmationHash(chatReview), null, "2026-07-27T00:00:01.000Z");
  assert.ok(chatGrant);
  assert.equal(grantIsActive(chatGrant, { owner: chatReview.owner, resourceSnapshotId: snapshotId }), true);

  const taskReview = store.createAuthorityReview({
    owner: { kind: "task", id: "task-1" },
    grantScope: "task",
    effectClass: "ambient",
    capabilities: ["tool:extension/search", "ambient:extension/search", `extension-tool:extension/search@${"b".repeat(64)}`],
    resourceSnapshotId: null,
    riskSummary: "Allows one exact external capability for the admitted Task.",
    taskPhase: "admission",
  }, "2026-07-27T00:00:02.000Z");
  const taskGrant = store.resolveAuthorityReview(taskReview.reviewId, "approved", authorityReviewConfirmationHash(taskReview), null, "2026-07-27T00:00:03.000Z");
  assert.ok(taskGrant);
  assert.equal(store.listAuthorityGrants(chatReview.owner).length, 1);
  assert.equal(store.listAuthorityGrants(taskReview.owner).length, 1);
  assert.equal(grantIsActive(taskGrant, { owner: chatReview.owner, resourceSnapshotId: null }), false);
  assert.throws(() => store.createAuthorityReview({ ...taskReview, capabilities: taskReview.requestedScope.capabilities, taskPhase: "execution" }), /fixed-at-admission/);

  store.consumeAuthorityGrant(chatGrant.grantId, "2026-07-27T00:00:04.000Z");
  assert.equal(store.listAuthorityGrants(chatReview.owner)[0]?.consumedAt, "2026-07-27T00:00:04.000Z");
  assert.throws(() => store.consumeAuthorityGrant(chatGrant.grantId), /not-consumable/);
  store.revokeAuthorityGrant(taskGrant.grantId, "2026-07-27T00:00:05.000Z");
  store.close();

  const reopened = new WorkspaceStore(directory);
  assert.equal(reopened.listAuthorityGrants(chatReview.owner)[0]?.consumedAt, "2026-07-27T00:00:04.000Z");
  assert.equal(reopened.listAuthorityGrants(taskReview.owner)[0]?.revokedAt, "2026-07-27T00:00:05.000Z");
  reopened.close();
});

test("permanent deletion preserves surviving forks without their deleted-origin pointer", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-fork-delete-"));
  const store = new WorkspaceStore(directory);
  const source = store.createChat("bundled:orchestrator", null); const fork = store.forkChat(source.chatId, "bundled:orchestrator"); store.trashChat(source.chatId); store.deleteChatPermanently(source.chatId, true);
  assert.equal(store.getChat(source.chatId), undefined); assert.equal(store.getChat(fork.chatId)?.originChatId, null); assert.equal(store.getChat(fork.chatId)?.forkOriginDeleted, true); store.close();

  const legacy = new Database(join(directory, "bridgit.sqlite"));
  legacy.prepare("UPDATE chat_sessions SET fork_origin_deleted = 0 WHERE chat_id = ?").run(fork.chatId);
  legacy.close();
  const migrated = new WorkspaceStore(directory);
  assert.equal(migrated.getChat(fork.chatId)?.forkOriginDeleted, true);
  migrated.close();
});

test("permanent deletion removes the named Chat's Tool records and restores append-only audit guards", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-tool-delete-"));
  const store = new WorkspaceStore(directory);
  const first = store.createChat("bundled:orchestrator", null);
  const firstTurn = store.submitTurn(first.chatId, "Use a denied Tool");
  const firstAttempt = store.createResponseAttempt(firstTurn.turnId, null);
  const firstSnapshot = snapshotFixture({ attemptId: firstAttempt.attemptId });
  store.pinResourceSnapshot(firstAttempt.attemptId, firstSnapshot.snapshotId, firstSnapshot.content);
  const firstOperation = store.recordToolIntent({
    operationKey: "1".repeat(64), parentKind: "response-attempt", parentId: firstAttempt.attemptId, effectClass: "repository-write",
    authorityGrantId: null, authorityReviewId: null, resourceSnapshotId: firstSnapshot.snapshotId, targetFingerprint: "2".repeat(64),
    toolIdentity: "files/write", decisionCode: "denied", input: { path: "private.txt" }, affectedTargets: ["repo:private.txt"],
  });
  store.transitionAttempt(firstAttempt.attemptId, "blocked");
  store.trashChat(first.chatId);
  assert.doesNotThrow(() => store.deleteChatPermanently(first.chatId, true));
  assert.equal(store.getChat(first.chatId), undefined);
  assert.equal(store.getDurableOperation(firstOperation.operationId), undefined);

  const second = store.createChat("bundled:orchestrator", null);
  const secondTurn = store.submitTurn(second.chatId, "Keep this audit");
  const secondAttempt = store.createResponseAttempt(secondTurn.turnId, null);
  const secondSnapshot = snapshotFixture({ attemptId: secondAttempt.attemptId });
  store.pinResourceSnapshot(secondAttempt.attemptId, secondSnapshot.snapshotId, secondSnapshot.content);
  const secondOperation = store.recordToolIntent({
    operationKey: "3".repeat(64), parentKind: "response-attempt", parentId: secondAttempt.attemptId, effectClass: "read",
    authorityGrantId: null, authorityReviewId: null, resourceSnapshotId: secondSnapshot.snapshotId, targetFingerprint: "4".repeat(64),
    toolIdentity: "files/read", decisionCode: "denied", input: { path: "README.md" }, affectedTargets: ["repo:README.md"],
  });
  const database = new Database(join(directory, "bridgit.sqlite"));
  assert.throws(() => database.prepare("DELETE FROM tool_audit_records WHERE operation_id = ?").run(secondOperation.operationId), /tool-audit-append-only/);
  database.close();
  store.close();
});

test("permanent deletion supports legacy databases whose Chat foreign keys do not cascade", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-legacy-delete-")); const database = new Database(join(directory, "bridgit.sqlite"));
  database.exec("PRAGMA foreign_keys = ON; CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY, media_type TEXT NOT NULL, byte_count INTEGER NOT NULL, checksum TEXT NOT NULL, display_label TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE chat_sessions (chat_id TEXT PRIMARY KEY, version INTEGER NOT NULL, agent_identity TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, origin_chat_id TEXT, trashed_at TEXT); CREATE TABLE chat_turns (turn_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id), ordinal INTEGER NOT NULL, content_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), submitted_at TEXT NOT NULL, UNIQUE(chat_id, ordinal)); CREATE TABLE response_attempts (attempt_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id), ordinal INTEGER NOT NULL, state TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, effective_model_id TEXT, snapshot_id TEXT, ended_at TEXT, UNIQUE(turn_id, ordinal)); CREATE TABLE chat_outputs (output_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id), artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), created_at TEXT NOT NULL); INSERT INTO artifacts VALUES ('user-artifact','text/plain',4,'hash','Turn','test'), ('output-artifact','text/plain',4,'hash','Output','done'); INSERT INTO chat_sessions VALUES ('legacy-chat',1,'bundled:orchestrator',NULL,'2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',NULL,'2026-07-25T00:01:00.000Z'); INSERT INTO chat_turns VALUES ('legacy-turn','legacy-chat',1,'user-artifact','2026-07-25T00:00:01.000Z'); INSERT INTO response_attempts VALUES ('legacy-attempt','legacy-turn',1,'succeeded',NULL,'2026-07-25T00:00:02.000Z',NULL,NULL,'2026-07-25T00:00:03.000Z'); INSERT INTO chat_outputs VALUES ('legacy-output','legacy-turn','output-artifact','2026-07-25T00:00:03.000Z');");
  database.close(); const store = new WorkspaceStore(directory); assert.doesNotThrow(() => store.deleteChatPermanently("legacy-chat", true)); assert.equal(store.getChat("legacy-chat"), undefined); store.close();
});

test("turns an abandoned active attempt into an interrupted, retryable record on host restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-restart-"));
  const writer = new WorkspaceStore(directory); const chat = writer.createChat("bundled:orchestrator", null); const turn = writer.submitTurn(chat.chatId, "Continue"); const attempt = writer.createResponseAttempt(turn.turnId, "model-a"); writer.transitionAttempt(attempt.attemptId, "running"); writer.close();
  const reader = new WorkspaceStore(directory); assert.doesNotThrow(() => reader.createResponseAttempt(turn.turnId, "model-a")); reader.close();
});

function snapshotFixture(payload: Readonly<Record<string, unknown>>): { readonly snapshotId: string; readonly content: string } {
  const snapshotId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { snapshotId, content: JSON.stringify({ snapshotId, ...payload }) };
}
