import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverResources, loadSkillInstructions, pinSnapshot, selectTools, type ToolResource } from "../../../src/features/resources/catalog";

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
    { identity: "files/read", origin: "workbench", effectClass: "read", status: "available", inputSchema: {}, inputSchemaFingerprint: "a", resultSchema: {} },
    { identity: "server/query", origin: "mcp", effectClass: "ambient", status: "available", inputSchema: {}, inputSchemaFingerprint: "b", resultSchema: {} },
    { identity: "server/offline", origin: "mcp", effectClass: "ambient", status: "unavailable", inputSchema: {}, inputSchemaFingerprint: "c", resultSchema: {}, reason: "Offline." },
  ];
  assert.deepEqual(selectTools(tools, ["server/*"]).map((tool) => tool.identity), ["server/query"]);
  assert.deepEqual(selectTools(tools, ["files/read", "unknown/tool"]).map((tool) => tool.identity), ["files/read"]);
  const catalog = { agents: [], skills: [], mcpServers: [], tools: [], diagnostics: [] };
  const snapshot = pinSnapshot(catalog, { identity: "a", description: "d", instructions: "i", model: null, tools: null, status: "available" }, "model-a", tools, "2026-07-25T00:00:00.000Z");
  assert.equal(snapshot.tools.length, 2); assert.equal(snapshot.effectiveModelId, "model-a");
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
