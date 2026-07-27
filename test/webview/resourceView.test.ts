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
      tools: [{ identity: "files/read", origin: "workbench", effectClass: "read", status: "available", inputSchema: {}, inputSchemaFingerprint: "c".repeat(64), resultSchema: {} }],
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
  assert.match(html, /Missing &lt;command&gt;\./);
  assert.doesNotMatch(html, /Private instructions/);
  assert.match(html, /resource-refresh/);
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
