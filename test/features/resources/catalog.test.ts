import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverResources, pinSnapshot, selectTools, type ToolResource } from "../../../src/features/resources/catalog";

test("discovers valid repository resources while isolating invalid peers", () => {
  const root = mkdtempSync(join(tmpdir(), "bridgit-resources-"));
  mkdirSync(join(root, ".github", "agents"), { recursive: true }); mkdirSync(join(root, ".github", "skills", "review"), { recursive: true }); mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, ".github", "agents", "reviewer.agent.md"), "---\ndescription: Review code\nmodel: model-a\ntools: [files/read]\n---\nGive concise reviews.");
  writeFileSync(join(root, ".github", "agents", "broken!.agent.md"), "---\ndescription: nope\n---\ntext");
  writeFileSync(join(root, ".github", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review a diff\n---\nRead the selected diff.");
  writeFileSync(join(root, ".vscode", "mcp.json"), JSON.stringify({ servers: { local: { command: "node", args: ["server.js"] }, unsupported: { command: "x", sandboxEnabled: true } } }));
  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "reviewer")?.status, "available");
  assert.equal(catalog.agents.find((agent) => agent.identity === "broken!")?.status, "invalid");
  assert.equal(catalog.mcpServers.find((server) => server.name === "local")?.status, "available");
  assert.equal(catalog.mcpServers.find((server) => server.name === "unsupported")?.status, "unavailable");
});

test("keeps explicit tool allowlists narrow and pins immutable snapshots", () => {
  const tools: ToolResource[] = [{ identity: "files/read", origin: "workbench", status: "available", inputSchemaFingerprint: "a" }, { identity: "server/query", origin: "mcp", status: "available", inputSchemaFingerprint: "b" }];
  assert.deepEqual(selectTools(tools, ["server/*"]).map((tool) => tool.identity), ["server/query"]);
  const catalog = { agents: [], skills: [], mcpServers: [], diagnostics: [] };
  const snapshot = pinSnapshot(catalog, { identity: "a", description: "d", instructions: "i", model: null, tools: null, status: "available" }, "model-a", tools, "2026-07-25T00:00:00.000Z");
  assert.equal(snapshot.tools.length, 2); assert.equal(snapshot.effectiveModelId, "model-a");
});
