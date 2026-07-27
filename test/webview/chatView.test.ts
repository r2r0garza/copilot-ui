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
