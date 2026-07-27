import type { EffectClass } from "./policy";

export type DurableOperationState =
  | "intent-recorded"
  | "executing"
  | "retry-wait"
  | "reconciling"
  | "outcome-unknown"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ToolDecisionCode = "allowed" | "denied";
export type ToolOutcomeCode = "applied" | "not-applied" | "failed" | "denied" | "interrupted" | "unknown";
export type ReconciliationClassification = "applied" | "not-applied" | "inconclusive";

export interface RecordToolIntent {
  readonly operationKey: string;
  readonly parentKind: "response-attempt" | "assignment-attempt";
  readonly parentId: string;
  readonly effectClass: EffectClass;
  readonly authorityGrantId: string | null;
  readonly authorityReviewId: string | null;
  readonly resourceSnapshotId: string | null;
  readonly targetFingerprint: string;
  readonly toolIdentity: string;
  readonly decisionCode: ToolDecisionCode;
  readonly input: Readonly<Record<string, unknown>>;
  readonly affectedTargets: readonly string[];
}

export interface DurableOperation {
  readonly operationId: string;
  readonly version: number;
  readonly operationKey: string;
  readonly parentKind: RecordToolIntent["parentKind"];
  readonly parentId: string;
  readonly state: DurableOperationState;
  readonly effectClass: EffectClass;
  readonly intentFingerprint: string;
  readonly authorityGrantId: string | null;
  readonly resourceSnapshotId: string | null;
  readonly targetFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminalAt: string | null;
}

export interface ToolAuditRecord {
  readonly auditId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly toolIdentity: string;
  readonly effectClass: EffectClass;
  readonly authorityReviewId: string | null;
  readonly decisionCode: ToolDecisionCode;
  readonly inputFingerprint: string;
  readonly sanitizedInput: Readonly<Record<string, unknown>>;
  readonly sanitizedResult: Readonly<Record<string, unknown>> | null;
  readonly affectedTargets: readonly string[];
  readonly startedAt: string | null;
  readonly terminalAt: string | null;
  readonly outcomeCode: ToolOutcomeCode | null;
}

export interface OperationExecutionAttempt {
  readonly operationId: string;
  readonly ordinal: number;
  readonly state: "executing" | "known-applied" | "known-not-applied" | "failed" | "cancelled" | "interrupted";
  readonly handoffStartedAt: string;
  readonly finishedAt: string | null;
  readonly sanitizedOutcomeCode: string | null;
}

export interface ReconciliationEvidence {
  readonly evidenceId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly classification: ReconciliationClassification;
  readonly observedAt: string;
}

export interface ToolAuditCorrection {
  readonly correctionId: string;
  readonly auditId: string;
  readonly ordinal: number;
  readonly reasonCode: string;
  readonly sanitizedDelta: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}
