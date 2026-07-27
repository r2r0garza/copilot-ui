import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResourceCatalogController } from "../../../src/features/resources/service";
import type { ToolResource } from "../../../src/features/resources/catalog";

test("refreshes changed canonical resources into monotonic catalog revisions", () => {
  const root = workspace();
  writeAgent(root, "reviewer", "description: Review code");
  let tick = 0;
  const controller = new ResourceCatalogController(root, "fixture", () => `2026-07-26T00:00:0${tick++}.000Z`);
  const revisions: number[] = [];
  controller.onDidChange((state) => revisions.push(state.revision));

  assert.equal(controller.getState().revision, 1);
  assert.equal(controller.getState().catalog.agents[0].status, "available");
  assert.equal(controller.refresh().revision, 1);
  assert.deepEqual(revisions, []);

  writeAgent(root, "reviewer", "description: Review code\ntarget: github-copilot");
  const unavailable = controller.refresh();
  assert.equal(unavailable.revision, 2);
  assert.equal(unavailable.catalog.agents[0].status, "unavailable");
  assert.deepEqual(revisions, [2]);

  writeFileSync(join(root, "unrelated.txt"), "not a canonical resource");
  assert.equal(controller.refresh().revision, 2);
  assert.deepEqual(revisions, [2]);
  controller.dispose();
});

test("pins the active catalog revision without hot-swapping prior snapshots", () => {
  const root = workspace();
  writeAgent(root, "reviewer", "description: Review code");
  const controller = new ResourceCatalogController(root, "fixture", () => "2026-07-26T00:00:00.000Z");
  const agent = controller.getState().catalog.agents[0];
  const first = controller.createSnapshot(agent, "model-a", []);

  writeAgent(root, "reviewer", "description: Updated review behavior");
  controller.refresh();
  const second = controller.createSnapshot(controller.getState().catalog.agents[0], "model-a", []);

  assert.equal(first.catalogRevision, 1);
  assert.equal(second.catalogRevision, 2);
  assert.notEqual(first.catalogFingerprint, second.catalogFingerprint);
  assert.equal(first.catalogRevision, 1);
  controller.dispose();
});

test("switches the active workspace atomically and exposes a no-workspace state", () => {
  const firstRoot = workspace();
  const secondRoot = workspace();
  writeAgent(firstRoot, "first", "description: First workspace");
  writeAgent(secondRoot, "second", "description: Second workspace");
  const controller = new ResourceCatalogController(firstRoot, "first");

  const second = controller.setWorkspace(secondRoot, "second");
  assert.equal(second.revision, 2);
  assert.equal(second.workspaceName, "second");
  assert.equal(second.catalog.agents[0].identity, "second");

  const empty = controller.setWorkspace(null);
  assert.equal(empty.revision, 3);
  assert.equal(empty.workspaceRoot, null);
  assert.equal(empty.catalog.agents.length, 0);
  controller.dispose();
});

test("refreshes host-registered Tools without changing their extension origin", () => {
  const root = workspace();
  let tools: readonly ToolResource[] = [];
  const controller = new ResourceCatalogController(root, "fixture", undefined, () => tools);

  assert.deepEqual(controller.getState().catalog.tools.map((tool) => tool.origin), ["workbench", "workbench", "workbench"]);
  tools = [{
    identity: "extension/search",
    description: "Search through an extension.",
    origin: "extension",
    effectClass: "ambient",
    status: "available",
    inputSchema: { type: "object" },
    inputSchemaFingerprint: "f".repeat(64),
    resultSchema: {},
  }];
  const refreshed = controller.refresh();
  assert.equal(refreshed.revision, 2);
  assert.equal(refreshed.catalog.tools.at(-1)?.identity, "extension/search");
  assert.equal(refreshed.catalog.tools.at(-1)?.origin, "extension");
  controller.dispose();
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "bridgit-resource-service-"));
  mkdirSync(join(root, ".github", "agents"), { recursive: true });
  return root;
}

function writeAgent(root: string, identity: string, frontmatter: string): void {
  writeFileSync(join(root, ".github", "agents", `${identity}.agent.md`), `---\n${frontmatter}\n---\nInstructions.`);
}
