import type { Diagnostic, ResourceCatalogState, ResourceStatus } from "../features/resources";

export function renderResourceCatalog(state: ResourceCatalogState): string {
  const { catalog } = state;
  const resources = [...catalog.agents, ...catalog.skills, ...catalog.mcpServers];
  const counts = {
    available: resources.filter((item) => item.status === "available").length,
    unavailable: resources.filter((item) => item.status === "unavailable").length,
    invalid: resources.filter((item) => item.status === "invalid").length,
  };

  return `<section id="agents" class="view resource-view" data-active="false">
    <div class="resource-masthead">
      <div>
        <p class="eyebrow">Fixed-source registry · revision ${state.revision}</p>
        <h1>Resource Catalog</h1>
        <p class="lede">Validated Agents, Skills, and MCP servers for <strong>${escapeHtml(state.workspaceName)}</strong>. Active attempts retain the revision they started with.</p>
      </div>
      <button id="resource-refresh" class="quiet-action refresh-action" type="button"><span aria-hidden="true">↻</span> Refresh</button>
    </div>
    ${state.workspaceRoot === null ? noWorkspace() : `
      <div class="catalog-strip" aria-label="Resource status summary">
        ${countCell("Available", counts.available, "available")}
        ${countCell("Unavailable", counts.unavailable, "unavailable")}
        ${countCell("Invalid", counts.invalid, "invalid")}
        <div class="catalog-revision"><span>Catalog fingerprint</span><code>${state.fingerprint.slice(0, 12)}</code></div>
      </div>
      <div class="resource-grid">
        ${resourceGroup("Agents", "Repository definitions", catalog.agents.map((agent) => resourceRow(
          agent.identity,
          agent.status,
          agent.description,
          agent.reason,
          agent.model === null ? "Auto model" : Array.isArray(agent.model) ? `${agent.model.length} model choices` : String(agent.model),
        )))}
        ${resourceGroup("Skills", "Progressive instructions", catalog.skills.map((skill) => resourceRow(
          skill.name,
          skill.status,
          skill.description,
          skill.reason,
          skill.userInvocable ? "User invocable" : "Model only",
        )))}
        ${resourceGroup("MCP", "Isolated server configurations", catalog.mcpServers.map((server) => resourceRow(
          server.name,
          server.status,
          server.reason ?? `${server.transport?.toUpperCase() ?? "Unknown"} transport`,
          server.reason,
          server.requiresOAuth ? "OAuth" : server.inputIds.length ? `${server.inputIds.length} inputs` : "No inputs",
        )))}
      </div>
      ${diagnostics(catalog.diagnostics)}
    `}
  </section>`;
}

function countCell(label: string, count: number, status: ResourceStatus): string {
  return `<div class="catalog-count"><span class="state-dot state-dot--${status}" aria-hidden="true"></span><strong>${count}</strong><span>${label}</span></div>`;
}

function resourceGroup(title: string, subtitle: string, rows: readonly string[]): string {
  return `<article class="resource-group">
    <header><div><h2>${title}</h2><p>${subtitle}</p></div><span class="resource-total">${rows.length}</span></header>
    <div class="resource-list">${rows.join("") || `<p class="resource-empty">No ${title.toLowerCase()} discovered at the canonical location.</p>`}</div>
  </article>`;
}

function resourceRow(name: string, status: ResourceStatus, description: string, reason: string | undefined, meta: string): string {
  return `<div class="resource-row">
    <span class="state-dot state-dot--${status}" aria-label="${status}"></span>
    <div class="resource-copy"><div class="resource-name"><strong>${escapeHtml(name)}</strong><code>${escapeHtml(meta)}</code></div><p>${escapeHtml(reason ?? description)}</p></div>
    <span class="resource-status resource-status--${status}">${status}</span>
  </div>`;
}

function diagnostics(items: readonly Diagnostic[]): string {
  return `<section class="diagnostic-ledger">
    <header><div><p class="eyebrow">Validation ledger</p><h2>Diagnostics</h2></div><span class="resource-total">${items.length}</span></header>
    <div class="diagnostic-list">${items.map((item) => `<div class="diagnostic diagnostic--${item.severity}">
      <span class="diagnostic-severity">${item.severity}</span>
      <code>${escapeHtml(item.code)}</code>
      <strong>${escapeHtml(item.resource)}</strong>
      <p>${escapeHtml(item.message)}</p>
    </div>`).join("") || `<p class="resource-empty">No validation diagnostics. Canonical resources are clean.</p>`}</div>
  </section>`;
}

function noWorkspace(): string {
  return `<div class="empty-state"><h2>Open a repository workspace.</h2><p>Bridgit discovers resources only from the active workspace’s fixed repository locations.</p></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}
