import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";

test("durably pairs a submitted turn with an immutable artifact and event", () => {
  const store = new WorkspaceStore(mkdtempSync(join(tmpdir(), "bridgit-store-")));
  const chat = store.createChat("bundled:orchestrator", "model-a", "2026-07-25T00:00:00.000Z");
  const turn = store.submitTurn(chat.chatId, "Hello, Bridgit.", "2026-07-25T00:00:01.000Z");
  const attempt = store.createResponseAttempt(turn.turnId, "model-a", "2026-07-25T00:00:02.000Z");
  const output = store.appendOutput(turn.turnId, "Hello from the model.", "2026-07-25T00:00:03.000Z");

  assert.equal(store.getChat(chat.chatId)?.version, 2);
  assert.deepEqual(store.listTurns(chat.chatId), [turn]);
  assert.equal(attempt.state, "preparing");
  assert.equal(store.listOutputs(chat.chatId)[0]?.content, output.content);
  assert.deepEqual(store.listEvents().map((event) => event.name), ["chat.session-created", "chat.turn-submitted", "response.preparation-started", "chat.output-appended"]);
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
