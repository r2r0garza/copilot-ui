import assert from "node:assert/strict";
import test from "node:test";

import type { ResourceCatalogState } from "../../src/features/resources";
import { renderResourceCatalog } from "../../src/webview/resourceView";

test("renders catalog status, actionable diagnostics, and escaped repository metadata", () => {
  const state: ResourceCatalogState = {
    workspaceRoot: "/workspace",
    workspaceName: "<unsafe>",
    revision: 7,
    refreshedAt: "2026-07-26T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    catalog: {
      agents: [{ identity: "reviewer", description: "Review code", instructions: "Private instructions", model: null, tools: null, status: "available" }],
      skills: [{ name: "forked", description: "Fork work", userInvocable: true, disableModelInvocation: false, status: "unavailable", reason: "Fork context is unavailable." }],
      mcpServers: [{ name: "broken", fingerprint: "b".repeat(64), status: "invalid", reason: "Missing command.", transport: null, inputIds: [], requiresOAuth: false }],
      tools: [{ identity: "files/read", description: "Read a file.", origin: "workbench", effectClass: "read", status: "available", inputSchema: {}, inputSchemaFingerprint: "c".repeat(64), resultSchema: {} }],
      diagnostics: [{ resource: "mcp:broken", code: "mcp.server-invalid", severity: "error", message: "Missing <command>." }],
    },
  };

  const html = renderResourceCatalog(state);
  assert.match(html, /Resource Catalog/);
  assert.match(html, /revision 7/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /mcp\.server-invalid/);
  assert.match(html, />Tools</);
  assert.match(html, /files\/read/);
  assert.match(html, /<details class="resource-group" open>\s*<summary><div><h2>Agents<\/h2>/);
  assert.equal((html.match(/<details class="resource-group" open>/g) ?? []).length, 4);
  assert.match(html, /Missing &lt;command&gt;\./);
  assert.doesNotMatch(html, /Private instructions/);
  assert.match(html, /resource-refresh/);
});

test("collapses every large Resource group while keeping each independently expandable", () => {
  const agents = Array.from({ length: 9 }, (_, index) => ({
    identity: `agent-${index}`,
    description: `Agent ${index}.`,
    instructions: "Instructions.",
    model: null,
    tools: null,
    status: "available" as const,
  }));
  const skills = Array.from({ length: 9 }, (_, index) => ({
    name: `skill-${index}`,
    description: `Skill ${index}.`,
    userInvocable: true,
    disableModelInvocation: false,
    status: "available" as const,
  }));
  const mcpServers = Array.from({ length: 9 }, (_, index) => ({
    name: `server-${index}`,
    fingerprint: String(index).repeat(64),
    status: "available" as const,
    transport: "stdio" as const,
    inputIds: [],
    requiresOAuth: false,
  }));
  const tools = Array.from({ length: 9 }, (_, index) => ({
    identity: `extension/tool-${index}`,
    description: `Extension Tool ${index}.`,
    origin: "extension" as const,
    effectClass: "ambient" as const,
    status: "available" as const,
    inputSchema: {},
    inputSchemaFingerprint: String(index).repeat(64),
    resultSchema: {},
  }));
  const html = renderResourceCatalog({
    workspaceRoot: "/repo",
    workspaceName: "repo",
    revision: 1,
    refreshedAt: "2026-07-27T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    catalog: { agents, skills, mcpServers, tools, diagnostics: [] },
  });

  assert.equal((html.match(/<details class="resource-group"/g) ?? []).length, 4);
  assert.equal((html.match(/<details class="resource-group" open>/g) ?? []).length, 0);
  for (const title of ["Agents", "Skills", "MCP", "Tools"]) {
    assert.match(html, new RegExp(`<details class="resource-group">\\s*<summary><div><h2>${title}</h2>`));
  }
});

test("renders an explicit no-workspace state", () => {
  const html = renderResourceCatalog({
    workspaceRoot: null,
    workspaceName: "No workspace",
    revision: 0,
    refreshedAt: "2026-07-26T00:00:00.000Z",
    fingerprint: "0".repeat(64),
    catalog: { agents: [], skills: [], mcpServers: [], tools: [], diagnostics: [] },
  });
  assert.match(html, /Open a repository workspace/);
});
