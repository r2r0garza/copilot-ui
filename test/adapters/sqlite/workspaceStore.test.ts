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

  assert.equal(store.getChat(chat.chatId)?.version, 2);
  assert.deepEqual(store.listTurns(chat.chatId), [turn]);
  assert.deepEqual(store.listEvents().map((event) => event.name), ["chat.session-created", "chat.turn-submitted"]);
  store.close();
});
