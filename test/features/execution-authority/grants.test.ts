import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityGrantFingerprint,
  grantIsActive,
  normalizeAuthorityScope,
  validateGrantOwner,
  type AuthorityGrant,
} from "../../../src/features/execution-authority";

test("normalizes exact capabilities and fingerprints the owner, scope, effect, and snapshot", () => {
  assert.deepEqual(normalizeAuthorityScope({ capabilities: [" tool:files/write ", "local-commit", "tool:files/write"] }), {
    capabilities: ["local-commit", "tool:files/write"],
  });
  assert.throws(() => normalizeAuthorityScope({ capabilities: ["ambient"] }), /capability-invalid/);
  const grant = fixtureGrant();
  assert.equal(grant.fingerprint, authorityGrantFingerprint(grant));
  assert.notEqual(grant.fingerprint, authorityGrantFingerprint({ ...grant, owner: { kind: "task", id: "task-1" }, scope: "task" }));
  assert.notEqual(grant.fingerprint, authorityGrantFingerprint({ ...grant, effectClass: "ambient" }));
});

test("keeps Chat and Task scopes separate and prevents Task expansion during execution", () => {
  assert.doesNotThrow(() => validateGrantOwner({ kind: "chat", id: "chat-1" }, "chat-session"));
  assert.doesNotThrow(() => validateGrantOwner({ kind: "task", id: "task-1" }, "task", "admission"));
  assert.throws(() => validateGrantOwner({ kind: "chat", id: "chat-1" }, "task"), /chat-cannot/);
  assert.throws(() => validateGrantOwner({ kind: "task", id: "task-1" }, "chat-session"), /task-requires/);
  assert.throws(() => validateGrantOwner({ kind: "task", id: "task-1" }, "task", "execution"), /fixed-at-admission/);
});

test("accepts only an untampered active grant for its exact owner and pinned snapshot", () => {
  const grant = fixtureGrant();
  assert.equal(grantIsActive(grant, { owner: grant.owner, resourceSnapshotId: grant.resourceSnapshotId, now: "2026-07-27T00:00:00.000Z" }), true);
  assert.equal(grantIsActive(grant, { owner: { kind: "chat", id: "other-chat" }, resourceSnapshotId: grant.resourceSnapshotId }), false);
  assert.equal(grantIsActive(grant, { owner: grant.owner, resourceSnapshotId: "b".repeat(64) }), false);
  assert.equal(grantIsActive({ ...grant, consumedAt: "2026-07-27T00:00:00.000Z" }, { owner: grant.owner, resourceSnapshotId: grant.resourceSnapshotId }), false);
  assert.equal(grantIsActive({ ...grant, capabilities: ["tool:files/read"] }, { owner: grant.owner, resourceSnapshotId: grant.resourceSnapshotId }), false);
});

function fixtureGrant(): AuthorityGrant {
  const draft = {
    grantId: "grant-1",
    reviewId: "review-1",
    owner: { kind: "chat" as const, id: "chat-1" },
    scope: "chat-once" as const,
    effectClass: "repository-write" as const,
    capabilities: ["local-commit", "tool:git/commit"],
    resourceSnapshotId: "a".repeat(64),
    issuedAt: "2026-07-27T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    consumedAt: null,
  };
  return { ...draft, fingerprint: authorityGrantFingerprint(draft) };
}
