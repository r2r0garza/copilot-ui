import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { repositoryGitToolCatalog, SafeGitExecutor } from "../../../src/features/tools";

test("declares only structured status, exact stage, and local commit Tools", () => {
  const root = repository();
  assert.deepEqual(repositoryGitToolCatalog(root).map((tool) => [tool.identity, tool.origin, tool.effectClass, tool.status]), [
    ["git/status", "workbench", "read", "available"],
    ["git/stage", "workbench", "repository-write", "available"],
    ["git/commit", "workbench", "repository-write", "available"],
  ]);
  assert.equal(repositoryGitToolCatalog(mkdtempSync(join(tmpdir(), "bridgit-not-git-"))).every((tool) => tool.status === "unavailable"), true);
});

test("observes structured status and binds commit to an exact staged index", () => {
  const root = repository();
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  git(root, ["add", "--", "tracked.txt"]);
  git(root, ["commit", "-m", "initial"]);
  writeFileSync(join(root, "tracked.txt"), "staged version\n");
  writeFileSync(join(root, "new.txt"), "new\n");
  const executor = new SafeGitExecutor(root);

  const observed = executor.invoke("git/status", {});
  assert.ok("entries" in observed);
  assert.equal(observed.entries.find((entry) => entry.path === "tracked.txt")?.worktreeStatus, "M");
  assert.equal(observed.entries.find((entry) => entry.path === "new.txt")?.kind, "untracked");

  const staged = executor.invoke("git/stage", { paths: ["tracked.txt"] });
  assert.ok("stagedPaths" in staged);
  assert.deepEqual(staged.stagedPaths, ["tracked.txt"]);
  git(root, ["add", "--", "new.txt"]);
  assert.throws(() => executor.invoke("git/commit", { message: "safe local commit", expectedIndexFingerprint: staged.indexFingerprint }), /git-index-changed/);

  const refreshed = executor.invoke("git/status", {});
  assert.ok("entries" in refreshed);
  const hookMarker = join(root, "hook-ran");
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\nprintf unsafe > "${hookMarker}"\nexit 1\n`);
  chmodSync(hook, 0o755);
  const committed = executor.invoke("git/commit", { message: "safe local commit", expectedIndexFingerprint: refreshed.indexFingerprint });
  assert.ok("commit" in committed);
  assert.match(committed.commit, /^[a-f0-9]{40,64}$/);
  assert.deepEqual(committed.committedPaths, ["new.txt", "tracked.txt"]);
  assert.equal(existsSync(hookMarker), false);
});

test("rejects traversal, directories, links, filters, stale paths, and arbitrary Git commands", () => {
  const root = repository();
  mkdirSync(join(root, "directory"));
  writeFileSync(join(root, "directory", "file.txt"), "content\n");
  writeFileSync(join(root, "filtered.txt"), "content\n");
  writeFileSync(join(root, ".gitattributes"), "filtered.txt filter=external\n");
  symlinkSync("directory/file.txt", join(root, "linked.txt"));
  mkdirSync(join(root, "nested"));
  git(join(root, "nested"), ["init", "-q"]);
  writeFileSync(join(root, "nested", "inside.txt"), "nested\n");
  const executor = new SafeGitExecutor(root);

  assert.throws(() => executor.invoke("git/stage", { paths: ["../outside"] }), /parent-traversal/);
  assert.throws(() => executor.invoke("git/stage", { paths: ["directory"] }), /exact-file/);
  assert.throws(() => executor.invoke("git/stage", { paths: ["linked.txt"] }), /linked-path/);
  assert.throws(() => executor.invoke("git/stage", { paths: ["nested/inside.txt"] }), /nested-git-boundary/);
  assert.throws(() => executor.invoke("git/stage", { paths: ["filtered.txt"] }), /filter-prohibited/);
  assert.throws(() => executor.invoke("git/stage", { paths: ["missing.txt"] }), /path-not-found/);
  assert.throws(() => executor.invoke("git/push", {}), /tool-not-found/);
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "bridgit-safe-git-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Bridgit Test"]);
  git(root, ["config", "user.email", "bridgit@example.invalid"]);
  return root;
}

function git(root: string, args: readonly string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
