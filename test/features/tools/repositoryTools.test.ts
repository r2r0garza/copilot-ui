import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RepositoryToolExecutor, repositoryToolCatalog } from "../../../src/features/tools";

test("declares stable Workbench Tool contracts for list, read, and write", () => {
  assert.deepEqual(repositoryToolCatalog.map((tool) => [tool.identity, tool.origin, tool.effectClass]), [
    ["files/list", "workbench", "read"],
    ["files/read", "workbench", "read"],
    ["files/write", "workbench", "repository-write"],
  ]);
  for (const tool of repositoryToolCatalog) {
    assert.equal(tool.status, "available");
    assert.match(tool.inputSchemaFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.resultSchema.type, "object");
  }
});

test("lists direct repository entries and reads bounded UTF-8 files", () => {
  const root = workspace();
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export const ready = true;\n");
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  const executor = new RepositoryToolExecutor(root);

  const listed = executor.invoke("files/list", { path: ".", maxEntries: 1 });
  assert.ok("entries" in listed);
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.truncated, true);
  const read = executor.invoke("files/read", { path: "src/index.ts" });
  assert.ok("content" in read);
  assert.equal(read.content, "export const ready = true;\n");
  assert.equal(read.byteLength, 27);
  assert.match(read.sha256, /^[a-f0-9]{64}$/);
});

test("creates and compare-before-replaces a regular repository file", () => {
  const root = workspace();
  mkdirSync(join(root, "notes"));
  const executor = new RepositoryToolExecutor(root);

  const created = executor.invoke("files/write", { path: "notes/status.txt", mode: "create", content: "draft\n" });
  assert.ok("operation" in created);
  assert.equal(created.operation, "created");
  assert.equal(created.previousSha256, null);
  assert.equal(readFileSync(join(root, "notes", "status.txt"), "utf8"), "draft\n");

  const replaced = executor.invoke("files/write", {
    path: "notes/status.txt",
    mode: "replace",
    content: "ready\n",
    expectedSha256: created.sha256,
  });
  assert.ok("operation" in replaced);
  assert.equal(replaced.operation, "replaced");
  assert.equal(replaced.previousSha256, created.sha256);
  assert.equal(readFileSync(join(root, "notes", "status.txt"), "utf8"), "ready\n");
  assert.equal(readdirSync(join(root, "notes")).some((name) => name.startsWith(".bridgit-")), false);
});

test("rejects traversal, absolute paths, missing parents, and stale replacements without side effects", () => {
  const root = workspace();
  const outside = join(root, "..", "outside-from-tool.txt");
  const executor = new RepositoryToolExecutor(root);

  assert.throws(() => executor.invoke("files/write", { path: "../outside-from-tool.txt", mode: "create", content: "no" }), /parent-traversal/);
  assert.throws(() => executor.invoke("files/write", { path: "/tmp/outside.txt", mode: "create", content: "no" }), /repository-relative/);
  assert.throws(() => executor.invoke("files/write", { path: "missing/file.txt", mode: "create", content: "no" }), /path-not-found/);
  assert.equal(existsSync(outside), false);
  assert.equal(existsSync(join(root, "missing")), false);

  writeFileSync(join(root, "tracked.txt"), "original");
  assert.throws(() => executor.invoke("files/write", {
    path: "tracked.txt",
    mode: "replace",
    content: "changed",
    expectedSha256: "0".repeat(64),
  }), /target-changed/);
  assert.equal(readFileSync(join(root, "tracked.txt"), "utf8"), "original");
  assert.equal(readdirSync(root).some((name) => name.startsWith(".bridgit-")), false);
});

test("never follows linked paths and cannot create through an unapproved root", () => {
  const root = workspace();
  const outside = mkdtempSync(join(tmpdir(), "bridgit-tools-outside-"));
  writeFileSync(join(outside, "secret.txt"), "outside");
  symlinkSync(outside, join(root, "linked"));
  const executor = new RepositoryToolExecutor(root);
  const linkedRoot = join(tmpdir(), `bridgit-linked-root-${Date.now()}`);

  assert.throws(() => executor.invoke("files/read", { path: "linked/secret.txt" }), /linked-path-rejected/);
  assert.throws(() => executor.invoke("files/write", { path: "linked/new.txt", mode: "create", content: "no" }), /linked-path-rejected/);
  assert.equal(existsSync(join(outside, "new.txt")), false);
  symlinkSync(root, linkedRoot);
  assert.throws(() => new RepositoryToolExecutor(linkedRoot), /requires-approval/);
});

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "bridgit-tools-"));
}
