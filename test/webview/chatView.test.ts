import assert from "node:assert/strict";
import test from "node:test";

import { bundledOrchestrator } from "../../src/features/chats";
import type { AgentResource } from "../../src/features/resources";
import { renderChatsView, type ChatViewState } from "../../src/webview/chatView";

const reviewer: AgentResource = {
  identity: "quality-reviewer",
  description: "Review changes for correctness.",
  instructions: "Review carefully.",
  model: null,
  tools: null,
  status: "available",
};

function state(overrides: Partial<ChatViewState> = {}): ChatViewState {
  return {
    chats: [],
    selectedChatId: undefined,
    showingTrash: false,
    messages: [],
    ledger: [],
    activeAgentIdentity: reviewer.identity,
    agents: [bundledOrchestrator, reviewer],
    catalogRevision: 2,
    workspaceName: "fixture",
    ...overrides,
  };
}

test("Chat view exposes the live Agent picker and catalog revision", () => {
  const html = renderChatsView(state());
  assert.match(html, /id="chat-agent-select"/);
  assert.match(html, /quality-reviewer" selected/);
  assert.match(html, /Catalog revision/);
  assert.match(html, />R2</);
  assert.match(html, /Changing Agent starts a new Chat/);
});

test("Chat view preserves a removed session Agent but disables sending", () => {
  const html = renderChatsView(state({ activeAgentIdentity: "removed-agent" }));
  assert.match(html, /removed-agent · unavailable/);
  assert.match(html, /Select an available Agent to continue in a new Chat/);
  assert.match(html, /id="chat-input"[^>]+disabled/);
  assert.match(html, /class="send composer-send"[^>]+disabled/);
});

test("Chat view escapes durable titles and message content", () => {
  const html = renderChatsView(state({
    chats: [{ chatId: "chat-1", label: "<script>alert(1)</script>", agentIdentity: reviewer.identity, trashed: false, forked: false }],
    selectedChatId: "chat-1",
    messages: [{ role: "user", content: "<img src=x>" }],
  }));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test("Chat view renders safe assistant Markdown without enabling model-authored HTML", () => {
  const html = renderChatsView(state({
    messages: [{
      role: "assistant",
      content: "The package is **test-name-frontend**.\n\n- one\n- `two`\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
    }],
  }));
  assert.match(html, /<strong>test-name-frontend<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>two<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("Chat view renders pasted user Markdown and code through the same safe boundary", () => {
  const html = renderChatsView(state({
    messages: [{
      role: "user",
      content: "Please review **this**:\n\n```ts\nconst answer = 42;\n```",
    }],
  }));
  assert.match(html, /<strong>this<\/strong>/);
  assert.match(html, /class="language-ts"/);
  assert.match(html, /const answer = 42;/);
});

test("Chat view exposes cancellation, immutable retry, and partial-output status", () => {
  const active = renderChatsView(state({
    chats: [{ chatId: "chat-1", label: "Active", agentIdentity: reviewer.identity, trashed: false, forked: false }],
    selectedChatId: "chat-1",
    activeAttemptId: "attempt-1",
  }));
  assert.match(active, /data-chat-action="cancel-attempt"/);
  assert.match(active, /id="chat-input"[^>]+disabled/);

  const cancelled = renderChatsView(state({
    chats: [{ chatId: "chat-1", label: "Cancelled", agentIdentity: reviewer.identity, trashed: false, forked: false }],
    selectedChatId: "chat-1",
    retryAttemptId: "attempt-1",
    messages: [{ role: "assistant", content: "Partial answer", attemptState: "cancelled" }],
  }));
  assert.match(cancelled, /data-chat-action="retry-attempt"/);
  assert.match(cancelled, /data-attempt-id="attempt-1"/);
  assert.match(cancelled, /class="attempt-state">cancelled</);
});

test("Chat view makes versioned summaries and correctable Ledger entries inspectable", () => {
  const html = renderChatsView(state({
    chats: [{ chatId: "chat-1", label: "Context", agentIdentity: reviewer.identity, trashed: false, forked: false }],
    selectedChatId: "chat-1",
    messages: [{ role: "user", content: "Keep this" }],
    summary: { content: "The user asked to keep context.", provenance: "explicit:model:test", version: 2 },
    ledger: [{
      entryId: "entry-1",
      kind: "decision",
      content: "Keep context",
      provenance: "explicit-user-entry",
      status: "active",
    }],
  }));
  assert.match(html, /Summary v2/);
  assert.match(html, /The user asked to keep context/);
  assert.match(html, /data-chat-action="generate-summary"/);
  assert.match(html, /data-chat-action="add-ledger-open"/);
  assert.match(html, /id="ledger-editor-slot"/);
  assert.match(html, /data-chat-action="correct-ledger-open"/);
  assert.match(html, /Keep context/);
});

test("Chat view identifies the Repository Write Lock owner while conversation remains available", () => {
  const html = renderChatsView(state({ repositoryWriteLockHolder: "task-42" }));
  assert.match(html, /Repository read-only/);
  assert.match(html, /Write lock held by task-42/);
  assert.doesNotMatch(html, /id="chat-input"[^>]+disabled/);
});

test("Chat view preserves deleted-origin provenance for a surviving fork", () => {
  const html = renderChatsView(state({
    chats: [{ chatId: "fork-1", label: "Independent fork", agentIdentity: reviewer.identity, trashed: false, forked: false, forkOriginDeleted: true }],
    selectedChatId: "fork-1",
  }));
  assert.match(html, /Origin deleted/);
  assert.doesNotMatch(html, /<span class="session-tag">Fork<\/span>/);
});
