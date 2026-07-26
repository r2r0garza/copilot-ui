import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";

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
  const attempt = store.createResponseAttempt(turn.turnId, "model-a", undefined, "model-a", "snapshot-1");
  store.transitionAttempt(attempt.attemptId, "running"); store.transitionAttempt(attempt.attemptId, "cancelled");
  const ledger = store.appendLedger(chat.chatId, "fact", "User prefers tests", "user-turn"); store.correctLedger(ledger.entryId, "User prefers focused tests", "user-correction");
  store.createSummary(chat.chatId, "Short history", "turns:1");
  store.recordToolAudit({ auditId: "audit-1", attemptId: attempt.attemptId, operationKey: "op-1", toolIdentity: "files/read", snapshotId: "snapshot-1", decision: "allowed", input: "{}", outcome: null, createdAt: "2026-07-25T00:00:00.000Z", completedAt: null });
  const snapshot = store.pinResourceSnapshot(attempt.attemptId, "{\"model\":\"model-a\"}"); assert.equal(snapshot.attemptId, attempt.attemptId);
  assert.equal(store.acquireRepositoryWriteLock(attempt.attemptId), true); assert.equal(store.repositoryWriteLocked(), true); assert.equal(store.releaseRepositoryWriteLock(attempt.attemptId), true);
  const fork = store.forkChat(chat.chatId, "bundled:orchestrator"); store.trashChat(chat.chatId); assert.equal(store.listChats().length, 1); assert.equal(store.listChats()[0]?.chatId, fork.chatId);
  store.restoreChat(chat.chatId); assert.equal(store.listChats().length, 2); store.close();
});

test("permanent deletion preserves surviving forks without their deleted-origin pointer", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-fork-delete-")));
  const source = store.createChat("bundled:orchestrator", null); const fork = store.forkChat(source.chatId, "bundled:orchestrator"); store.trashChat(source.chatId); store.deleteChatPermanently(source.chatId, true);
  assert.equal(store.getChat(source.chatId), undefined); assert.equal(store.getChat(fork.chatId)?.originChatId, null); store.close();
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
