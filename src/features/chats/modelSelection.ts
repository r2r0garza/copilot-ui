export interface ModelSelection {
  readonly effectiveModelId: string;
  readonly source: "requested" | "agent" | "auto";
}

export function selectModel(
  requestedModelId: string | null | undefined,
  agentModelId: string | null | undefined,
  autoModelId: string,
): ModelSelection {
  if (requestedModelId) return { effectiveModelId: requestedModelId, source: "requested" };
  if (agentModelId) return { effectiveModelId: agentModelId, source: "agent" };
  return { effectiveModelId: autoModelId, source: "auto" };
}

/**
 * Resolves only against the models enumerated for this user action. Explicit
 * Chat and Agent preferences fail closed instead of silently falling back.
 */
export function selectAvailableModel(
  requestedModelId: string | null | undefined,
  agentModel: string | readonly string[] | null | undefined,
  availableModelIds: readonly string[],
): ModelSelection {
  if (requestedModelId) {
    if (!availableModelIds.includes(requestedModelId)) throw new Error("requested-model-unavailable");
    return { effectiveModelId: requestedModelId, source: "requested" };
  }

  const preferences = typeof agentModel === "string" ? [agentModel] : agentModel ?? [];
  if (preferences.length > 0) {
    const effectiveModelId = preferences.find((modelId) => availableModelIds.includes(modelId));
    if (!effectiveModelId) throw new Error("agent-model-unavailable");
    return { effectiveModelId, source: "agent" };
  }

  const [autoModelId] = availableModelIds;
  if (!autoModelId) throw new Error("no-model-available");
  return { effectiveModelId: autoModelId, source: "auto" };
}
