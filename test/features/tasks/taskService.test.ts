import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkspaceStore } from "../../../src/adapters/sqlite/workspaceStore";
import {
  createTaskService,
  type AgentCandidate,
  type SemanticAssessment,
  type SubtaskInput,
  type TaskContractInput,
} from "../../../src/features/tasks";

const contract: TaskContractInput = {
  goal: "Implement the autonomous Task happy path.",
  successCriteria: ["All required Subtasks succeed.", "The completion check passes."],
  scope: ["Task Runtime and its tests"],
  safetyConstraints: ["Do not write outside the confirmed repository boundary."],
  preferences: { agentIdentities: ["reviewer"], modelIds: ["model-a"] },
  repositoryBoundary: { repositoryRoot: "/repo", allowedPaths: ["src", "test"] },
  authority: { capabilities: ["repository-read", "repository-write"] },
};

const reviewer: AgentCandidate = {
  identity: "reviewer",
  description: "Review and verify TypeScript changes.",
  origin: "repository",
  delegationAuthorized: true,
  invocationAllowed: true,
  valid: true,
  available: true,
  targets: ["workspace"],
  resources: ["files", "tests"],
};

const bundledReviewer: AgentCandidate = {
  ...reviewer,
  identity: "bundled-reviewer",
  origin: "bundled",
};

const unavailableSpecialist: AgentCandidate = {
  ...reviewer,
  identity: "unavailable-specialist",
  description: "The most specific specialist.",
  available: false,
};

const assessment = (agentIdentity: string, suitable = true, specificity = 5): SemanticAssessment => ({
  agentIdentity,
  suitable,
  specificity,
  rationale: suitable ? `${agentIdentity} directly covers the verification objective with files and tests.` : "",
});

test("AS-04 captures, versions, and confirms the exact Task Contract before queue admission", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridgit-m3-contract-"));
  const store = new WorkspaceStore(directory);
  const tasks = createTaskService({ persistence: store, identity: sequenceIdentity() });
  const draft = tasks.createDraft({ ...contract, taskId: "task-contract" }, "2026-07-27T00:00:00.000Z");

  assert.equal(draft.state, "admitting");
  assert.equal(draft.confirmedContractVersion, null);
  assert.equal(draft.contractVersions[0]?.repositoryBoundary.repositoryRoot, "/repo");
  assert.deepEqual(draft.contractVersions[0]?.authority.capabilities, ["repository-read", "repository-write"]);
  assert.throws(
    () => tasks.confirmContract(draft.taskId, 1, "wrong"),
    /task-contract-confirmation-mismatch/,
  );
  assert.equal(tasks.getTask(draft.taskId)?.state, "admitting");

  const revised = tasks.reviseContract(draft.taskId, {
    ...contract,
    successCriteria: [...contract.successCriteria, "The exact contract version remains inspectable."],
  }, "2026-07-27T00:00:01.000Z");
  assert.equal(revised.version, 2);
  assert.throws(
    () => tasks.confirmContract(draft.taskId, 1, draft.contractVersions[0]!.confirmationHash),
    /task-contract-version-not-current/,
  );
  const admitted = tasks.confirmContract(
    draft.taskId,
    revised.version,
    revised.confirmationHash,
    "2026-07-27T00:00:02.000Z",
  );
  assert.equal(admitted.state, "queued");
  assert.equal(admitted.confirmedContractVersion, 2);
  assert.equal(admitted.contractVersions[1]?.confirmedAt, "2026-07-27T00:00:02.000Z");
  store.close();

  const reopenedStore = new WorkspaceStore(directory);
  const reopenedTasks = createTaskService({ persistence: reopenedStore });
  assert.equal(reopenedTasks.getTask(draft.taskId)?.state, "queued");
  assert.equal(reopenedTasks.getTask(draft.taskId)?.contractVersions.length, 2);
  assert.ok(reopenedStore.listEvents().some((event) => event.name === "task.admitted"));
  reopenedStore.close();
});

test("VC-ROUTE-001 filters hard eligibility before deterministic semantic selection and audits the choice", () => {
  const { tasks, taskId } = runningTask("routing-selection");
  addSubtasks(tasks, taskId, [subtask("review", "read-only")]);

  const selected = tasks.routeSubtask(
    taskId,
    "review",
    [bundledReviewer, unavailableSpecialist, reviewer],
    [
      assessment("bundled-reviewer"),
      assessment("unavailable-specialist", true, 100),
      assessment("reviewer"),
    ],
    "2026-07-27T01:00:00.000Z",
  );
  assert.ok("attemptId" in selected);
  assert.equal(selected.agentIdentity, "reviewer");
  assert.equal(selected.candidates.length, 3);
  assert.deepEqual(
    selected.candidates.find((candidate) => candidate.agentIdentity === "unavailable-specialist")?.rejectionReasons,
    ["agent-unavailable"],
  );
  assert.match(selected.rationale, /directly covers/);
  assert.equal(selected.resourceSnapshot.agentIdentity, "reviewer");
  assert.match(selected.resourceSnapshot.snapshotId, /^[a-f0-9]{64}$/);
});

test("capability gaps wait without substitution and one-attempt overrides remain eligible and audited", () => {
  const { tasks, taskId } = runningTask("routing-overrides");
  addSubtasks(tasks, taskId, [
    subtask("gap-1", "read-only"),
    subtask("gap-2", "read-only"),
    subtask("gap-3", "read-only"),
  ]);

  for (const subtaskId of ["gap-1", "gap-2", "gap-3"]) {
    const gap = tasks.routeSubtask(taskId, subtaskId, [reviewer], [assessment("reviewer", false)]);
    assert.ok("requiredResources" in gap);
    assert.equal(tasks.getTask(taskId)?.state, "waiting-for-routing");
    assert.equal(tasks.getTask(taskId)?.ownsActiveTaskSlot, true);
    assert.equal(tasks.getTask(taskId)?.ownsRepositoryWriteLock, false);

    const override = tasks.overrideRouting(
      taskId,
      subtaskId,
      reviewer.identity,
      [reviewer],
      "reviewer-verification-gap",
      "The user confirms this eligible Agent can cover the objective once.",
    );
    assert.equal(override.override, true);
    assert.equal(tasks.getTask(taskId)?.ownsRepositoryWriteLock, true);
    tasks.startAssignment(taskId, override.attemptId);
    tasks.completeAssignment(taskId, override.attemptId);
  }

  assert.deepEqual(tasks.getTask(taskId)?.agentUpdateProposals, [{
    agentIdentity: "reviewer",
    mismatchSignature: "reviewer-verification-gap",
    overrideCount: 3,
    status: "open",
    createdAt: tasks.getTask(taskId)?.agentUpdateProposals[0]?.createdAt,
  }]);
  tasks.resolveAgentUpdateProposal(taskId, "reviewer", "reviewer-verification-gap", "rejected");
  assert.equal(tasks.getTask(taskId)?.agentUpdateProposals[0]?.status, "rejected");
  assert.throws(
    () => tasks.overrideRouting(taskId, "gap-1", "unavailable-specialist", [unavailableSpecialist], "x", "No."),
    /routing-override-agent-ineligible/,
  );
});

test("Capability Decline preserves history and permits at most one automatic reroute", () => {
  const { tasks, taskId } = runningTask("routing-decline");
  addSubtasks(tasks, taskId, [subtask("delegate", "read-only")]);
  const secondAgent: AgentCandidate = { ...reviewer, identity: "secondary", description: "Secondary verifier." };
  const first = tasks.routeSubtask(
    taskId,
    "delegate",
    [reviewer, secondAgent],
    [assessment("reviewer", true, 10), assessment("secondary", true, 5)],
  );
  assert.ok("attemptId" in first);
  tasks.startAssignment(taskId, first.attemptId);
  const rerouted = tasks.declineAssignment(
    taskId,
    first.attemptId,
    "The fixture requires a specialized test runner.",
    ["specialized test runner"],
    [reviewer, secondAgent],
    [assessment("reviewer", true, 10), assessment("secondary", true, 5)],
  );
  assert.ok("attemptId" in rerouted);
  assert.equal(rerouted.agentIdentity, "secondary");
  assert.equal(rerouted.rerouteOrdinal, 1);

  const finalGap = tasks.declineAssignment(
    taskId,
    rerouted.attemptId,
    "The secondary Agent also lacks the runner.",
    ["specialized test runner"],
    [reviewer, secondAgent],
    [assessment("reviewer"), assessment("secondary")],
  );
  assert.ok("requiredResources" in finalGap);
  assert.equal(tasks.getTask(taskId)?.state, "waiting-for-routing");
  assert.deepEqual(
    tasks.getTask(taskId)?.assignmentAttempts.map(({ state, agentIdentity }) => ({ state, agentIdentity })),
    [
      { state: "declined", agentIdentity: "reviewer" },
      { state: "declined", agentIdentity: "secondary" },
    ],
  );
});

test("AS-05 preserves an acyclic success-only DAG, immutable history, three attempts, and one writer", () => {
  const { tasks, taskId } = runningTask("dag-and-capacity");
  addSubtasks(tasks, taskId, [
    subtask("read-1", "read-only"),
    subtask("read-2", "read-only"),
    subtask("write-1", "write-capable"),
    subtask("write-2", "write-capable"),
    subtask("write-3", "write-capable"),
  ], [{ prerequisiteSubtaskId: "write-1", dependentSubtaskId: "write-2" }]);

  assert.throws(() => tasks.appendGraphRevision(taskId, {
    edges: [{ prerequisiteSubtaskId: "write-2", dependentSubtaskId: "write-1" }],
    reason: "This revision is cyclic.",
  }), /subtask-graph-cycle/);
  assert.equal(tasks.getTask(taskId)?.graphRevisions.length, 1);

  const write = tasks.routeSubtask(taskId, "write-1", [reviewer], [assessment("reviewer")]);
  assert.throws(
    () => tasks.routeSubtask(taskId, "write-3", [reviewer], [assessment("reviewer")]),
    /assignment-writer-capacity-exhausted/,
  );
  const read1 = tasks.routeSubtask(taskId, "read-1", [reviewer], [assessment("reviewer")]);
  const read2 = tasks.routeSubtask(taskId, "read-2", [reviewer], [assessment("reviewer")]);
  assert.ok("attemptId" in write && "attemptId" in read1 && "attemptId" in read2);
  assert.throws(
    () => tasks.routeSubtask(taskId, "write-2", [reviewer], [assessment("reviewer")]),
    /subtask-not-routable/,
  );

  tasks.startAssignment(taskId, write.attemptId);
  tasks.startAssignment(taskId, read1.attemptId);
  tasks.startAssignment(taskId, read2.attemptId);
  assert.equal(
    tasks.getTask(taskId)?.assignmentAttempts.filter((attempt) => attempt.state === "running").length,
    3,
  );
  tasks.completeAssignment(taskId, write.attemptId);
  assert.equal(tasks.getTask(taskId)?.subtasks.find((item) => item.subtaskId === "write-2")?.state, "ready");
  const write2 = tasks.routeSubtask(taskId, "write-2", [reviewer], [assessment("reviewer")]);
  assert.ok("attemptId" in write2);
  assert.throws(
    () => tasks.appendGraphRevision(taskId, {
      supersedeSubtaskIds: ["write-1"],
      reason: "Completed history cannot be superseded.",
    }),
    /subtask-history-immutable/,
  );

  const extra = subtask("read-3", "read-only");
  tasks.appendGraphRevision(taskId, { subtasks: [extra], reason: "Append independent read work." });
  assert.throws(
    () => tasks.routeSubtask(taskId, "read-3", [reviewer], [assessment("reviewer")]),
    /assignment-capacity-exhausted/,
  );
  assert.equal(
    tasks.getTask(taskId)?.assignmentAttempts.filter((attempt) => ["selected", "running"].includes(attempt.state)).length,
    3,
  );
  assert.equal(
    tasks.getTask(taskId)?.assignmentAttempts.filter((attempt) =>
      ["selected", "running"].includes(attempt.state) && attempt.writeCapability === "write-capable",
    ).length,
    1,
  );
});

test("completion requires resolved work and runs one bounded repair revision before success", () => {
  const { tasks, taskId } = runningTask("completion-repair");
  addSubtasks(tasks, taskId, [subtask("implement", "write-capable")]);
  const attempt = tasks.routeSubtask(taskId, "implement", [reviewer], [assessment("reviewer")]);
  assert.ok("attemptId" in attempt);
  tasks.startAssignment(taskId, attempt.attemptId);
  tasks.completeAssignment(taskId, attempt.attemptId);

  tasks.setUnresolvedOperations(taskId, ["operation-1"]);
  assert.throws(
    () => tasks.runCompletionCheck(taskId, { passed: true, gaps: [] }),
    /task-operations-unresolved/,
  );
  tasks.setUnresolvedOperations(taskId, []);
  const repairing = tasks.runCompletionCheck(taskId, {
    passed: false,
    gaps: ["The final verification artifact is missing."],
    repairSubtasks: [subtask("repair", "write-capable")],
  });
  assert.equal(repairing.state, "running");
  assert.equal(repairing.repairCycles, 1);
  assert.equal(repairing.subtasks.find((item) => item.subtaskId === "repair")?.state, "ready");

  const repairAttempt = tasks.routeSubtask(taskId, "repair", [reviewer], [assessment("reviewer")]);
  assert.ok("attemptId" in repairAttempt);
  tasks.startAssignment(taskId, repairAttempt.attemptId);
  tasks.completeAssignment(taskId, repairAttempt.attemptId);
  const completed = tasks.runCompletionCheck(taskId, { passed: true, gaps: [] });
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.completionChecks.length, 2);
  assert.equal(completed.ownsRepositoryWriteLock, false);
  assert.equal(completed.ownsActiveTaskSlot, false);
});

test("three unsuccessful completion repairs stop for intervention and release only the write lock", () => {
  const { tasks, taskId } = runningTask("completion-bounded");
  addSubtasks(tasks, taskId, [subtask("initial", "write-capable")]);
  completeSubtask(tasks, taskId, "initial");

  for (const repair of ["repair-1", "repair-2"]) {
    const result = tasks.runCompletionCheck(taskId, {
      passed: false,
      gaps: [`${repair} is required.`],
      repairSubtasks: [subtask(repair, "write-capable")],
    });
    assert.equal(result.state, "running");
    completeSubtask(tasks, taskId, repair);
  }

  const blocked = tasks.runCompletionCheck(taskId, {
    passed: false,
    gaps: ["A third verification gap remains."],
  });
  assert.equal(blocked.state, "externally-blocked");
  assert.equal(blocked.repairCycles, 3);
  assert.equal(blocked.ownsRepositoryWriteLock, false);
  assert.equal(blocked.ownsActiveTaskSlot, true);
});

function runningTask(taskId: string) {
  const tasks = createTaskService({ identity: sequenceIdentity() });
  const draft = tasks.createDraft({ ...contract, taskId });
  tasks.confirmContract(taskId, 1, draft.contractVersions[0]!.confirmationHash);
  tasks.startTask(taskId);
  return { tasks, taskId };
}

function addSubtasks(
  tasks: ReturnType<typeof createTaskService>,
  taskId: string,
  subtasks: readonly SubtaskInput[],
  edges: readonly { prerequisiteSubtaskId: string; dependentSubtaskId: string }[] = [],
): void {
  tasks.appendGraphRevision(taskId, { subtasks, edges, reason: "Create the initial success-only graph." });
}

function subtask(subtaskId: string, writeCapability: SubtaskInput["writeCapability"]): SubtaskInput {
  return {
    subtaskId,
    objective: `Complete ${subtaskId}.`,
    required: true,
    writeCapability,
    requiredResources: ["files", "tests"],
    target: "workspace",
    boundaryPaths: ["src/features/tasks"],
  };
}

function completeSubtask(
  tasks: ReturnType<typeof createTaskService>,
  taskId: string,
  subtaskId: string,
): void {
  const attempt = tasks.routeSubtask(taskId, subtaskId, [reviewer], [assessment("reviewer")]);
  assert.ok("attemptId" in attempt);
  tasks.startAssignment(taskId, attempt.attemptId);
  tasks.completeAssignment(taskId, attempt.attemptId);
}

function sequenceIdentity(): () => string {
  let next = 0;
  return () => `generated-${++next}`;
}
