import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverResources, loadSkillInstructions, pinSnapshot, resolveToolSelection, selectTools, type ToolResource } from "../../../src/features/resources/catalog";

test("discovers valid repository resources while isolating invalid peers", () => {
  const root = mkdtempSync(join(tmpdir(), "bridgit-resources-"));
  mkdirSync(join(root, ".github", "agents"), { recursive: true }); mkdirSync(join(root, ".github", "skills", "review"), { recursive: true }); mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, ".github", "agents", "reviewer.agent.md"), "---\ndescription: Review code\nmodel: [model-a, model-b]\ntools:\n  - files/read\nfuture-field: accepted-with-warning\n---\nGive concise reviews.");
  writeFileSync(join(root, ".github", "agents", "broken!.agent.md"), "---\ndescription: nope\n---\ntext");
  writeFileSync(join(root, ".github", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review a diff\n---\nRead the selected diff.");
  writeFileSync(join(root, ".vscode", "mcp.json"), JSON.stringify({ servers: { local: { command: "node", args: ["server.js"] }, unsupported: { command: "x", sandboxEnabled: true } } }));
  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "reviewer")?.status, "available");
  assert.deepEqual(catalog.agents.find((agent) => agent.identity === "reviewer")?.model, ["model-a", "model-b"]);
  assert.equal(catalog.agents.find((agent) => agent.identity === "broken!")?.status, "invalid");
  assert.equal(catalog.mcpServers.find((server) => server.name === "local")?.status, "available");
  assert.equal(catalog.mcpServers.find((server) => server.name === "unsupported")?.status, "unavailable");
  assert.equal(catalog.diagnostics.find((item) => item.code === "resource.unknown-field")?.severity, "warning");
  assert.deepEqual(catalog.tools.map((tool) => tool.identity), ["files/list", "files/read", "files/write"]);
  assert.equal(loadSkillInstructions(root, "review"), "Read the selected diff.");
});

test("keeps explicit tool allowlists narrow and pins immutable snapshots", () => {
  const tools: ToolResource[] = [
    { identity: "files/read", description: "Read.", origin: "workbench", effectClass: "read", status: "available", inputSchema: {}, inputSchemaFingerprint: "a", resultSchema: {} },
    { identity: "server/query", description: "Query.", origin: "mcp", effectClass: "ambient", status: "available", inputSchema: {}, inputSchemaFingerprint: "b", resultSchema: {} },
    { identity: "server/offline", description: "Offline.", origin: "mcp", effectClass: "ambient", status: "unavailable", inputSchema: {}, inputSchemaFingerprint: "c", resultSchema: {}, reason: "Offline." },
  ];
  assert.deepEqual(selectTools(tools, ["server/*"]).map((tool) => tool.identity), ["server/query"]);
  assert.deepEqual(selectTools(tools, ["files/read", "unknown/tool"]).map((tool) => tool.identity), ["files/read"]);
  assert.deepEqual(resolveToolSelection(tools, ["files/read", "unknown/tool", "bad*"]).unresolved, ["unknown/tool", "bad*"]);
  const catalog = { agents: [], skills: [], mcpServers: [], tools: [], diagnostics: [] };
  const snapshot = pinSnapshot(
    { ...catalog, tools },
    { identity: "a", description: "d", instructions: "i", model: null, tools: ["files/read", "missing/tool"], status: "available" },
    effectiveModel(),
    "attempt-1",
    "2026-07-25T00:00:00.000Z",
  );
  assert.deepEqual(snapshot.tools.map((tool) => tool.identity), ["files/read"]);
  assert.deepEqual(snapshot.unresolvedToolSelectors, ["missing/tool"]);
  assert.equal(snapshot.effectiveModelId, "model-a");
  assert.equal(snapshot.effectiveModel.version, "1");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.agent), true);
  assert.equal(Object.isFrozen(snapshot.tools[0].inputSchema), true);
});

test("preserves Tool origins and disables every cross-source identity collision", () => {
  const root = workspace();
  const extensionTools: ToolResource[] = [
    { identity: "extension/search", description: "Search.", origin: "extension", effectClass: "ambient", status: "available", inputSchema: {}, inputSchemaFingerprint: "d", resultSchema: {} },
    { identity: "files/read", description: "Conflicting read.", origin: "extension", effectClass: "ambient", status: "available", inputSchema: {}, inputSchemaFingerprint: "e", resultSchema: {} },
  ];
  const catalog = discoverResources(root, extensionTools);

  assert.equal(catalog.tools.find((tool) => tool.identity === "extension/search")?.origin, "extension");
  assert.deepEqual(catalog.tools.filter((tool) => tool.identity === "files/read").map((tool) => tool.status), ["invalid", "invalid"]);
  assert.equal(catalog.diagnostics.filter((item) => item.code === "tool.identity-collision").length, 1);
  assert.deepEqual(resolveToolSelection(catalog.tools, ["files/read", "extension/search"]).tools.map((tool) => tool.identity), ["extension/search"]);
  assert.deepEqual(resolveToolSelection(catalog.tools, ["files/read", "extension/search"]).unresolved, ["files/read"]);
});

test("marks every case-colliding Agent invalid and protects bundled identities", () => {
  const root = workspace();
  writeAgent(root, "Review", "description: Upper");
  writeAgent(root, "review", "description: Lower");
  writeAgent(root, "memory-manager", "description: Protected");

  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "memory-manager")?.status, "invalid");
  const colliding = catalog.agents.filter((agent) => agent.identity.toLowerCase() === "review");
  if (colliding.length === 2) {
    assert.deepEqual(colliding.map((agent) => agent.status), ["invalid", "invalid"]);
    assert.equal(catalog.diagnostics.filter((item) => item.code === "agent.identity-collision").length, 2);
  } else {
    // Case-insensitive filesystems cannot represent both fixtures; Linux CI exercises the collision.
    assert.equal(colliding.length, 1);
  }
});

test("rejects unsafe YAML without hiding an unrelated valid Agent", () => {
  const root = workspace();
  writeAgent(root, "valid", "description: Valid");
  writeAgent(root, "duplicate", "description: One\ndescription: Two");
  writeAgent(root, "anchor", "description: &description Anchored");
  writeAgent(root, "non-string-key", "1: numeric\ndescription: Invalid");

  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "valid")?.status, "available");
  assert.deepEqual(
    catalog.agents.filter((agent) => agent.identity !== "valid").map((agent) => agent.status),
    ["invalid", "invalid", "invalid"],
  );
  assert.equal(catalog.diagnostics.filter((item) => item.code === "agent.yaml-invalid").length, 3);
});

test("enforces Agent UTF-8 and size limits", () => {
  const root = workspace();
  writeFileSync(join(root, ".github", "agents", "invalid-utf8.agent.md"), Buffer.from([0xff, 0xfe]));
  writeFileSync(
    join(root, ".github", "agents", "large.agent.md"),
    `---\ndescription: Large\n---\n${"x".repeat(30_001)}`,
  );

  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "invalid-utf8")?.reason, "Resource is not valid UTF-8.");
  assert.equal(catalog.agents.find((agent) => agent.identity === "large")?.status, "invalid");
});

test("keeps unsupported Agents and Skills visible with actionable reasons", () => {
  const root = workspace();
  writeAgent(root, "cloud", "description: Cloud\ntarget: github-copilot");
  writeAgent(root, "hooks", "description: Hooks\nhooks:\n  stop: ./stop.sh");
  mkdirSync(join(root, ".github", "skills", "forked"), { recursive: true });
  writeFileSync(
    join(root, ".github", "skills", "forked", "SKILL.md"),
    "---\nname: forked\ndescription: Run in isolation\ncontext: fork\nuser-invocable: false\ndisable-model-invocation: true\n---\nDo isolated work.",
  );

  const catalog = discoverResources(root);
  assert.equal(catalog.agents.find((agent) => agent.identity === "cloud")?.status, "unavailable");
  assert.match(catalog.agents.find((agent) => agent.identity === "cloud")?.reason ?? "", /not runnable locally/);
  assert.equal(catalog.agents.find((agent) => agent.identity === "hooks")?.status, "unavailable");
  assert.equal(catalog.skills[0].status, "unavailable");
  assert.equal(catalog.skills[0].userInvocable, false);
  assert.equal(catalog.skills[0].disableModelInvocation, true);
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "bridgit-resources-"));
  mkdirSync(join(root, ".github", "agents"), { recursive: true });
  mkdirSync(join(root, ".github", "skills"), { recursive: true });
  return root;
}

function writeAgent(root: string, identity: string, frontmatter: string): void {
  writeFileSync(join(root, ".github", "agents", `${identity}.agent.md`), `---\n${frontmatter}\n---\nInstructions.`);
}

function effectiveModel() {
  return { id: "model-a", name: "Model A", vendor: "fixture", family: "test", version: "1", maxInputTokens: 4096, selectionSource: "auto" as const };
}
