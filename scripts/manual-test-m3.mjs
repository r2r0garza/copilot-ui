import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { WorkspaceStore } from "../out/adapters/sqlite/workspaceStore.js";
import { createTaskService } from "../out/features/tasks/index.js";

const automatic = process.argv.includes("--no-prompt");
const storageDirectory = mkdtempSync(join(tmpdir(), "bridgit-m3-manual-"));
const terminal = automatic ? undefined : createInterface({ input, output });
let generatedIdentity = 0;

const contract = {
  goal: "Manually verify the autonomous Task happy path.",
  successCriteria: [
    "All required Subtasks succeed.",
    "A failed Completion Check creates repair work.",
    "The final Completion Check passes.",
  ],
  scope: ["M3 Task Runtime manual fixture"],
  safetyConstraints: ["Stay inside the synthetic repository boundary."],
  preferences: { agentIdentities: ["repo-reviewer"], modelIds: ["model-a"] },
  repositoryBoundary: { repositoryRoot: "/synthetic/repository", allowedPaths: ["src", "test"] },
  authority: { capabilities: ["repository-read", "repository-write"] },
};

const repositoryAgent = {
  identity: "repo-reviewer",
  description: "Review, implement, and verify TypeScript repository changes.",
  origin: "repository",
  delegationAuthorized: true,
  invocationAllowed: true,
  valid: true,
  available: true,
  targets: ["workspace"],
  resources: ["files", "tests"],
};

const bundledAgent = {
  ...repositoryAgent,
  identity: "bundled-reviewer",
  origin: "bundled",
};

const unavailableAgent = {
  ...repositoryAgent,
  identity: "unavailable-specialist",
  description: "A highly specific but unavailable specialist.",
  available: false,
};

const secondaryAgent = {
  ...repositoryAgent,
  identity: "secondary-reviewer",
  description: "A secondary repository verifier.",
};

let store;

try {
  printHeading("M3 manual test");
  console.log(`Durable fixture: ${storageDirectory}/bridgit.sqlite`);
  console.log("Each PASS line is backed by an explicit state inspection or expected rejection.");

  store = new WorkspaceStore(storageDirectory);
  const tasks = createTaskService({
    persistence: store,
    identity: () => `manual-${++generatedIdentity}`,
  });

  await checkpoint("1. Capture and confirm the exact Task Contract");
  const draft = tasks.createDraft({ ...contract, taskId: "manual-happy-path" });
  observe("Draft stays outside the queue", draft.state, "admitting");
  observe("Repository Boundary is visible", draft.contractVersions[0].repositoryBoundary.allowedPaths.join(", "), "src, test");
  observe("Task authority is fixed and visible", draft.contractVersions[0].authority.capabilities.join(", "), "repository-read, repository-write");
  console.log(`    Contract v1 confirmation hash: ${draft.contractVersions[0].confirmationHash}`);
  expectRejection(
    "An incorrect confirmation hash cannot admit the Task",
    () => tasks.confirmContract(draft.taskId, 1, "incorrect-hash"),
    "task-contract-confirmation-mismatch",
  );
  const admitted = tasks.confirmContract(
    draft.taskId,
    1,
    draft.contractVersions[0].confirmationHash,
  );
  observe("The exact confirmed version enters the queue", admitted.state, "queued");

  await checkpoint("2. Start the Task and acquire its independent leases");
  const running = tasks.startTask(draft.taskId);
  observe("Task enters running", running.state, "running");
  observe("Active Task Slot is owned", running.ownsActiveTaskSlot, true);
  observe("Repository Write Lock is owned", running.ownsRepositoryWriteLock, true);
  observe("SQLite lock holder matches the Task", store.repositoryWriteLockHolder(), draft.taskId);

  await checkpoint("3. Build a success-only DAG and reject a cycle");
  tasks.appendGraphRevision(draft.taskId, {
    subtasks: [
      subtask("read-a", "read-only"),
      subtask("read-b", "read-only"),
      subtask("write-a", "write-capable"),
      subtask("write-b", "write-capable"),
      subtask("write-c", "write-capable"),
    ],
    edges: [{ prerequisiteSubtaskId: "write-a", dependentSubtaskId: "write-b" }],
    reason: "Create the manual success-only graph.",
  });
  observe("Initial graph revision is committed", tasks.getTask(draft.taskId).graphRevisions.length, 1);
  observe("Success dependency keeps write-b pending", stateOf(tasks, draft.taskId, "write-b"), "pending");
  expectRejection(
    "A cyclic revision is side-effect-free",
    () => tasks.appendGraphRevision(draft.taskId, {
      edges: [{ prerequisiteSubtaskId: "write-b", dependentSubtaskId: "write-a" }],
      reason: "Attempt a forbidden cycle.",
    }),
    "subtask-graph-cycle",
  );
  observe("Rejected cycle did not create a revision", tasks.getTask(draft.taskId).graphRevisions.length, 1);

  await checkpoint("4. Route only eligible Agents and enforce capacity");
  const agents = [bundledAgent, unavailableAgent, repositoryAgent];
  const assessments = [
    assessment("bundled-reviewer", 10),
    assessment("unavailable-specialist", 100),
    assessment("repo-reviewer", 10),
  ];
  const writer = tasks.routeSubtask(draft.taskId, "write-a", agents, assessments);
  observe("Unavailable specificity cannot bypass hard eligibility", writer.agentIdentity, "repo-reviewer");
  observe(
    "The ineligible candidate and reason are recorded",
    writer.candidates.find((candidate) => candidate.agentIdentity === "unavailable-specialist").rejectionReasons.join(", "),
    "agent-unavailable",
  );
  console.log(`    Selected rationale: ${writer.rationale}`);
  console.log(`    Resource Snapshot: ${writer.resourceSnapshot.snapshotId}`);
  expectRejection(
    "A second writer cannot reserve capacity",
    () => tasks.routeSubtask(draft.taskId, "write-c", [repositoryAgent], [assessment("repo-reviewer", 10)]),
    "assignment-writer-capacity-exhausted",
  );

  const readerA = tasks.routeSubtask(draft.taskId, "read-a", [repositoryAgent], [assessment("repo-reviewer", 10)]);
  const readerB = tasks.routeSubtask(draft.taskId, "read-b", [repositoryAgent], [assessment("repo-reviewer", 10)]);
  tasks.startAssignment(draft.taskId, writer.attemptId);
  tasks.startAssignment(draft.taskId, readerA.attemptId);
  tasks.startAssignment(draft.taskId, readerB.attemptId);
  observe("Three Assignment Attempts can run concurrently", activeAttemptCount(tasks, draft.taskId), 3);
  expectRejection(
    "A fourth concurrent Attempt is rejected",
    () => tasks.routeSubtask(draft.taskId, "write-c", [repositoryAgent], [assessment("repo-reviewer", 10)]),
    "assignment-capacity-exhausted",
  );

  await checkpoint("5. Complete success dependencies and serialize writers");
  tasks.completeAssignment(draft.taskId, writer.attemptId);
  tasks.completeAssignment(draft.taskId, readerA.attemptId);
  tasks.completeAssignment(draft.taskId, readerB.attemptId);
  observe("Only success unlocks write-b", stateOf(tasks, draft.taskId, "write-b"), "ready");
  completeSubtask(tasks, draft.taskId, "write-b");
  completeSubtask(tasks, draft.taskId, "write-c");
  expectRejection(
    "Completed Subtask history cannot be superseded",
    () => tasks.appendGraphRevision(draft.taskId, {
      supersedeSubtaskIds: ["write-a"],
      reason: "Attempt to rewrite completed history.",
    }),
    "subtask-history-immutable",
  );

  await checkpoint("6. Run a failed Completion Check, repair, and succeed");
  tasks.setUnresolvedOperations(draft.taskId, ["manual-operation"]);
  expectRejection(
    "Unresolved operations block completion",
    () => tasks.runCompletionCheck(draft.taskId, { passed: true, gaps: [] }),
    "task-operations-unresolved",
  );
  tasks.setUnresolvedOperations(draft.taskId, []);
  const repairing = tasks.runCompletionCheck(draft.taskId, {
    passed: false,
    gaps: ["The manual verification artifact is missing."],
    repairSubtasks: [subtask("repair", "write-capable")],
  });
  observe("A concrete gap returns the Task to execution", repairing.state, "running");
  observe("Repair cycle one is recorded", repairing.repairCycles, 1);
  observe("Repair work is appended and ready", stateOf(tasks, draft.taskId, "repair"), "ready");
  completeSubtask(tasks, draft.taskId, "repair");
  const succeeded = tasks.runCompletionCheck(draft.taskId, { passed: true, gaps: [] });
  observe("The repaired Task succeeds", succeeded.state, "succeeded");
  observe("Successful completion releases the write lock", succeeded.ownsRepositoryWriteLock, false);
  observe("Successful completion releases the active slot", succeeded.ownsActiveTaskSlot, false);
  observe("SQLite has no write-lock owner", store.repositoryWriteLockHolder(), undefined);

  await checkpoint("7. Exercise a capability gap, one override, and one reroute");
  const gapDraft = tasks.createDraft({ ...contract, taskId: "manual-routing-path" });
  tasks.confirmContract(gapDraft.taskId, 1, gapDraft.contractVersions[0].confirmationHash);
  tasks.startTask(gapDraft.taskId);
  tasks.appendGraphRevision(gapDraft.taskId, {
    subtasks: [subtask("delegated-check", "read-only")],
    reason: "Create one delegated routing fixture.",
  });
  const gap = tasks.routeSubtask(
    gapDraft.taskId,
    "delegated-check",
    [repositoryAgent],
    [{ ...assessment("repo-reviewer", 0), suitable: false, rationale: "" }],
  );
  observe("No suitable Agent creates a routing gap", "requiredResources" in gap, true);
  observe("Routing wait releases only the write lock", tasks.getTask(gapDraft.taskId).ownsRepositoryWriteLock, false);
  observe("Routing wait retains the active slot", tasks.getTask(gapDraft.taskId).ownsActiveTaskSlot, true);

  const overridden = tasks.overrideRouting(
    gapDraft.taskId,
    "delegated-check",
    repositoryAgent.identity,
    [repositoryAgent],
    "manual-verification-gap",
    "The tester selects this hard-eligible Agent for one Attempt.",
  );
  observe("Override applies to one Attempt", overridden.override, true);
  observe("Resuming routing reacquires the write lock", tasks.getTask(gapDraft.taskId).ownsRepositoryWriteLock, true);
  tasks.startAssignment(gapDraft.taskId, overridden.attemptId);
  const rerouted = tasks.declineAssignment(
    gapDraft.taskId,
    overridden.attemptId,
    "The primary Agent reports an unmet runner requirement.",
    ["specialized runner"],
    [repositoryAgent, secondaryAgent],
    [assessment("repo-reviewer", 10), assessment("secondary-reviewer", 5)],
  );
  observe("One automatic reroute chooses another Agent", rerouted.agentIdentity, "secondary-reviewer");
  observe("The reroute ordinal is bounded to one", rerouted.rerouteOrdinal, 1);
  const secondGap = tasks.declineAssignment(
    gapDraft.taskId,
    rerouted.attemptId,
    "The secondary Agent also lacks the runner.",
    ["specialized runner"],
    [repositoryAgent, secondaryAgent],
    [assessment("repo-reviewer", 10), assessment("secondary-reviewer", 5)],
  );
  observe("A second decline stops in routing wait", "requiredResources" in secondGap, true);
  observe("Both declined Attempts remain in history", tasks.getTask(gapDraft.taskId).assignmentAttempts.length, 2);

  await checkpoint("8. Restart the durable adapter and inspect recovery state");
  store.close();
  store = new WorkspaceStore(storageDirectory);
  const reopenedTasks = createTaskService({ persistence: store });
  observe("Both Tasks reload from SQLite", reopenedTasks.listTasks().length, 2);
  observe("The happy-path Task remains succeeded", reopenedTasks.getTask(draft.taskId).state, "succeeded");
  observe("The routing fixture remains waiting", reopenedTasks.getTask(gapDraft.taskId).state, "waiting-for-routing");
  observe("No stale Repository Write Lock survives the wait", store.repositoryWriteLockHolder(), undefined);

  printHeading("Manual result: PASS");
  console.log("Review the PASS lines above. The durable fixture is intentionally retained at:");
  console.log(`  ${storageDirectory}`);
  console.log("If those observations match your expectations, M3 is ready for GitHub sign-off.");
} catch (error) {
  printHeading("Manual result: FAIL");
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : error);
  process.exitCode = 1;
} finally {
  terminal?.close();
  store?.close();
}

async function checkpoint(title) {
  console.log(`\n${title}`);
  if (!automatic) await terminal.question("  Inspect the expected behavior above, then press Enter to run this section...");
}

function observe(label, actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${format(expected)}, received ${format(actual)}`);
  }
  console.log(`  PASS  ${label}: ${format(actual)}`);
}

function expectRejection(label, action, reason) {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(reason)) {
      console.log(`  PASS  ${label}: rejected with ${error.message}`);
      return;
    }
    throw error;
  }
  throw new Error(`${label}: expected rejection containing ${reason}`);
}

function subtask(subtaskId, writeCapability) {
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

function assessment(agentIdentity, specificity) {
  return {
    agentIdentity,
    suitable: true,
    specificity,
    rationale: `${agentIdentity} directly covers the objective with the required files and tests resources.`,
  };
}

function completeSubtask(tasks, taskId, subtaskId) {
  const attempt = tasks.routeSubtask(taskId, subtaskId, [repositoryAgent], [assessment("repo-reviewer", 10)]);
  tasks.startAssignment(taskId, attempt.attemptId);
  tasks.completeAssignment(taskId, attempt.attemptId);
}

function stateOf(tasks, taskId, subtaskId) {
  return tasks.getTask(taskId).subtasks.find((candidate) => candidate.subtaskId === subtaskId).state;
}

function activeAttemptCount(tasks, taskId) {
  return tasks.getTask(taskId).assignmentAttempts.filter((attempt) =>
    attempt.state === "selected" || attempt.state === "running",
  ).length;
}

function format(value) {
  return value === undefined ? "<none>" : JSON.stringify(value);
}

function printHeading(title) {
  console.log(`\n=== ${title} ===`);
}
