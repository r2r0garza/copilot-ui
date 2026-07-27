import assert from "node:assert/strict";
import test from "node:test";
import { authorityGrantFingerprint, audit, authorize, operationKey, validateRepositoryPath, type AuthorityGrant } from "../../../src/features/execution-authority";

test("rejects paths outside the canonical repository boundary", () => {
  assert.equal(validateRepositoryPath("/workspace/repo", "src/index.ts"), "src/index.ts");
  assert.throws(() => validateRepositoryPath("/workspace/repo", "../secret"), /parent-traversal/);
  assert.throws(() => validateRepositoryPath("/workspace/repo", "src/../secret"), /parent-traversal/);
  assert.throws(() => validateRepositoryPath("/workspace/repo", "/etc/passwd"), /repository-relative/);
});

test("makes denied ambient calls side-effect-free and redacts their audit input", () => {
  const request = { tool: "shell/run", effect: "ambient" as const, input: { password: "never-record", command: "git status" }, operationKey: "operation-1" };
  const decision = authorize(request, undefined, "/workspace/repo", false);
  assert.equal(decision.allowed, false); assert.equal(decision.sanitizedInput.password, "[redacted]");
  assert.equal(audit(request, decision, "snapshot-1").operationKey, "operation-1");
  const { operationKey: _ignored, ...operation } = request;
  assert.equal(operationKey(operation), operationKey(operation));
});

test("requires an owner-bound exact Tool grant and separate Local Commit Authority", () => {
  const context = { owner: { kind: "chat" as const, id: "chat-1" }, resourceSnapshotId: "a".repeat(64) };
  const request = { tool: "git/commit", effect: "repository-write" as const, input: { message: "Safe commit" }, operationKey: "operation-2" };
  const withoutLocalCommit = grant(["tool:git/commit"]);
  assert.equal(authorize(request, withoutLocalCommit, "/workspace/repo", false, context).reason, "local-commit-authority-required");
  assert.equal(authorize(request, grant(["tool:git/commit", "local-commit"]), "/workspace/repo", false, context).allowed, true);
  assert.equal(authorize(request, grant(["tool:git/commit", "local-commit"]), "/workspace/repo", false, { ...context, owner: { kind: "task", id: "task-1" } }).reason, "missing-explicit-authority");
});

test("does not substitute an ambient Tool grant for a separate fingerprint-bound Extension grant", () => {
  const extensionFingerprint = "b".repeat(64);
  const context = { owner: { kind: "chat" as const, id: "chat-1" }, resourceSnapshotId: null };
  const request = {
    tool: "extension/search",
    effect: "ambient" as const,
    input: {},
    authorityCapabilities: [`extension-tool:extension/search@${extensionFingerprint}`],
    operationKey: "operation-3",
  };
  const ambientOnly = grant(["tool:extension/search", "ambient:extension/search"], "ambient", null);
  assert.equal(authorize(request, ambientOnly, "/workspace/repo", false, context).reason, "separate-authority-required");
  const exact = grant([...ambientOnly.capabilities, request.authorityCapabilities[0]], "ambient", null);
  assert.equal(authorize(request, exact, "/workspace/repo", false, context).allowed, true);
});

function grant(capabilities: readonly string[], effectClass: AuthorityGrant["effectClass"] = "repository-write", resourceSnapshotId: string | null = "a".repeat(64)): AuthorityGrant {
  const draft = {
    grantId: "grant-1", reviewId: "review-1", owner: { kind: "chat" as const, id: "chat-1" }, scope: resourceSnapshotId === null ? "chat-session" as const : "chat-once" as const,
    effectClass, capabilities, resourceSnapshotId,
    issuedAt: "2026-07-27T00:00:00.000Z", expiresAt: null, revokedAt: null, consumedAt: null,
  };
  return { ...draft, fingerprint: authorityGrantFingerprint(draft) };
}
