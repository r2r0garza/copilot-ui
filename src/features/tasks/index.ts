import { createHash, randomUUID } from "node:crypto";

export type TaskState =
  | "admitting"
  | "queued"
  | "preparing"
  | "running"
  | "waiting-for-routing"
  | "verifying"
  | "externally-blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SubtaskState =
  | "pending"
  | "ready"
  | "running"
  | "waiting-for-routing"
  | "succeeded"
  | "failed"
  | "superseded"
  | "cancelled";

export type AssignmentAttemptState =
  | "selected"
  | "running"
  | "succeeded"
  | "declined"
  | "failed"
  | "interrupted"
  | "outcome-unknown"
  | "cancelled";

export interface TaskContractInput {
  readonly goal: string;
  readonly successCriteria: readonly string[];
  readonly scope: readonly string[];
  readonly safetyConstraints: readonly string[];
  readonly preferences: {
    readonly agentIdentities: readonly string[];
    readonly modelIds: readonly string[];
  };
  readonly repositoryBoundary: {
    readonly repositoryRoot: string;
    readonly allowedPaths: readonly string[];
  };
  readonly authority: {
    readonly capabilities: readonly string[];
  };
}

export interface TaskContractVersion extends TaskContractInput {
  readonly taskId: string;
  readonly version: number;
  readonly confirmationHash: string;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export interface CreateTaskInput extends TaskContractInput {
  readonly taskId?: string;
}

export interface AgentCandidate {
  readonly identity: string;
  readonly description: string;
  readonly origin: "repository" | "bundled";
  readonly delegationAuthorized: boolean;
  readonly invocationAllowed: boolean;
  readonly valid: boolean;
  readonly available: boolean;
  readonly targets: readonly string[];
  readonly resources: readonly string[];
}

export interface SemanticAssessment {
  readonly agentIdentity: string;
  readonly suitable: boolean;
  readonly specificity: number;
  readonly rationale: string;
}

export interface SubtaskInput {
  readonly subtaskId?: string;
  readonly objective: string;
  readonly required: boolean;
  readonly writeCapability: "read-only" | "write-capable";
  readonly requiredResources: readonly string[];
  readonly target: string;
  readonly boundaryPaths: readonly string[];
}

export interface SubtaskRecord extends SubtaskInput {
  readonly subtaskId: string;
  readonly state: SubtaskState;
  readonly createdRevision: number;
}

export interface GraphEdge {
  readonly prerequisiteSubtaskId: string;
  readonly dependentSubtaskId: string;
}

export interface GraphRevision {
  readonly revision: number;
  readonly appendedSubtaskIds: readonly string[];
  readonly appendedEdges: readonly GraphEdge[];
  readonly supersededSubtaskIds: readonly string[];
  readonly reason: string;
  readonly createdAt: string;
}

export interface ResourceSnapshot {
  readonly snapshotId: string;
  readonly agentIdentity: string;
  readonly agentDescription: string;
  readonly resources: readonly string[];
  readonly capturedAt: string;
}

export interface RoutingCandidateRecord {
  readonly agentIdentity: string;
  readonly eligible: boolean;
  readonly suitable: boolean;
  readonly specificity: number;
  readonly resourceFit: number;
  readonly origin: AgentCandidate["origin"];
  readonly rejectionReasons: readonly string[];
  readonly rationale: string | null;
}

export interface AssignmentAttempt {
  readonly attemptId: string;
  readonly subtaskId: string;
  readonly ordinal: number;
  readonly state: AssignmentAttemptState;
  readonly agentIdentity: string;
  readonly writeCapability: SubtaskInput["writeCapability"];
  readonly resourceSnapshot: ResourceSnapshot;
  readonly candidates: readonly RoutingCandidateRecord[];
  readonly rationale: string;
  readonly override: boolean;
  readonly rerouteOrdinal: 0 | 1;
  readonly declineReason: string | null;
  readonly unmetRequirements: readonly string[];
  readonly createdAt: string;
  readonly terminalAt: string | null;
}

export interface RoutingGap {
  readonly subtaskId: string;
  readonly requiredResources: readonly string[];
  readonly consideredCandidates: readonly RoutingCandidateRecord[];
  readonly createdAt: string;
}

export interface AgentUpdateProposal {
  readonly agentIdentity: string;
  readonly mismatchSignature: string;
  readonly overrideCount: number;
  readonly status: "open" | "approved" | "rejected";
  readonly createdAt: string;
}

export interface CompletionCheck {
  readonly ordinal: number;
  readonly passed: boolean;
  readonly gaps: readonly string[];
  readonly repairCycle: number;
  readonly checkedAt: string;
}

export interface TaskRecord {
  readonly taskId: string;
  readonly state: TaskState;
  readonly contractVersions: readonly TaskContractVersion[];
  readonly confirmedContractVersion: number | null;
  readonly subtasks: readonly SubtaskRecord[];
  readonly edges: readonly GraphEdge[];
  readonly graphRevisions: readonly GraphRevision[];
  readonly assignmentAttempts: readonly AssignmentAttempt[];
  readonly routingGaps: readonly RoutingGap[];
  readonly agentUpdateProposals: readonly AgentUpdateProposal[];
  readonly completionChecks: readonly CompletionCheck[];
  readonly repairCycles: number;
  readonly unresolvedDependencies: readonly string[];
  readonly unresolvedOperations: readonly string[];
  readonly ownsActiveTaskSlot: boolean;
  readonly ownsRepositoryWriteLock: boolean;
  readonly submissionOrdinal: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskSnapshotPersistence {
  loadTaskSnapshots(): readonly TaskRecord[];
  saveTaskSnapshot(task: TaskRecord, eventName: string, at: string): void;
  repositoryWriteLockHolder(): string | undefined;
  acquireRepositoryWriteLock(holderId: string, now?: string): boolean;
  releaseRepositoryWriteLock(holderId: string, now?: string): boolean;
}

export interface TaskService {
  createDraft(input: CreateTaskInput, now?: string): TaskRecord;
  reviseContract(taskId: string, input: TaskContractInput, now?: string): TaskContractVersion;
  confirmContract(taskId: string, version: number, confirmationHash: string, now?: string): TaskRecord;
  getTask(taskId: string): TaskRecord | undefined;
  listTasks(): readonly TaskRecord[];
  startTask(taskId: string, now?: string): TaskRecord;
  appendGraphRevision(
    taskId: string,
    input: {
      readonly subtasks?: readonly SubtaskInput[];
      readonly edges?: readonly GraphEdge[];
      readonly supersedeSubtaskIds?: readonly string[];
      readonly reason: string;
    },
    now?: string,
  ): TaskRecord;
  routeSubtask(
    taskId: string,
    subtaskId: string,
    agents: readonly AgentCandidate[],
    assessments: readonly SemanticAssessment[],
    now?: string,
  ): AssignmentAttempt | RoutingGap;
  overrideRouting(
    taskId: string,
    subtaskId: string,
    agentIdentity: string,
    agents: readonly AgentCandidate[],
    mismatchSignature: string,
    rationale: string,
    now?: string,
  ): AssignmentAttempt;
  resolveAgentUpdateProposal(
    taskId: string,
    agentIdentity: string,
    mismatchSignature: string,
    decision: "approved" | "rejected",
    now?: string,
  ): TaskRecord;
  startAssignment(taskId: string, attemptId: string, now?: string): AssignmentAttempt;
  completeAssignment(taskId: string, attemptId: string, now?: string): AssignmentAttempt;
  declineAssignment(
    taskId: string,
    attemptId: string,
    reason: string,
    unmetRequirements: readonly string[],
    agents: readonly AgentCandidate[],
    assessments: readonly SemanticAssessment[],
    now?: string,
  ): AssignmentAttempt | RoutingGap;
  setUnresolvedDependencies(taskId: string, dependencyIds: readonly string[], now?: string): TaskRecord;
  setUnresolvedOperations(taskId: string, operationIds: readonly string[], now?: string): TaskRecord;
  runCompletionCheck(
    taskId: string,
    result: {
      readonly passed: boolean;
      readonly gaps: readonly string[];
      readonly repairSubtasks?: readonly SubtaskInput[];
      readonly repairEdges?: readonly GraphEdge[];
    },
    now?: string,
  ): TaskRecord;
}

export function taskContractConfirmationHash(contract: TaskContractInput, version: number): string {
  return createHash("sha256").update(canonicalJson({ ...normalizeContract(contract), version })).digest("hex");
}

export function createTaskService(options: {
  readonly persistence?: TaskSnapshotPersistence;
  readonly identity?: () => string;
} = {}): TaskService {
  return new DefaultTaskService(options.persistence ?? new MemoryTaskPersistence(), options.identity ?? randomUUID);
}

class DefaultTaskService implements TaskService {
  private readonly tasks = new Map<string, MutableTaskRecord>();

  public constructor(
    private readonly persistence: TaskSnapshotPersistence,
    private readonly nextIdentity: () => string,
  ) {
    for (const task of persistence.loadTaskSnapshots()) {
      this.tasks.set(task.taskId, cloneTask(task));
    }
  }

  public createDraft(input: CreateTaskInput, now = new Date().toISOString()): TaskRecord {
    const taskId = input.taskId?.trim() || this.nextIdentity();
    if (this.tasks.has(taskId)) throw new Error("task-already-exists");
    const normalized = normalizeContract(input);
    const version = contractVersion(taskId, 1, normalized, now);
    const task: MutableTaskRecord = {
      taskId,
      state: "admitting",
      contractVersions: [version],
      confirmedContractVersion: null,
      subtasks: [],
      edges: [],
      graphRevisions: [],
      assignmentAttempts: [],
      routingGaps: [],
      agentUpdateProposals: [],
      completionChecks: [],
      repairCycles: 0,
      unresolvedDependencies: [],
      unresolvedOperations: [],
      ownsActiveTaskSlot: false,
      ownsRepositoryWriteLock: false,
      submissionOrdinal: this.tasks.size + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.persist(task, "task.contract-drafted", now);
    return cloneTask(task);
  }

  public reviseContract(taskId: string, input: TaskContractInput, now = new Date().toISOString()): TaskContractVersion {
    const task = this.requireTask(taskId);
    if (task.state !== "admitting") throw new Error("task-contract-revision-requires-admitting");
    const version = contractVersion(taskId, task.contractVersions.length + 1, normalizeContract(input), now);
    task.contractVersions.push(version);
    this.persist(task, "task.contract-revised", now);
    return { ...version };
  }

  public confirmContract(taskId: string, version: number, confirmationHash: string, now = new Date().toISOString()): TaskRecord {
    const task = this.requireTask(taskId);
    if (task.state !== "admitting") throw new Error("task-not-admitting");
    const contract = task.contractVersions.find((candidate) => candidate.version === version);
    if (!contract || contract !== task.contractVersions.at(-1)) throw new Error("task-contract-version-not-current");
    if (contract.confirmationHash !== confirmationHash) throw new Error("task-contract-confirmation-mismatch");
    task.contractVersions[task.contractVersions.length - 1] = { ...contract, confirmedAt: now };
    task.confirmedContractVersion = version;
    task.state = "queued";
    this.persist(task, "task.admitted", now);
    return cloneTask(task);
  }

  public getTask(taskId: string): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  public listTasks(): readonly TaskRecord[] {
    return [...this.tasks.values()]
      .sort((left, right) => left.submissionOrdinal - right.submissionOrdinal)
      .map(cloneTask);
  }

  public startTask(taskId: string, now = new Date().toISOString()): TaskRecord {
    const task = this.requireTask(taskId);
    if (task.state !== "queued") throw new Error("task-not-queued");
    if (task.confirmedContractVersion === null) throw new Error("task-contract-not-confirmed");
    if (task.unresolvedDependencies.length) throw new Error("task-dependencies-unresolved");
    if ([...this.tasks.values()].some((candidate) => candidate.ownsActiveTaskSlot)) {
      throw new Error("active-task-slot-unavailable");
    }
    task.ownsActiveTaskSlot = true;
    task.state = "preparing";
    if (!this.persistence.acquireRepositoryWriteLock(task.taskId, now)) {
      task.ownsActiveTaskSlot = false;
      task.state = "queued";
      throw new Error("repository-write-lock-unavailable");
    }
    task.ownsRepositoryWriteLock = true;
    task.state = "running";
    this.persist(task, "task.execution-started", now);
    return cloneTask(task);
  }

  public appendGraphRevision(
    taskId: string,
    input: {
      readonly subtasks?: readonly SubtaskInput[];
      readonly edges?: readonly GraphEdge[];
      readonly supersedeSubtaskIds?: readonly string[];
      readonly reason: string;
    },
    now = new Date().toISOString(),
  ): TaskRecord {
    const task = this.requireTask(taskId);
    if (!["running", "verifying"].includes(task.state)) throw new Error("task-graph-revision-not-allowed");
    const reason = requiredText(input.reason, "graph-revision-reason");
    const contract = confirmedContract(task);
    const revision = task.graphRevisions.length + 1;
    const appended = (input.subtasks ?? []).map((candidate) => {
      const subtaskId = candidate.subtaskId?.trim() || this.nextIdentity();
      if (task.subtasks.some((existing) => existing.subtaskId === subtaskId)) throw new Error("subtask-already-exists");
      validateSubtask(candidate, contract);
      return {
        ...normalizeSubtask(candidate),
        subtaskId,
        state: "pending" as SubtaskState,
        createdRevision: revision,
      };
    });
    const knownIds = new Set([...task.subtasks, ...appended].map((subtask) => subtask.subtaskId));
    const edges = (input.edges ?? []).map(normalizeEdge);
    for (const edge of edges) {
      if (!knownIds.has(edge.prerequisiteSubtaskId) || !knownIds.has(edge.dependentSubtaskId)) {
        throw new Error("subtask-edge-node-not-found");
      }
      if (edge.prerequisiteSubtaskId === edge.dependentSubtaskId) throw new Error("subtask-graph-cycle");
    }
    const superseded = uniqueStrings(input.supersedeSubtaskIds ?? []);
    for (const subtaskId of superseded) {
      const subtask = task.subtasks.find((candidate) => candidate.subtaskId === subtaskId);
      if (!subtask) throw new Error("subtask-not-found");
      if (subtask.state !== "pending" && subtask.state !== "ready") {
        throw new Error("subtask-history-immutable");
      }
    }
    const prospectiveEdges = dedupeEdges([...task.edges, ...edges]);
    if (hasCycle(knownIds, prospectiveEdges)) throw new Error("subtask-graph-cycle");

    task.subtasks.push(...appended);
    task.edges = prospectiveEdges;
    for (const subtaskId of superseded) {
      const index = task.subtasks.findIndex((candidate) => candidate.subtaskId === subtaskId);
      task.subtasks[index] = { ...task.subtasks[index]!, state: "superseded" };
    }
    task.graphRevisions.push({
      revision,
      appendedSubtaskIds: appended.map((subtask) => subtask.subtaskId),
      appendedEdges: edges,
      supersededSubtaskIds: superseded,
      reason,
      createdAt: now,
    });
    refreshReadiness(task);
    this.persist(task, "task.graph-revised", now);
    return cloneTask(task);
  }

  public routeSubtask(
    taskId: string,
    subtaskId: string,
    agents: readonly AgentCandidate[],
    assessments: readonly SemanticAssessment[],
    now = new Date().toISOString(),
  ): AssignmentAttempt | RoutingGap {
    const task = this.requireTask(taskId);
    return this.route(task, subtaskId, agents, assessments, false, null, null, now);
  }

  public overrideRouting(
    taskId: string,
    subtaskId: string,
    agentIdentity: string,
    agents: readonly AgentCandidate[],
    mismatchSignature: string,
    rationale: string,
    now = new Date().toISOString(),
  ): AssignmentAttempt {
    const task = this.requireTask(taskId);
    const agent = agents.find((candidate) => candidate.identity === agentIdentity);
    const subtask = requireSubtask(task, subtaskId);
    if (!agent) throw new Error("routing-agent-not-found");
    const eligibility = eligibilityFor(agent, subtask);
    if (eligibility.length) throw new Error("routing-override-agent-ineligible");
    const signature = requiredText(mismatchSignature, "routing-mismatch-signature");
    const fitRationale = requiredText(rationale, "routing-rationale");
    this.resumeFromRoutingWait(task, now);
    const attempt = this.selectAttempt(task, subtask, agents, agent, [], fitRationale, true, now);
    const priorCount = task.assignmentAttempts.filter((candidate) =>
      candidate.override && candidate.agentIdentity === agentIdentity &&
      overrideSignature(candidate.rationale) === signature,
    ).length;
    // Embed a normalized signature in the immutable rationale without exposing a separate mutable rule.
    const attemptIndex = task.assignmentAttempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
    task.assignmentAttempts[attemptIndex] = {
      ...task.assignmentAttempts[attemptIndex]!,
      rationale: `${fitRationale} [override:${signature}]`,
    };
    if (priorCount + 1 === 3 && !task.agentUpdateProposals.some((proposal) =>
      proposal.agentIdentity === agentIdentity && proposal.mismatchSignature === signature && proposal.status === "open",
    )) {
      task.agentUpdateProposals.push({
        agentIdentity,
        mismatchSignature: signature,
        overrideCount: 3,
        status: "open",
        createdAt: now,
      });
    }
    this.persist(task, "assignment.override-selected", now);
    return cloneAttempt(task.assignmentAttempts[attemptIndex]!);
  }

  public resolveAgentUpdateProposal(
    taskId: string,
    agentIdentity: string,
    mismatchSignature: string,
    decision: "approved" | "rejected",
    now = new Date().toISOString(),
  ): TaskRecord {
    const task = this.requireTask(taskId);
    const index = task.agentUpdateProposals.findIndex((proposal) =>
      proposal.agentIdentity === agentIdentity &&
      proposal.mismatchSignature === mismatchSignature &&
      proposal.status === "open",
    );
    if (index < 0) throw new Error("agent-update-proposal-not-found");
    task.agentUpdateProposals[index] = { ...task.agentUpdateProposals[index]!, status: decision };
    this.persist(task, "routing.agent-update-proposal-resolved", now);
    return cloneTask(task);
  }

  public startAssignment(taskId: string, attemptId: string, now = new Date().toISOString()): AssignmentAttempt {
    const task = this.requireTask(taskId);
    const attempt = requireAttempt(task, attemptId);
    if (attempt.state !== "selected") throw new Error("assignment-not-selected");
    this.replaceAttempt(task, { ...attempt, state: "running" });
    this.persist(task, "assignment.started", now);
    return cloneAttempt(requireAttempt(task, attemptId));
  }

  public completeAssignment(taskId: string, attemptId: string, now = new Date().toISOString()): AssignmentAttempt {
    const task = this.requireTask(taskId);
    const attempt = requireAttempt(task, attemptId);
    if (attempt.state !== "running") throw new Error("assignment-not-running");
    this.replaceAttempt(task, { ...attempt, state: "succeeded", terminalAt: now });
    const subtask = requireSubtask(task, attempt.subtaskId);
    this.replaceSubtask(task, { ...subtask, state: "succeeded" });
    refreshReadiness(task);
    this.persist(task, "assignment.succeeded", now);
    return cloneAttempt(requireAttempt(task, attemptId));
  }

  public declineAssignment(
    taskId: string,
    attemptId: string,
    reason: string,
    unmetRequirements: readonly string[],
    agents: readonly AgentCandidate[],
    assessments: readonly SemanticAssessment[],
    now = new Date().toISOString(),
  ): AssignmentAttempt | RoutingGap {
    const task = this.requireTask(taskId);
    const attempt = requireAttempt(task, attemptId);
    if (attempt.state !== "selected" && attempt.state !== "running") throw new Error("assignment-not-declinable");
    const declineReason = requiredText(reason, "assignment-decline-reason");
    const requirements = requiredStringList(unmetRequirements, "assignment-unmet-requirements");
    this.replaceAttempt(task, {
      ...attempt,
      state: "declined",
      declineReason,
      unmetRequirements: requirements,
      terminalAt: now,
    });
    const subtask = requireSubtask(task, attempt.subtaskId);
    if (attempt.rerouteOrdinal === 1) {
      return this.enterRoutingGap(task, subtask, [], now);
    }
    const remainingAgents = agents.filter((agent) => agent.identity !== attempt.agentIdentity);
    const remainingAssessments = assessments.filter((assessment) => assessment.agentIdentity !== attempt.agentIdentity);
    this.persist(task, "assignment.declined", now);
    return this.route(task, subtask.subtaskId, remainingAgents, remainingAssessments, false, null, 1, now);
  }

  public setUnresolvedDependencies(taskId: string, dependencyIds: readonly string[], now = new Date().toISOString()): TaskRecord {
    const task = this.requireTask(taskId);
    task.unresolvedDependencies = uniqueStrings(dependencyIds);
    this.persist(task, "task.dependencies-updated", now);
    return cloneTask(task);
  }

  public setUnresolvedOperations(taskId: string, operationIds: readonly string[], now = new Date().toISOString()): TaskRecord {
    const task = this.requireTask(taskId);
    task.unresolvedOperations = uniqueStrings(operationIds);
    this.persist(task, "task.operations-updated", now);
    return cloneTask(task);
  }

  public runCompletionCheck(
    taskId: string,
    result: {
      readonly passed: boolean;
      readonly gaps: readonly string[];
      readonly repairSubtasks?: readonly SubtaskInput[];
      readonly repairEdges?: readonly GraphEdge[];
    },
    now = new Date().toISOString(),
  ): TaskRecord {
    const task = this.requireTask(taskId);
    const original = cloneTask(task);
    if (task.state !== "running" && task.state !== "verifying") throw new Error("task-not-completable");
    if (task.subtasks.some((subtask) => subtask.required && subtask.state !== "succeeded")) {
      throw new Error("task-required-subtasks-incomplete");
    }
    if (task.unresolvedDependencies.length) throw new Error("task-dependencies-unresolved");
    if (task.unresolvedOperations.length) throw new Error("task-operations-unresolved");
    if (task.assignmentAttempts.some((attempt) => !terminalAttemptStates.has(attempt.state))) {
      throw new Error("task-assignments-active");
    }
    task.state = "verifying";
    const gaps = result.passed ? [] : requiredStringList(result.gaps, "completion-gaps");
    const repairCycle = result.passed ? task.repairCycles : task.repairCycles + 1;
    task.completionChecks.push({
      ordinal: task.completionChecks.length + 1,
      passed: result.passed,
      gaps,
      repairCycle,
      checkedAt: now,
    });
    if (result.passed) {
      this.releaseTaskLeases(task, now);
      task.state = "succeeded";
      this.persist(task, "task.succeeded", now);
      return cloneTask(task);
    }
    task.repairCycles = repairCycle;
    if (repairCycle >= 3) {
      this.releaseRepositoryLock(task, now);
      task.state = "externally-blocked";
      this.persist(task, "task.completion-intervention-required", now);
      return cloneTask(task);
    }
    if (!(result.repairSubtasks?.length)) throw new Error("completion-repair-subtasks-required");
    task.state = "running";
    try {
      this.appendGraphRevision(taskId, {
        subtasks: result.repairSubtasks,
        edges: result.repairEdges,
        reason: `Completion repair cycle ${repairCycle}: ${gaps.join("; ")}`,
      }, now);
    } catch (error) {
      this.tasks.set(taskId, original);
      throw error;
    }
    this.persist(task, "task.repair-cycle-started", now);
    return cloneTask(task);
  }

  private route(
    task: MutableTaskRecord,
    subtaskId: string,
    agents: readonly AgentCandidate[],
    assessments: readonly SemanticAssessment[],
    override: boolean,
    overrideAgentIdentity: string | null,
    rerouteOrdinal: 0 | 1 | null,
    now: string,
  ): AssignmentAttempt | RoutingGap {
    if (task.state !== "running" && task.state !== "waiting-for-routing") throw new Error("task-not-running");
    const subtask = requireSubtask(task, subtaskId);
    if (subtask.state !== "ready" && subtask.state !== "running" && subtask.state !== "waiting-for-routing") {
      throw new Error("subtask-not-routable");
    }
    const assessmentMap = new Map(assessments.map((assessment) => [assessment.agentIdentity, assessment]));
    const candidateRecords = agents.map((agent) => candidateRecord(agent, subtask, assessmentMap.get(agent.identity)));
    const eligibleSuitable = agents.filter((agent) => {
      const record = candidateRecords.find((candidate) => candidate.agentIdentity === agent.identity);
      return record?.eligible && (override ? agent.identity === overrideAgentIdentity : record.suitable);
    });
    if (!eligibleSuitable.length) return this.enterRoutingGap(task, subtask, candidateRecords, now);
    eligibleSuitable.sort((left, right) => compareAgents(
      left,
      right,
      candidateRecords,
    ));
    const chosen = eligibleSuitable[0]!;
    const assessment = assessmentMap.get(chosen.identity);
    const rationale = override
      ? requiredText(assessment?.rationale ?? "User selected an eligible Agent for this attempt.", "routing-rationale")
      : requiredText(assessment?.rationale ?? "", "routing-rationale");
    this.resumeFromRoutingWait(task, now);
    const attempt = this.selectAttempt(
      task,
      subtask,
      agents,
      chosen,
      candidateRecords,
      rationale,
      override,
      now,
      rerouteOrdinal ?? 0,
    );
    this.persist(task, override ? "assignment.override-selected" : "assignment.selected", now);
    return attempt;
  }

  private resumeFromRoutingWait(task: MutableTaskRecord, now: string): void {
    if (task.state !== "waiting-for-routing") return;
    if (!task.ownsActiveTaskSlot) throw new Error("active-task-slot-not-owned");
    if (!this.persistence.acquireRepositoryWriteLock(task.taskId, now)) {
      throw new Error("repository-write-lock-unavailable");
    }
    task.ownsRepositoryWriteLock = true;
    task.state = "running";
  }

  private selectAttempt(
    task: MutableTaskRecord,
    subtask: SubtaskRecord,
    agents: readonly AgentCandidate[],
    chosen: AgentCandidate,
    candidates: readonly RoutingCandidateRecord[],
    rationale: string,
    override: boolean,
    now: string,
    rerouteOrdinal: 0 | 1 = 0,
  ): AssignmentAttempt {
    reserveCapacity(task, subtask.writeCapability);
    const snapshotPayload = {
      agentIdentity: chosen.identity,
      agentDescription: chosen.description,
      resources: [...chosen.resources].sort(),
      capturedAt: now,
    };
    const snapshot: ResourceSnapshot = {
      snapshotId: createHash("sha256").update(canonicalJson(snapshotPayload)).digest("hex"),
      ...snapshotPayload,
    };
    const attempt: AssignmentAttempt = {
      attemptId: this.nextIdentity(),
      subtaskId: subtask.subtaskId,
      ordinal: task.assignmentAttempts.filter((candidate) => candidate.subtaskId === subtask.subtaskId).length + 1,
      state: "selected",
      agentIdentity: chosen.identity,
      writeCapability: subtask.writeCapability,
      resourceSnapshot: snapshot,
      candidates: candidates.length ? candidates : agents.map((agent) => candidateRecord(agent, subtask, undefined)),
      rationale,
      override,
      rerouteOrdinal,
      declineReason: null,
      unmetRequirements: [],
      createdAt: now,
      terminalAt: null,
    };
    task.assignmentAttempts.push(attempt);
    this.replaceSubtask(task, { ...subtask, state: "running" });
    task.routingGaps = task.routingGaps.filter((gap) => gap.subtaskId !== subtask.subtaskId);
    return cloneAttempt(attempt);
  }

  private enterRoutingGap(
    task: MutableTaskRecord,
    subtask: SubtaskRecord,
    candidates: readonly RoutingCandidateRecord[],
    now: string,
  ): RoutingGap {
    const gap: RoutingGap = {
      subtaskId: subtask.subtaskId,
      requiredResources: [...subtask.requiredResources],
      consideredCandidates: candidates,
      createdAt: now,
    };
    task.routingGaps.push(gap);
    this.replaceSubtask(task, { ...subtask, state: "waiting-for-routing" });
    task.state = "waiting-for-routing";
    this.releaseRepositoryLock(task, now);
    this.persist(task, "task.waiting-for-routing", now);
    return cloneGap(gap);
  }

  private releaseRepositoryLock(task: MutableTaskRecord, now: string): void {
    if (task.ownsRepositoryWriteLock) {
      if (!this.persistence.releaseRepositoryWriteLock(task.taskId, now)) {
        throw new Error("repository-write-lock-release-failed");
      }
      task.ownsRepositoryWriteLock = false;
    }
  }

  private releaseTaskLeases(task: MutableTaskRecord, now: string): void {
    this.releaseRepositoryLock(task, now);
    task.ownsActiveTaskSlot = false;
  }

  private replaceAttempt(task: MutableTaskRecord, replacement: AssignmentAttempt): void {
    const index = task.assignmentAttempts.findIndex((candidate) => candidate.attemptId === replacement.attemptId);
    if (index < 0) throw new Error("assignment-attempt-not-found");
    task.assignmentAttempts[index] = replacement;
  }

  private replaceSubtask(task: MutableTaskRecord, replacement: SubtaskRecord): void {
    const index = task.subtasks.findIndex((candidate) => candidate.subtaskId === replacement.subtaskId);
    if (index < 0) throw new Error("subtask-not-found");
    task.subtasks[index] = replacement;
  }

  private requireTask(taskId: string): MutableTaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("task-not-found");
    return task;
  }

  private persist(task: MutableTaskRecord, eventName: string, now: string): void {
    task.updatedAt = now;
    this.persistence.saveTaskSnapshot(cloneTask(task), eventName, now);
  }
}

class MemoryTaskPersistence implements TaskSnapshotPersistence {
  private readonly tasks = new Map<string, TaskRecord>();
  private lockHolder: string | undefined;

  public loadTaskSnapshots(): readonly TaskRecord[] {
    return [...this.tasks.values()].map(cloneTask);
  }

  public saveTaskSnapshot(task: TaskRecord): void {
    this.tasks.set(task.taskId, cloneTask(task));
  }

  public repositoryWriteLockHolder(): string | undefined {
    return this.lockHolder;
  }

  public acquireRepositoryWriteLock(holderId: string): boolean {
    if (this.lockHolder !== undefined) return false;
    this.lockHolder = holderId;
    return true;
  }

  public releaseRepositoryWriteLock(holderId: string): boolean {
    if (this.lockHolder !== holderId) return false;
    this.lockHolder = undefined;
    return true;
  }
}

type MutableTaskRecord = {
  -readonly [Key in keyof TaskRecord]: TaskRecord[Key] extends readonly (infer Item)[]
    ? Item[]
    : TaskRecord[Key];
};

const terminalAttemptStates = new Set<AssignmentAttemptState>([
  "succeeded",
  "declined",
  "failed",
  "interrupted",
  "outcome-unknown",
  "cancelled",
]);

function normalizeContract(input: TaskContractInput): TaskContractInput {
  const goal = requiredText(input.goal, "task-goal");
  const successCriteria = requiredStringList(input.successCriteria, "task-success-criteria");
  const scope = requiredStringList(input.scope, "task-scope");
  const safetyConstraints = requiredStringList(input.safetyConstraints, "task-safety-constraints");
  const repositoryRoot = requiredText(input.repositoryBoundary.repositoryRoot, "task-repository-root");
  const allowedPaths = requiredStringList(input.repositoryBoundary.allowedPaths, "task-allowed-paths");
  if (allowedPaths.some((path) => path.startsWith("/") || path.split("/").includes(".."))) {
    throw new Error("task-repository-boundary-invalid");
  }
  return {
    goal,
    successCriteria,
    scope,
    safetyConstraints,
    preferences: {
      agentIdentities: uniqueStrings(input.preferences.agentIdentities),
      modelIds: uniqueStrings(input.preferences.modelIds),
    },
    repositoryBoundary: { repositoryRoot, allowedPaths },
    authority: { capabilities: uniqueStrings(input.authority.capabilities) },
  };
}

function contractVersion(taskId: string, version: number, input: TaskContractInput, now: string): TaskContractVersion {
  return {
    taskId,
    version,
    ...input,
    confirmationHash: taskContractConfirmationHash(input, version),
    createdAt: now,
    confirmedAt: null,
  };
}

function confirmedContract(task: TaskRecord): TaskContractVersion {
  const contract = task.contractVersions.find((candidate) => candidate.version === task.confirmedContractVersion);
  if (!contract?.confirmedAt) throw new Error("task-contract-not-confirmed");
  return contract;
}

function normalizeSubtask(input: SubtaskInput): SubtaskInput {
  return {
    ...input,
    objective: requiredText(input.objective, "subtask-objective"),
    requiredResources: uniqueStrings(input.requiredResources),
    target: requiredText(input.target, "subtask-target"),
    boundaryPaths: requiredStringList(input.boundaryPaths, "subtask-boundary-paths"),
  };
}

function validateSubtask(input: SubtaskInput, contract: TaskContractVersion): void {
  const subtask = normalizeSubtask(input);
  for (const path of subtask.boundaryPaths) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("subtask-boundary-invalid");
    if (!contract.repositoryBoundary.allowedPaths.some((allowed) => withinPath(path, allowed))) {
      throw new Error("subtask-outside-task-contract-boundary");
    }
  }
}

function withinPath(path: string, allowed: string): boolean {
  if (allowed === ".") return true;
  const normalizedAllowed = allowed.replace(/\/+$/, "");
  return path === normalizedAllowed || path.startsWith(`${normalizedAllowed}/`);
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
  return {
    prerequisiteSubtaskId: requiredText(edge.prerequisiteSubtaskId, "prerequisite-subtask-id"),
    dependentSubtaskId: requiredText(edge.dependentSubtaskId, "dependent-subtask-id"),
  };
}

function dedupeEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.prerequisiteSubtaskId}\0${edge.dependentSubtaskId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasCycle(ids: ReadonlySet<string>, edges: readonly GraphEdge[]): boolean {
  const adjacency = new Map([...ids].map((id) => [id, [] as string[]]));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  for (const edge of edges) {
    adjacency.get(edge.prerequisiteSubtaskId)?.push(edge.dependentSubtaskId);
    indegree.set(edge.dependentSubtaskId, (indegree.get(edge.dependentSubtaskId) ?? 0) + 1);
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const dependent of adjacency.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  return visited !== ids.size;
}

function refreshReadiness(task: MutableTaskRecord): void {
  const states = new Map(task.subtasks.map((subtask) => [subtask.subtaskId, subtask.state]));
  task.subtasks = task.subtasks.map((subtask) => {
    if (subtask.state !== "pending" && subtask.state !== "ready") return subtask;
    const prerequisites = task.edges
      .filter((edge) => edge.dependentSubtaskId === subtask.subtaskId)
      .map((edge) => edge.prerequisiteSubtaskId);
    const ready = prerequisites.every((id) => states.get(id) === "succeeded");
    return { ...subtask, state: ready ? "ready" : "pending" };
  });
}

function eligibilityFor(agent: AgentCandidate, subtask: SubtaskRecord): string[] {
  const reasons: string[] = [];
  if (!agent.delegationAuthorized) reasons.push("delegation-not-authorized");
  if (!agent.invocationAllowed) reasons.push("invocation-not-allowed");
  if (!agent.valid) reasons.push("manifest-invalid");
  if (!agent.available) reasons.push("agent-unavailable");
  if (!agent.targets.includes(subtask.target) && !agent.targets.includes("*")) reasons.push("target-unsupported");
  for (const resource of subtask.requiredResources) {
    if (!agent.resources.includes(resource)) reasons.push(`resource-missing:${resource}`);
  }
  return reasons;
}

function candidateRecord(
  agent: AgentCandidate,
  subtask: SubtaskRecord,
  assessment: SemanticAssessment | undefined,
): RoutingCandidateRecord {
  const rejectionReasons = eligibilityFor(agent, subtask);
  const eligible = rejectionReasons.length === 0;
  const suitable = eligible && assessment?.suitable === true && Boolean(assessment.rationale.trim());
  return {
    agentIdentity: agent.identity,
    eligible,
    suitable,
    specificity: suitable ? Math.max(0, assessment?.specificity ?? 0) : 0,
    resourceFit: resourceFit(agent.resources, subtask.requiredResources),
    origin: agent.origin,
    rejectionReasons: suitable || !eligible ? rejectionReasons : ["semantic-objective-not-covered"],
    rationale: assessment?.rationale.trim() || null,
  };
}

function compareAgents(
  left: AgentCandidate,
  right: AgentCandidate,
  records: readonly RoutingCandidateRecord[],
): number {
  const leftRecord = records.find((record) => record.agentIdentity === left.identity)!;
  const rightRecord = records.find((record) => record.agentIdentity === right.identity)!;
  if (leftRecord.specificity !== rightRecord.specificity) return rightRecord.specificity - leftRecord.specificity;
  if (leftRecord.resourceFit !== rightRecord.resourceFit) return rightRecord.resourceFit - leftRecord.resourceFit;
  if (left.origin !== right.origin) return left.origin === "repository" ? -1 : 1;
  return left.identity.localeCompare(right.identity);
}

function resourceFit(available: readonly string[], required: readonly string[]): number {
  if (!required.length) return 1 / (1 + available.length);
  const extras = available.filter((resource) => !required.includes(resource)).length;
  return required.length / (required.length + extras);
}

function reserveCapacity(task: TaskRecord, writeCapability: SubtaskInput["writeCapability"]): void {
  const active = task.assignmentAttempts.filter((attempt) => !terminalAttemptStates.has(attempt.state));
  if (active.length >= 3) throw new Error("assignment-capacity-exhausted");
  if (writeCapability === "write-capable" && active.some((attempt) => attempt.writeCapability === "write-capable")) {
    throw new Error("assignment-writer-capacity-exhausted");
  }
}

function requireSubtask(task: TaskRecord, subtaskId: string): SubtaskRecord {
  const subtask = task.subtasks.find((candidate) => candidate.subtaskId === subtaskId);
  if (!subtask) throw new Error("subtask-not-found");
  return subtask;
}

function requireAttempt(task: TaskRecord, attemptId: string): AssignmentAttempt {
  const attempt = task.assignmentAttempts.find((candidate) => candidate.attemptId === attemptId);
  if (!attempt) throw new Error("assignment-attempt-not-found");
  return attempt;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`${field}-empty`);
  return normalized;
}

function requiredStringList(values: readonly string[], field: string): string[] {
  const normalized = uniqueStrings(values);
  if (!normalized.length) throw new Error(`${field}-empty`);
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function overrideSignature(rationale: string): string | null {
  return rationale.match(/\[override:([^\]]+)\]$/)?.[1] ?? null;
}

function cloneTask(task: TaskRecord): MutableTaskRecord {
  return JSON.parse(JSON.stringify(task)) as MutableTaskRecord;
}

function cloneAttempt(attempt: AssignmentAttempt): AssignmentAttempt {
  return JSON.parse(JSON.stringify(attempt)) as AssignmentAttempt;
}

function cloneGap(gap: RoutingGap): RoutingGap {
  return JSON.parse(JSON.stringify(gap)) as RoutingGap;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
