import assert from "node:assert/strict";
import test from "node:test";

import { bundledOrchestrator, listChatAgents, resolveAvailableChatAgent } from "../../../src/features/chats";
import type { ResourceCatalogState } from "../../../src/features/resources";

const resources: ResourceCatalogState = {
  workspaceRoot: "/repo",
  workspaceName: "repo",
  revision: 4,
  refreshedAt: "2026-07-26T00:00:00.000Z",
  fingerprint: "catalog",
  catalog: {
    agents: [
      { identity: "reviewer", description: "Review changes.", instructions: "Review.", model: null, tools: null, status: "available" },
      { identity: "offline", description: "Unavailable.", instructions: "", model: null, tools: null, status: "unavailable", reason: "Hook missing." },
    ],
    skills: [],
    mcpServers: [],
    tools: [],
    diagnostics: [],
  },
};

test("chat Agent selection includes the bundled fallback and resolves only available Agents", () => {
  assert.deepEqual(listChatAgents(resources).map((agent) => agent.identity), ["bundled:orchestrator", "reviewer", "offline"]);
  assert.equal(resolveAvailableChatAgent(resources, "reviewer")?.instructions, "Review.");
  assert.equal(resolveAvailableChatAgent(resources, "offline"), undefined);
  assert.equal(resolveAvailableChatAgent(resources, bundledOrchestrator.identity), bundledOrchestrator);
});
