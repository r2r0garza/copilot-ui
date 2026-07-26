import assert from "node:assert/strict";
import test from "node:test";
import { audit, authorize, operationKey, validateRepositoryPath } from "../../../src/features/execution-authority/policy";

test("rejects paths outside the canonical repository boundary", () => {
  assert.equal(validateRepositoryPath("/workspace/repo", "src/index.ts"), "src/index.ts");
  assert.throws(() => validateRepositoryPath("/workspace/repo", "../secret"), /outside/);
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
