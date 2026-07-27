import type { AgentResource, ResourceStatus } from "../features/resources";
import { renderAssistantMarkdown } from "./markdown";

export interface ChatViewState {
  readonly chats: readonly {
    readonly chatId: string;
    readonly label: string;
    readonly agentIdentity: string;
    readonly trashed: boolean;
    readonly forked: boolean;
  }[];
  readonly selectedChatId: string | undefined;
  readonly showingTrash: boolean;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly activeAgentIdentity: string;
  readonly agents: readonly AgentResource[];
  readonly catalogRevision: number;
  readonly workspaceName: string;
}

export function renderChatsView(state: ChatViewState): string {
  const activeAgent = agentForIdentity(state.agents, state.activeAgentIdentity);
  const canSend = !state.showingTrash && activeAgent.status === "available";

  return `<section id="chats" class="view chat-view" data-active="false">
    <div class="chat-masthead">
      <div>
        <p class="eyebrow">Durable conversations · ${escapeHtml(state.workspaceName)}</p>
        <h1>Chat Workbench</h1>
        <p class="lede">Choose a repository Agent, keep each conversation locally recoverable, and pin every response to the catalog revision it started with.</p>
      </div>
      <div class="chat-actions">
        <button data-chat-action="new" class="send new-chat-action" type="button"><span aria-hidden="true">＋</span> New chat</button>
        <button id="trash-toggle" data-chat-action="toggle-trash" class="quiet-action" type="button">${state.showingTrash ? "Back to chats" : "Trash"}</button>
      </div>
    </div>
    <div class="chat-context-strip">
      <label class="agent-picker">
        <span class="context-label">Talk to</span>
        <span class="agent-select-wrap">
          <span class="state-dot state-dot--${activeAgent.status}" aria-hidden="true"></span>
          <select id="chat-agent-select" aria-label="Agent for this Chat" ${state.showingTrash ? "disabled" : ""}>
            ${renderAgentOptions(state.agents, state.activeAgentIdentity)}
          </select>
        </span>
        <span id="agent-description" class="context-detail">${escapeHtml(activeAgent.reason ?? activeAgent.description)}</span>
      </label>
      <div class="context-cell">
        <span class="context-label">Catalog revision</span>
        <strong class="context-value">R${state.catalogRevision}</strong>
        <span class="context-detail">Live repository registry</span>
      </div>
      <div class="context-cell">
        <span class="context-label">Session contract</span>
        <strong class="context-value">${state.selectedChatId ? "Agent pinned" : "Ready"}</strong>
        <span class="context-detail">Changing Agent starts a new Chat</span>
      </div>
    </div>
    <div class="chat-shell">
      <aside class="session-panel" aria-label="${state.showingTrash ? "Trashed Chats" : "Chats"}">
        <header class="session-panel-header">
          <div><p class="eyebrow">${state.showingTrash ? "Recovery" : "Local sessions"}</p><h2>${state.showingTrash ? "Trash" : "Conversations"}</h2></div>
          <span class="resource-total">${state.chats.length}</span>
        </header>
        <div id="session-list" class="session-list">${renderSessions(state)}</div>
      </aside>
      <section class="conversation-panel">
        <header class="conversation-header">
          <div class="conversation-identity">
            <span class="agent-monogram" aria-hidden="true">${escapeHtml(monogram(activeAgent.identity))}</span>
            <div><span class="context-label">Active Agent</span><strong>${escapeHtml(activeAgent.identity)}</strong></div>
          </div>
          <div id="chat-toolbar" class="chat-toolbar">${renderToolbar(state)}</div>
        </header>
        <div id="transcript" class="transcript">${renderMessages(state.messages, activeAgent.identity)}</div>
        <p id="chat-error" class="chat-error" role="status">${canSend ? "" : escapeHtml(activeAgent.reason ?? "This Agent is not available for new responses.")}</p>
        <form id="chat-form" class="composer">
          <div class="composer-field">
            <textarea id="chat-input" aria-label="Chat message" aria-multiline="true" rows="1" placeholder="Message ${escapeHtml(activeAgent.identity)}…" ${canSend ? "" : "disabled"}></textarea>
            <span class="composer-hint"><strong>Enter</strong> to send · <strong>Shift Enter</strong> for a new line</span>
          </div>
          <button class="send composer-send" type="submit" ${canSend ? "" : "disabled"}>Send <span aria-hidden="true">↗</span></button>
        </form>
      </section>
    </div>
  </section>`;
}

function renderAgentOptions(agents: readonly AgentResource[], selectedIdentity: string): string {
  const known = agents.some((agent) => agent.identity === selectedIdentity);
  const legacy = known ? "" : `<option value="${escapeHtml(selectedIdentity)}" selected disabled>${escapeHtml(selectedIdentity)} · unavailable</option>`;
  return legacy + agents.map((agent) => {
    const suffix = agent.status === "available" ? "" : ` · ${agent.status}`;
    return `<option value="${escapeHtml(agent.identity)}" ${agent.identity === selectedIdentity ? "selected" : ""} ${agent.status === "available" ? "" : "disabled"}>${escapeHtml(agent.identity + suffix)}</option>`;
  }).join("");
}

function renderSessions(state: ChatViewState): string {
  return state.chats.map((chat) => `<button class="session-item" data-chat-action="select" data-chat-id="${escapeHtml(chat.chatId)}" aria-current="${String(chat.chatId === state.selectedChatId)}">
    <span class="session-copy"><strong>${escapeHtml(chat.label)}</strong><small>${escapeHtml(chat.agentIdentity)}</small></span>
    ${chat.forked ? "<span class=\"session-tag\">Fork</span>" : ""}
  </button>`).join("") || `<div class="session-empty"><span aria-hidden="true">◎</span><p>${state.showingTrash ? "Trash is empty." : "No conversations yet."}</p></div>`;
}

function renderToolbar(state: ChatViewState): string {
  if (!state.selectedChatId) return "<span class=\"muted\">A new session will be created on send.</span>";
  return state.showingTrash
    ? `<button data-chat-action="restore" class="quiet-action" type="button">Restore</button><button data-chat-action="delete" class="danger-action" type="button">Delete permanently</button>`
    : `<button data-chat-action="rename" class="quiet-action" type="button">Rename</button><button data-chat-action="fork" class="quiet-action" type="button">Fork</button><button data-chat-action="trash" class="quiet-action" type="button">Move to Trash</button>`;
}

function renderMessages(messages: ChatViewState["messages"], agentIdentity: string): string {
  return messages.map((item) => `<article class="message markdown ${item.role}">
    <header><span>${item.role === "user" ? "YOU" : escapeHtml(agentIdentity)}</span></header>
    <div>${renderAssistantMarkdown(item.content)}</div>
  </article>`).join("") || `<div class="transcript-empty">
    <span class="empty-glyph" aria-hidden="true">⌁</span>
    <h2>Open a line to ${escapeHtml(agentIdentity)}</h2>
    <p>The Agent’s repository instructions and this catalog revision will be pinned when the response begins.</p>
  </div>`;
}

function agentForIdentity(agents: readonly AgentResource[], identity: string): AgentResource {
  return agents.find((agent) => agent.identity === identity) ?? {
    identity,
    description: "This Agent is no longer present in the active Resource Catalog.",
    instructions: "",
    model: null,
    tools: null,
    status: "unavailable" as ResourceStatus,
    reason: "Select an available Agent to continue in a new Chat.",
  };
}

function monogram(identity: string): string {
  return identity.split(/[:_-]/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}
