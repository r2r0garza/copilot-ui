import type { AgentResource, ResourceCatalogState } from "../resources";

export const bundledOrchestrator: AgentResource = {
  identity: "bundled:orchestrator",
  description: "Bridgit’s bundled repository orchestrator.",
  instructions: "Help the user work safely in the active repository.",
  model: null,
  tools: null,
  status: "available",
};

export function listChatAgents(resources: ResourceCatalogState): readonly AgentResource[] {
  return [bundledOrchestrator, ...resources.catalog.agents];
}

export function resolveAvailableChatAgent(
  resources: ResourceCatalogState,
  identity: string,
): AgentResource | undefined {
  return listChatAgents(resources).find((agent) => agent.identity === identity && agent.status === "available");
}
