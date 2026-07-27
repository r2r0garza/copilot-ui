import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  authorityGrantFingerprint,
  authorityReviewConfirmationHash,
  normalizeAuthorityScope,
  sanitize,
  validateGrantOwner,
  type AuthorityEffectClass,
  type AuthorityGrant,
  type AuthorityGrantScope,
  type AuthorityOwner,
  type AuthorityReview,
  type AuthorityReviewDecision,
  type CreateAuthorityReview,
  type DurableOperation,
  type OperationExecutionAttempt,
  type ReconciliationClassification,
  type ReconciliationEvidence,
  type RecordToolIntent,
  type ToolAuditCorrection,
  type ToolAuditRecord,
  type ToolOutcomeCode,
} from "../../features/execution-authority";

export interface ArtifactRef { readonly artifactId: string; readonly mediaType: string; readonly byteCount: number; readonly checksum: string; readonly displayLabel: string; }
export interface ChatRecord { readonly chatId: string; readonly title: string; readonly version: number; readonly agentIdentity: string; readonly requestedModelId: string | null; readonly createdAt: string; readonly updatedAt: string; readonly originChatId: string | null; readonly trashedAt: string | null; }
export interface TurnRecord { readonly turnId: string; readonly chatId: string; readonly ordinal: number; readonly content: string; readonly submittedAt: string; }
export type AttemptState = "preparing" | "running" | "waiting-for-approval" | "succeeded" | "blocked" | "failed" | "cancelled" | "interrupted";
export interface ResponseAttemptRecord { readonly attemptId: string; readonly turnId: string; readonly ordinal: number; readonly state: AttemptState; readonly requestedModelId: string | null; readonly effectiveModelId: string | null; readonly snapshotId: string | null; readonly createdAt: string; readonly endedAt: string | null; }
export interface OutputRecord { readonly outputId: string; readonly turnId: string; readonly content: string; readonly createdAt: string; }
export interface EventRecord { readonly sequence: number; readonly name: string; readonly aggregateId: string; readonly payload: string; readonly emittedAt: string; }
export interface LedgerEntry { readonly entryId: string; readonly chatId: string; readonly kind: string; readonly content: string; readonly provenance: string; readonly status: "active" | "superseded" | "disputed"; readonly createdAt: string; }
export interface ResourceSnapshotRecord { readonly snapshotId: string; readonly attemptId: string; readonly content: string; readonly createdAt: string; }
export interface McpTrustRecord { readonly serverIdentity: string; readonly fingerprint: string; readonly version: number; readonly decision: "trusted" | "denied"; readonly decidedAt: string; readonly invalidatedAt: string | null; }

/** M1’s workspace-local authority: state, immutable artifacts, and projection events share SQLite transactions. */
export class WorkspaceStore {
  private readonly db: Database.Database;

  public constructor(storageDirectory: string) {
    mkdirSync(storageDirectory, { recursive: true });
    this.db = new Database(join(storageDirectory, "bridgit.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.interruptAbandonedOperations();
    this.interruptAbandonedAttempts();
  }

  public createChat(agentIdentity: string, requestedModelId: string | null, now = new Date().toISOString()): ChatRecord {
    const chat: ChatRecord = { chatId: randomUUID(), title: "New chat", version: 1, agentIdentity, requestedModelId, createdAt: now, updatedAt: now, originChatId: null, trashedAt: null };
    this.transaction(() => { this.db.prepare("INSERT INTO chat_sessions (chat_id, title, version, agent_identity, requested_model_id, created_at, updated_at, origin_chat_id, trashed_at) VALUES (@chatId, @title, @version, @agentIdentity, @requestedModelId, @createdAt, @updatedAt, @originChatId, @trashedAt)").run(chat); this.appendEvent("chat.session-created", chat.chatId, JSON.stringify(chat), now); });
    return chat;
  }

  public submitTurn(chatId: string, content: string, now = new Date().toISOString()): TurnRecord {
    const chat = this.getChat(chatId); if (!chat) throw new Error("chat-not-found");
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM chat_turns WHERE chat_id = ?").get(chatId) as { count: number };
    const turn: TurnRecord = { turnId: randomUUID(), chatId, ordinal: count.count + 1, content, submittedAt: now };
    this.transaction(() => { const artifact = this.createArtifact("text/plain", content, "Chat turn"); this.db.prepare("INSERT INTO chat_turns VALUES (?, ?, ?, ?, ?)").run(turn.turnId, chatId, turn.ordinal, artifact.artifactId, now); this.db.prepare("UPDATE chat_sessions SET version = version + 1, updated_at = ? WHERE chat_id = ?").run(now, chatId); this.appendEvent("chat.turn-submitted", chatId, JSON.stringify({ ...turn, content: undefined }), now); });
    return turn;
  }

  public createResponseAttempt(turnId: string, requestedModelId: string | null, now = new Date().toISOString(), effectiveModelId: string | null = null): ResponseAttemptRecord {
    const active = this.db.prepare("SELECT a.attempt_id FROM response_attempts a JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = (SELECT chat_id FROM chat_turns WHERE turn_id = ?) AND a.state IN ('preparing','running','waiting-for-approval')").get(turnId) as { attempt_id: string } | undefined;
    if (active) throw new Error("chat-already-has-active-attempt");
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM response_attempts WHERE turn_id = ?").get(turnId) as { count: number };
    const attempt: ResponseAttemptRecord = { attemptId: randomUUID(), turnId, ordinal: row.count + 1, state: "preparing", requestedModelId, effectiveModelId, snapshotId: null, createdAt: now, endedAt: null };
    this.transaction(() => { this.db.prepare("INSERT INTO response_attempts (attempt_id, turn_id, ordinal, state, requested_model_id, created_at, effective_model_id, snapshot_id, ended_at) VALUES (@attemptId, @turnId, @ordinal, @state, @requestedModelId, @createdAt, @effectiveModelId, @snapshotId, @endedAt)").run(attempt); this.appendEvent("response.preparation-started", turnId, JSON.stringify(attempt), now); }); return attempt;
  }
  public transitionAttempt(attemptId: string, state: AttemptState, now = new Date().toISOString()): void { const terminal = ["succeeded", "blocked", "failed", "cancelled", "interrupted"].includes(state); this.transaction(() => { const result = this.db.prepare("UPDATE response_attempts SET state = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END WHERE attempt_id = ? AND state IN ('preparing','running','waiting-for-approval')").run(state, terminal ? 1 : 0, now, attemptId); if (result.changes !== 1) throw new Error("invalid-attempt-transition"); this.appendEvent(`response.${state}`, attemptId, JSON.stringify({ state }), now); }); }
  /** Stores the latest visible stream text so an interrupted extension host can restore it on reload. */
  public checkpointOutput(turnId: string, content: string, now = new Date().toISOString()): void { this.transaction(() => { this.db.prepare("INSERT INTO chat_stream_outputs (turn_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(turn_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at").run(turnId, content, now); this.appendEvent("chat.output-checkpointed", turnId, JSON.stringify({ byteCount: Buffer.byteLength(content, "utf8") }), now); }); }
  public appendOutput(turnId: string, content: string, now = new Date().toISOString()): OutputRecord { const output: OutputRecord = { outputId: randomUUID(), turnId, content, createdAt: now }; this.transaction(() => { const artifact = this.createArtifact("text/plain", content, "Assistant response"); this.db.prepare("INSERT INTO chat_outputs VALUES (?, ?, ?, ?)").run(output.outputId, turnId, artifact.artifactId, now); this.db.prepare("DELETE FROM chat_stream_outputs WHERE turn_id = ?").run(turnId); this.appendEvent("chat.output-appended", turnId, JSON.stringify({ ...output, content: undefined }), now); }); return output; }

  public forkChat(chatId: string, agentIdentity: string, now = new Date().toISOString()): ChatRecord { const source = this.getChat(chatId); if (!source) throw new Error("chat-not-found"); const fork: ChatRecord = { chatId: randomUUID(), title: `${source.title} (fork)`, version: 1, agentIdentity, requestedModelId: null, createdAt: now, updatedAt: now, originChatId: chatId, trashedAt: null }; this.transaction(() => { this.db.prepare("INSERT INTO chat_sessions (chat_id, title, version, agent_identity, requested_model_id, created_at, updated_at, origin_chat_id, trashed_at) VALUES (@chatId, @title, @version, @agentIdentity, @requestedModelId, @createdAt, @updatedAt, @originChatId, @trashedAt)").run(fork); this.appendEvent("chat.fork-created", fork.chatId, JSON.stringify({ originChatId: chatId }), now); }); return fork; }
  public setChatTitle(chatId: string, title: string, now = new Date().toISOString()): void { const clean = title.trim().replace(/\s+/g, " ").slice(0, 96); if (!clean) throw new Error("chat-title-empty"); this.transaction(() => { const result = this.db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE chat_id = ?").run(clean, now, chatId); if (result.changes !== 1) throw new Error("chat-not-found"); this.appendEvent("chat.title-set", chatId, JSON.stringify({ title: clean }), now); }); }
  public trashChat(chatId: string, now = new Date().toISOString()): void { this.transaction(() => { this.db.prepare("UPDATE response_attempts SET state = 'cancelled', ended_at = ? WHERE attempt_id IN (SELECT a.attempt_id FROM response_attempts a JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = ? AND a.state IN ('preparing','running','waiting-for-approval'))").run(now, chatId); const result = this.db.prepare("UPDATE chat_sessions SET trashed_at = ? WHERE chat_id = ? AND trashed_at IS NULL").run(now, chatId); if (result.changes !== 1) throw new Error("chat-not-found-or-already-trashed"); this.appendEvent("chat.trashed", chatId, "{}", now); }); }
  public restoreChat(chatId: string, now = new Date().toISOString()): void { this.transaction(() => { const result = this.db.prepare("UPDATE chat_sessions SET trashed_at = NULL WHERE chat_id = ? AND trashed_at IS NOT NULL").run(chatId); if (result.changes !== 1) throw new Error("chat-not-trashed"); this.appendEvent("chat.restored", chatId, "{}", now); }); }
  public deleteChatPermanently(chatId: string, confirmed: boolean, now = new Date().toISOString()): void {
    if (!confirmed) throw new Error("permanent-delete-requires-confirmation");
    const chat = this.getChat(chatId);
    if (!chat?.trashedAt) throw new Error("chat-must-be-trashed-before-permanent-delete");
    const active = this.db.prepare("SELECT 1 FROM response_attempts a JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = ? AND a.state IN ('preparing','running','waiting-for-approval')").get(chatId);
    if (active) throw new Error("chat-has-active-attempt");
    const unsettledOperation = this.db.prepare("SELECT 1 FROM durable_operations o JOIN response_attempts a ON o.parent_kind = 'response-attempt' AND o.parent_id = a.attempt_id JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = ? AND o.state IN ('executing','reconciling','outcome-unknown')").get(chatId);
    if (unsettledOperation) throw new Error("chat-has-unsettled-tool-operation");
    const artifacts = this.db.prepare("SELECT content_artifact_id AS artifactId FROM chat_turns WHERE chat_id = ? UNION SELECT o.artifact_id AS artifactId FROM chat_outputs o JOIN chat_turns t ON t.turn_id = o.turn_id WHERE t.chat_id = ?").all(chatId, chatId) as { artifactId: string }[];
    this.transaction(() => {
      this.db.prepare("UPDATE chat_sessions SET origin_chat_id = NULL WHERE origin_chat_id = ?").run(chatId);
      this.db.prepare("DELETE FROM resource_snapshots WHERE attempt_id IN (SELECT a.attempt_id FROM response_attempts a JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = ?)").run(chatId);
      this.db.prepare("DELETE FROM tool_audits WHERE attempt_id IN (SELECT a.attempt_id FROM response_attempts a JOIN chat_turns t ON t.turn_id = a.turn_id WHERE t.chat_id = ?)").run(chatId);
      this.db.prepare("DELETE FROM chat_stream_outputs WHERE turn_id IN (SELECT turn_id FROM chat_turns WHERE chat_id = ?)").run(chatId);
      this.db.prepare("DELETE FROM chat_outputs WHERE turn_id IN (SELECT turn_id FROM chat_turns WHERE chat_id = ?)").run(chatId);
      this.db.prepare("DELETE FROM response_attempts WHERE turn_id IN (SELECT turn_id FROM chat_turns WHERE chat_id = ?)").run(chatId);
      this.db.prepare("DELETE FROM chat_turns WHERE chat_id = ?").run(chatId);
      this.db.prepare("DELETE FROM chat_summaries WHERE chat_id = ?").run(chatId);
      this.db.prepare("DELETE FROM session_ledger WHERE chat_id = ?").run(chatId);
      this.db.prepare("DELETE FROM chat_sessions WHERE chat_id = ?").run(chatId);
      for (const artifact of artifacts) this.db.prepare("DELETE FROM artifacts WHERE artifact_id = ?").run(artifact.artifactId);
      this.appendEvent("chat.permanently-deleted", chatId, "{}", now);
    });
  }
  public createSummary(chatId: string, content: string, provenance: string, now = new Date().toISOString()): string { const summaryId = randomUUID(); this.transaction(() => { this.db.prepare("UPDATE chat_summaries SET active = 0 WHERE chat_id = ? AND active = 1").run(chatId); this.db.prepare("INSERT INTO chat_summaries VALUES (?, ?, ?, ?, 1, ?)").run(summaryId, chatId, content, provenance, now); this.appendEvent("chat.summary-created", chatId, JSON.stringify({ summaryId }), now); }); return summaryId; }
  public appendLedger(chatId: string, kind: string, content: string, provenance: string, now = new Date().toISOString()): LedgerEntry { const entry: LedgerEntry = { entryId: randomUUID(), chatId, kind, content, provenance, status: "active", createdAt: now }; this.transaction(() => { this.db.prepare("INSERT INTO session_ledger VALUES (@entryId, @chatId, @kind, @content, @provenance, @status, @createdAt)").run(entry); this.appendEvent("chat.ledger-appended", chatId, JSON.stringify({ entryId: entry.entryId }), now); }); return entry; }
  public correctLedger(entryId: string, content: string, provenance: string, now = new Date().toISOString()): LedgerEntry { const prior = this.db.prepare("SELECT entry_id as entryId, chat_id as chatId, kind, content, provenance, status, created_at as createdAt FROM session_ledger WHERE entry_id = ?").get(entryId) as LedgerEntry | undefined; if (!prior) throw new Error("ledger-entry-not-found"); const replacement = this.appendLedger(prior.chatId, prior.kind, content, provenance, now); this.db.prepare("UPDATE session_ledger SET status = 'superseded' WHERE entry_id = ?").run(entryId); return replacement; }
  public recordToolIntent(input: RecordToolIntent, now = new Date().toISOString()): DurableOperation {
    validateHash(input.operationKey, "operation-key");
    validateHash(input.targetFingerprint, "target-fingerprint");
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(input.toolIdentity)) throw new Error("tool-identity-invalid");
    if (!input.parentId.trim()) throw new Error("operation-parent-invalid");
    if (input.parentKind === "response-attempt" && !this.getResponseAttempt(input.parentId)) throw new Error("response-attempt-not-found");
    if (input.parentKind === "response-attempt" && input.resourceSnapshotId === null) throw new Error("tool-operation-requires-resource-snapshot");
    if (input.resourceSnapshotId !== null) validateHash(input.resourceSnapshotId, "resource-snapshot-id");
    if (input.decisionCode === "allowed" && input.effectClass !== "read" && input.authorityGrantId === null) throw new Error("mutating-operation-requires-authority");
    const sanitizedInput = boundedSanitizedRecord(input.input, "tool-input");
    const affectedTargets = boundedTargets(input.affectedTargets);
    const inputFingerprint = createHash("sha256").update(canonicalJson(sanitizedInput)).digest("hex");
    const intentFingerprint = createHash("sha256").update(canonicalJson({
      operationKey: input.operationKey,
      parentKind: input.parentKind,
      parentId: input.parentId,
      effectClass: input.effectClass,
      authorityGrantId: input.authorityGrantId,
      resourceSnapshotId: input.resourceSnapshotId,
      targetFingerprint: input.targetFingerprint,
      toolIdentity: input.toolIdentity,
      decisionCode: input.decisionCode,
      inputFingerprint,
      affectedTargets,
    })).digest("hex");
    const existing = this.getDurableOperationByKey(input.operationKey);
    if (existing) {
      if (existing.intentFingerprint !== intentFingerprint) throw new Error("operation-key-conflict");
      return existing;
    }
    const denied = input.decisionCode === "denied";
    const operation: DurableOperation = {
      operationId: randomUUID(), version: 1, operationKey: input.operationKey, parentKind: input.parentKind, parentId: input.parentId,
      state: denied ? "failed" : "intent-recorded", effectClass: input.effectClass, intentFingerprint,
      authorityGrantId: input.authorityGrantId, resourceSnapshotId: input.resourceSnapshotId, targetFingerprint: input.targetFingerprint,
      createdAt: now, updatedAt: now, terminalAt: denied ? now : null,
    };
    const auditId = randomUUID();
    this.transaction(() => {
      this.db.prepare("INSERT INTO durable_operations (operation_id, version, operation_key, parent_kind, parent_id, state, effect_class, intent_fingerprint, authority_grant_id, resource_snapshot_id, target_fingerprint, created_at, updated_at, terminal_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(operation.operationId, operation.operationKey, operation.parentKind, operation.parentId, operation.state, operation.effectClass, operation.intentFingerprint, operation.authorityGrantId, operation.resourceSnapshotId, operation.targetFingerprint, now, now, operation.terminalAt);
      this.db.prepare("INSERT INTO tool_audit_records (audit_id, operation_id, ordinal, tool_identity, effect_class, authority_review_id, decision_code, input_fingerprint, sanitized_input_json, sanitized_result_json, affected_targets_json, started_at, terminal_at, outcome_code) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)")
        .run(auditId, operation.operationId, input.toolIdentity, input.effectClass, input.authorityReviewId, input.decisionCode, inputFingerprint, JSON.stringify(sanitizedInput), JSON.stringify(affectedTargets), denied ? now : null, denied ? "denied" : null);
      this.appendEvent("operation.intent-recorded", operation.operationId, JSON.stringify({ operationKey: operation.operationKey, auditId, decisionCode: input.decisionCode }), now);
    });
    return operation;
  }
  public beginToolEffect(operationId: string, now = new Date().toISOString()): OperationExecutionAttempt {
    const operation = this.getDurableOperation(operationId);
    if (!operation || (operation.state !== "intent-recorded" && operation.state !== "retry-wait")) throw new Error("operation-not-ready-for-handoff");
    if (operation.state === "retry-wait") {
      const proof = this.db.prepare("SELECT 1 FROM reconciliation_evidence WHERE operation_id = ? AND classification = 'not-applied' UNION SELECT 1 FROM operation_execution_attempts WHERE operation_id = ? AND state = 'known-not-applied'").get(operationId, operationId);
      if (!proof) throw new Error("operation-retry-requires-not-applied-proof");
    }
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM operation_execution_attempts WHERE operation_id = ?").get(operationId) as { count: number };
    const attempt: OperationExecutionAttempt = { operationId, ordinal: count.count + 1, state: "executing", handoffStartedAt: now, finishedAt: null, sanitizedOutcomeCode: null };
    this.transaction(() => {
      const changed = this.db.prepare("UPDATE durable_operations SET version = version + 1, state = 'executing', updated_at = ?, terminal_at = NULL WHERE operation_id = ? AND state IN ('intent-recorded','retry-wait')").run(now, operationId);
      if (changed.changes !== 1) throw new Error("operation-not-ready-for-handoff");
      this.db.prepare("INSERT INTO operation_execution_attempts (operation_id, ordinal, state, handoff_started_at, finished_at, sanitized_outcome_code) VALUES (?, ?, 'executing', ?, NULL, NULL)").run(operationId, attempt.ordinal, now);
      this.db.prepare("UPDATE tool_audit_records SET started_at = ? WHERE operation_id = ? AND started_at IS NULL").run(now, operationId);
      if (operation.state === "retry-wait") this.appendAuditCorrection(operationId, "retry-after-not-applied", { executionOrdinal: attempt.ordinal }, now);
      this.appendEvent("operation.effect-handoff-started", operationId, JSON.stringify({ ordinal: attempt.ordinal }), now);
    });
    return attempt;
  }
  public recordToolOutcome(operationId: string, outcome: "applied" | "not-applied" | "failed", result: Readonly<Record<string, unknown>>, affectedTargets: readonly string[], now = new Date().toISOString()): DurableOperation {
    const operation = this.getDurableOperation(operationId);
    if (!operation || operation.state !== "executing") throw new Error("operation-not-executing");
    const sanitizedResult = boundedSanitizedRecord(result, "tool-result");
    const targets = boundedTargets(affectedTargets);
    const attempt = this.currentExecutionAttempt(operationId);
    if (!attempt) throw new Error("operation-execution-attempt-not-found");
    const attemptState = outcome === "applied" ? "known-applied" : outcome === "not-applied" ? "known-not-applied" : "failed";
    const operationState = outcome === "applied" ? "succeeded" : outcome === "not-applied" ? "retry-wait" : "failed";
    const terminalAt = operationState === "retry-wait" ? null : now;
    this.transaction(() => {
      this.db.prepare("UPDATE operation_execution_attempts SET state = ?, finished_at = ?, sanitized_outcome_code = ? WHERE operation_id = ? AND ordinal = ? AND state = 'executing'").run(attemptState, now, outcome, operationId, attempt.ordinal);
      this.db.prepare("UPDATE durable_operations SET version = version + 1, state = ?, updated_at = ?, terminal_at = ? WHERE operation_id = ? AND state = 'executing'").run(operationState, now, terminalAt, operationId);
      const auditUpdate = this.db.prepare("UPDATE tool_audit_records SET sanitized_result_json = ?, affected_targets_json = ?, terminal_at = ?, outcome_code = ? WHERE operation_id = ? AND outcome_code IS NULL").run(JSON.stringify(sanitizedResult), JSON.stringify(targets), now, outcome, operationId);
      if (auditUpdate.changes === 0) this.appendAuditCorrection(operationId, `retry-${outcome}`, { sanitizedResult, affectedTargets: targets, executionOrdinal: attempt.ordinal }, now);
      if (outcome !== "not-applied") this.db.prepare("UPDATE operation_barriers SET removed_at = ?, removal_reason = ? WHERE operation_id = ? AND removed_at IS NULL").run(now, `known-${outcome}`, operationId);
      this.appendEvent(`operation.${operationState}`, operationId, JSON.stringify({ outcome, ordinal: attempt.ordinal }), now);
    });
    return this.getDurableOperation(operationId) as DurableOperation;
  }
  public markToolOutcomeUnknown(operationId: string, now = new Date().toISOString()): DurableOperation {
    const operation = this.getDurableOperation(operationId);
    if (!operation || operation.state !== "executing") throw new Error("operation-not-executing");
    const attempt = this.currentExecutionAttempt(operationId);
    if (!attempt) throw new Error("operation-execution-attempt-not-found");
    const readOnly = operation.effectClass === "read";
    this.transaction(() => {
      this.db.prepare("UPDATE operation_execution_attempts SET state = 'interrupted', finished_at = ?, sanitized_outcome_code = 'interrupted' WHERE operation_id = ? AND ordinal = ? AND state = 'executing'").run(now, operationId, attempt.ordinal);
      this.db.prepare("UPDATE durable_operations SET version = version + 1, state = ?, updated_at = ?, terminal_at = ? WHERE operation_id = ? AND state = 'executing'").run(readOnly ? "failed" : "outcome-unknown", now, readOnly ? now : null, operationId);
      const auditUpdate = this.db.prepare("UPDATE tool_audit_records SET terminal_at = ?, outcome_code = ? WHERE operation_id = ? AND outcome_code IS NULL").run(now, readOnly ? "interrupted" : "unknown", operationId);
      if (auditUpdate.changes === 0) this.appendAuditCorrection(operationId, "effect-interrupted", { executionOrdinal: attempt.ordinal, outcome: readOnly ? "interrupted-read" : "unknown" }, now);
      if (!readOnly) this.ensureOperationBarrier(operation, now);
      this.appendEvent(readOnly ? "operation.failed" : "operation.outcome-unknown", operationId, JSON.stringify({ ordinal: attempt.ordinal }), now);
    });
    return this.getDurableOperation(operationId) as DurableOperation;
  }
  public startOperationReconciliation(operationId: string, now = new Date().toISOString()): void {
    this.transaction(() => {
      const result = this.db.prepare("UPDATE durable_operations SET version = version + 1, state = 'reconciling', updated_at = ? WHERE operation_id = ? AND state = 'outcome-unknown'").run(now, operationId);
      if (result.changes !== 1) throw new Error("operation-not-awaiting-reconciliation");
      this.appendEvent("operation.reconciliation-started", operationId, "{}", now);
    });
  }
  public recordReconciliation(operationId: string, classification: ReconciliationClassification, delta: Readonly<Record<string, unknown>>, now = new Date().toISOString()): ReconciliationEvidence {
    const operation = this.getDurableOperation(operationId);
    if (!operation || operation.state !== "reconciling") throw new Error("operation-not-reconciling");
    const sanitizedDelta = boundedSanitizedRecord(delta, "reconciliation-delta");
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM reconciliation_evidence WHERE operation_id = ?").get(operationId) as { count: number };
    const evidence: ReconciliationEvidence = { evidenceId: randomUUID(), operationId, ordinal: count.count + 1, classification, observedAt: now };
    const nextState = classification === "applied" ? "succeeded" : classification === "not-applied" ? "retry-wait" : "outcome-unknown";
    this.transaction(() => {
      this.db.prepare("INSERT INTO reconciliation_evidence (evidence_id, operation_id, ordinal, classification, observed_at) VALUES (?, ?, ?, ?, ?)").run(evidence.evidenceId, operationId, evidence.ordinal, classification, now);
      this.appendAuditCorrection(operationId, `reconciliation-${classification}`, sanitizedDelta, now);
      this.db.prepare("UPDATE durable_operations SET version = version + 1, state = ?, updated_at = ?, terminal_at = ? WHERE operation_id = ? AND state = 'reconciling'").run(nextState, now, nextState === "succeeded" ? now : null, operationId);
      if (classification === "applied") this.db.prepare("UPDATE operation_barriers SET removed_at = ?, removal_reason = ? WHERE operation_id = ? AND removed_at IS NULL").run(now, "reconciled-applied", operationId);
      this.appendEvent(`operation.reconciled-${classification}`, operationId, JSON.stringify({ evidenceId: evidence.evidenceId }), now);
    });
    return evidence;
  }
  public pinResourceSnapshot(attemptId: string, snapshotId: string, content: string, now = new Date().toISOString()): ResourceSnapshotRecord {
    if (!/^[a-f0-9]{64}$/.test(snapshotId)) throw new Error("resource-snapshot-id-invalid");
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error("resource-snapshot-content-invalid"); }
    if (!isRecord(parsed) || parsed.snapshotId !== snapshotId) throw new Error("resource-snapshot-identity-mismatch");
    if (parsed.attemptId !== attemptId) throw new Error("resource-snapshot-attempt-mismatch");
    const { snapshotId: _embeddedSnapshotId, ...snapshotPayload } = parsed;
    const calculatedSnapshotId = createHash("sha256").update(JSON.stringify(snapshotPayload)).digest("hex");
    if (calculatedSnapshotId !== snapshotId) throw new Error("resource-snapshot-checksum-mismatch");
    const snapshot: ResourceSnapshotRecord = { snapshotId, attemptId, content, createdAt: now };
    this.transaction(() => {
      const attempt = this.db.prepare("SELECT state, snapshot_id AS snapshotId FROM response_attempts WHERE attempt_id = ?").get(attemptId) as { state: AttemptState; snapshotId: string | null } | undefined;
      if (!attempt) throw new Error("response-attempt-not-found");
      if (attempt.state !== "preparing") throw new Error("resource-snapshot-requires-preparing-attempt");
      if (attempt.snapshotId !== null) throw new Error("resource-snapshot-already-pinned");
      this.db.prepare("INSERT INTO resource_snapshots VALUES (@snapshotId, @attemptId, @content, @createdAt)").run(snapshot);
      const linked = this.db.prepare("UPDATE response_attempts SET snapshot_id = ? WHERE attempt_id = ? AND snapshot_id IS NULL").run(snapshotId, attemptId);
      if (linked.changes !== 1) throw new Error("resource-snapshot-link-failed");
      this.appendEvent("resource.snapshot-pinned", attemptId, JSON.stringify({ snapshotId }), now);
    });
    return snapshot;
  }
  public resolveMcpTrust(serverIdentity: string, fingerprint: string, decision: "trusted" | "denied", now = new Date().toISOString()): McpTrustRecord {
    if (!/^[A-Za-z0-9._-]+$/.test(serverIdentity) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("invalid-mcp-trust-identity");
    this.transaction(() => {
      this.db.prepare("UPDATE mcp_trust SET invalidated_at = ? WHERE server_identity = ? AND fingerprint <> ? AND invalidated_at IS NULL").run(now, serverIdentity, fingerprint);
      this.db.prepare("INSERT INTO mcp_trust (server_identity, fingerprint, version, decision, decided_at, invalidated_at) VALUES (?, ?, 1, ?, ?, NULL) ON CONFLICT(server_identity, fingerprint) DO UPDATE SET version = version + 1, decision = excluded.decision, decided_at = excluded.decided_at, invalidated_at = NULL").run(serverIdentity, fingerprint, decision, now);
      this.appendEvent("mcp.server-trust-resolved", serverIdentity, JSON.stringify({ fingerprint, decision }), now);
    });
    return this.getMcpTrust(serverIdentity, fingerprint) as McpTrustRecord;
  }
  public getMcpTrust(serverIdentity: string, fingerprint: string): McpTrustRecord | undefined {
    return this.db.prepare("SELECT server_identity AS serverIdentity, fingerprint, version, decision, decided_at AS decidedAt, invalidated_at AS invalidatedAt FROM mcp_trust WHERE server_identity = ? AND fingerprint = ? AND invalidated_at IS NULL").get(serverIdentity, fingerprint) as McpTrustRecord | undefined;
  }
  public createAuthorityReview(input: CreateAuthorityReview, now = new Date().toISOString()): AuthorityReview {
    validateGrantOwner(input.owner, input.grantScope, input.taskPhase);
    if (input.owner.kind === "chat" && !this.getChat(input.owner.id)) throw new Error("authority-chat-owner-not-found");
    if (input.grantScope === "chat-once" && input.resourceSnapshotId === null) throw new Error("chat-once-authority-requires-snapshot");
    if (input.resourceSnapshotId !== null && !/^[a-f0-9]{64}$/.test(input.resourceSnapshotId)) throw new Error("authority-snapshot-id-invalid");
    const requestedScope = normalizeAuthorityScope({ capabilities: input.capabilities });
    const riskSummary = input.riskSummary.trim();
    if (!riskSummary) throw new Error("authority-risk-summary-empty");
    const logicalScope = createHash("sha256").update(JSON.stringify({ grantScope: input.grantScope, effectClass: input.effectClass, requestedScope, resourceSnapshotId: input.resourceSnapshotId })).digest("hex");
    if (this.db.prepare("SELECT 1 FROM authority_reviews WHERE owner_kind = ? AND owner_id = ? AND logical_scope = ? AND status = 'open'").get(input.owner.kind, input.owner.id, logicalScope)) {
      throw new Error("authority-review-already-open");
    }
    const row = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM authority_reviews WHERE owner_kind = ? AND owner_id = ?").get(input.owner.kind, input.owner.id) as { version: number };
    const review: AuthorityReview = {
      reviewId: randomUUID(), owner: input.owner, version: row.version + 1, grantScope: input.grantScope, effectClass: input.effectClass,
      requestedScope, resourceSnapshotId: input.resourceSnapshotId, riskSummary, status: "open", decision: null, confirmationHash: null, createdAt: now, resolvedAt: null,
    };
    this.transaction(() => {
      this.db.prepare("INSERT INTO authority_reviews (review_id, owner_kind, owner_id, version, grant_scope, effect_class, requested_scope_json, resource_snapshot_id, logical_scope, risk_summary, status, decision, confirmation_hash, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, NULL)")
        .run(review.reviewId, review.owner.kind, review.owner.id, review.version, review.grantScope, review.effectClass, JSON.stringify(review.requestedScope), review.resourceSnapshotId, logicalScope, review.riskSummary, now);
      this.appendEvent("authority.review-opened", review.owner.id, JSON.stringify({ reviewId: review.reviewId, ownerKind: review.owner.kind, grantScope: review.grantScope }), now);
    });
    return review;
  }
  public resolveAuthorityReview(reviewId: string, decision: AuthorityReviewDecision, confirmationHash: string, expiresAt: string | null = null, now = new Date().toISOString()): AuthorityGrant | undefined {
    const review = this.getAuthorityReview(reviewId);
    if (!review || review.status !== "open") throw new Error("authority-review-not-open");
    if (confirmationHash !== authorityReviewConfirmationHash(review)) throw new Error("authority-confirmation-mismatch");
    if (expiresAt !== null && expiresAt <= now) throw new Error("authority-expiry-invalid");
    let grant: AuthorityGrant | undefined;
    this.transaction(() => {
      const resolved = this.db.prepare("UPDATE authority_reviews SET status = ?, decision = ?, confirmation_hash = ?, resolved_at = ? WHERE review_id = ? AND status = 'open'").run(decision, decision, confirmationHash, now, reviewId);
      if (resolved.changes !== 1) throw new Error("authority-review-not-open");
      if (decision === "approved") {
        const draft = {
          grantId: randomUUID(), reviewId, owner: review.owner, scope: review.grantScope, effectClass: review.effectClass,
          capabilities: review.requestedScope.capabilities, resourceSnapshotId: review.resourceSnapshotId,
          issuedAt: now, expiresAt, revokedAt: null, consumedAt: null,
        };
        grant = { ...draft, fingerprint: authorityGrantFingerprint(draft) };
        this.db.prepare("INSERT INTO authority_grants (grant_id, review_id, scope_json, effect_class, owner_kind, owner_id, resource_snapshot_id, fingerprint, issued_at, expires_at, revoked_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)")
          .run(grant.grantId, reviewId, JSON.stringify({ capabilities: grant.capabilities }), grant.effectClass, grant.owner.kind, grant.owner.id, grant.resourceSnapshotId, grant.fingerprint, now, expiresAt);
      }
      this.appendEvent("authority.review-resolved", review.owner.id, JSON.stringify({ reviewId, decision, grantId: grant?.grantId ?? null }), now);
    });
    return grant;
  }
  public getAuthorityReview(reviewId: string): AuthorityReview | undefined {
    const row = this.db.prepare("SELECT review_id AS reviewId, owner_kind AS ownerKind, owner_id AS ownerId, version, grant_scope AS grantScope, effect_class AS effectClass, requested_scope_json AS requestedScopeJson, resource_snapshot_id AS resourceSnapshotId, risk_summary AS riskSummary, status, decision, confirmation_hash AS confirmationHash, created_at AS createdAt, resolved_at AS resolvedAt FROM authority_reviews WHERE review_id = ?").get(reviewId) as AuthorityReviewRow | undefined;
    return row ? mapAuthorityReview(row) : undefined;
  }
  public listAuthorityGrants(owner: AuthorityOwner): readonly AuthorityGrant[] {
    const rows = this.db.prepare("SELECT g.grant_id AS grantId, g.review_id AS reviewId, r.grant_scope AS scope, g.scope_json AS scopeJson, g.effect_class AS effectClass, g.owner_kind AS ownerKind, g.owner_id AS ownerId, g.resource_snapshot_id AS resourceSnapshotId, g.fingerprint, g.issued_at AS issuedAt, g.expires_at AS expiresAt, g.revoked_at AS revokedAt, g.consumed_at AS consumedAt FROM authority_grants g JOIN authority_reviews r ON r.review_id = g.review_id WHERE g.owner_kind = ? AND g.owner_id = ? ORDER BY g.issued_at").all(owner.kind, owner.id) as AuthorityGrantRow[];
    return rows.map(mapAuthorityGrant);
  }
  public consumeAuthorityGrant(grantId: string, now = new Date().toISOString()): void {
    const grant = this.db.prepare("SELECT r.grant_scope AS scope FROM authority_grants g JOIN authority_reviews r ON r.review_id = g.review_id WHERE g.grant_id = ? AND g.revoked_at IS NULL AND g.consumed_at IS NULL").get(grantId) as { scope: AuthorityGrantScope } | undefined;
    if (grant?.scope !== "chat-once") throw new Error("authority-grant-not-consumable");
    const result = this.db.prepare("UPDATE authority_grants SET consumed_at = ? WHERE grant_id = ? AND revoked_at IS NULL AND consumed_at IS NULL").run(now, grantId);
    if (result.changes !== 1) throw new Error("authority-grant-not-consumable");
    this.appendEvent("authority.grant-consumed", grantId, "{}", now);
  }
  public revokeAuthorityGrant(grantId: string, now = new Date().toISOString()): void {
    const result = this.db.prepare("UPDATE authority_grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL").run(now, grantId);
    if (result.changes !== 1) throw new Error("authority-grant-not-active");
    this.appendEvent("authority.grant-revoked", grantId, "{}", now);
  }
  public acquireRepositoryWriteLock(holderId: string, now = new Date().toISOString()): boolean { const result = this.db.prepare("INSERT INTO repository_write_lock (lock_id, holder_id, acquired_at) VALUES (1, ?, ?) ON CONFLICT(lock_id) DO NOTHING").run(holderId, now); if (result.changes) this.appendEvent("repository.write-lock-acquired", holderId, "{}", now); return result.changes === 1; }
  public releaseRepositoryWriteLock(holderId: string, now = new Date().toISOString()): boolean { const result = this.db.prepare("DELETE FROM repository_write_lock WHERE lock_id = 1 AND holder_id = ?").run(holderId); if (result.changes) this.appendEvent("repository.write-lock-released", holderId, "{}", now); return result.changes === 1; }
  public repositoryWriteLocked(): boolean { return Boolean(this.db.prepare("SELECT 1 FROM repository_write_lock WHERE lock_id = 1").get()); }
  public getChat(chatId: string): ChatRecord | undefined { return this.db.prepare("SELECT chat_id as chatId, title, version, agent_identity as agentIdentity, requested_model_id as requestedModelId, created_at as createdAt, updated_at as updatedAt, origin_chat_id as originChatId, trashed_at as trashedAt FROM chat_sessions WHERE chat_id = ?").get(chatId) as ChatRecord | undefined; }
  public listChats(includeTrash = false): readonly ChatRecord[] { return this.db.prepare(`SELECT chat_id as chatId, title, version, agent_identity as agentIdentity, requested_model_id as requestedModelId, created_at as createdAt, updated_at as updatedAt, origin_chat_id as originChatId, trashed_at as trashedAt FROM chat_sessions ${includeTrash ? "" : "WHERE trashed_at IS NULL"} ORDER BY created_at`).all() as ChatRecord[]; }
  public listTurns(chatId: string): readonly TurnRecord[] { return (this.db.prepare("SELECT t.turn_id as turnId, t.chat_id as chatId, t.ordinal, a.content, t.submitted_at as submittedAt FROM chat_turns t JOIN artifacts a ON a.artifact_id = t.content_artifact_id WHERE t.chat_id = ? ORDER BY t.ordinal").all(chatId) as TurnRecord[]); }
  public listOutputs(chatId: string): readonly OutputRecord[] { return this.db.prepare("SELECT o.output_id as outputId, o.turn_id as turnId, a.content, o.created_at as createdAt FROM chat_outputs o JOIN chat_turns t ON t.turn_id = o.turn_id JOIN artifacts a ON a.artifact_id = o.artifact_id WHERE t.chat_id = ? UNION ALL SELECT 'stream:' || s.turn_id as outputId, s.turn_id as turnId, s.content, s.updated_at as createdAt FROM chat_stream_outputs s JOIN chat_turns t ON t.turn_id = s.turn_id WHERE t.chat_id = ? ORDER BY createdAt").all(chatId, chatId) as OutputRecord[]; }
  public getResponseAttempt(attemptId: string): ResponseAttemptRecord | undefined { return this.db.prepare("SELECT attempt_id AS attemptId, turn_id AS turnId, ordinal, state, requested_model_id AS requestedModelId, effective_model_id AS effectiveModelId, snapshot_id AS snapshotId, created_at AS createdAt, ended_at AS endedAt FROM response_attempts WHERE attempt_id = ?").get(attemptId) as ResponseAttemptRecord | undefined; }
  public getResourceSnapshot(attemptId: string): ResourceSnapshotRecord | undefined { return this.db.prepare("SELECT snapshot_id AS snapshotId, attempt_id AS attemptId, content, created_at AS createdAt FROM resource_snapshots WHERE attempt_id = ?").get(attemptId) as ResourceSnapshotRecord | undefined; }
  public getDurableOperation(operationId: string): DurableOperation | undefined {
    return this.db.prepare("SELECT operation_id AS operationId, version, operation_key AS operationKey, parent_kind AS parentKind, parent_id AS parentId, state, effect_class AS effectClass, intent_fingerprint AS intentFingerprint, authority_grant_id AS authorityGrantId, resource_snapshot_id AS resourceSnapshotId, target_fingerprint AS targetFingerprint, created_at AS createdAt, updated_at AS updatedAt, terminal_at AS terminalAt FROM durable_operations WHERE operation_id = ?").get(operationId) as DurableOperation | undefined;
  }
  public getDurableOperationByKey(operationKey: string): DurableOperation | undefined {
    return this.db.prepare("SELECT operation_id AS operationId, version, operation_key AS operationKey, parent_kind AS parentKind, parent_id AS parentId, state, effect_class AS effectClass, intent_fingerprint AS intentFingerprint, authority_grant_id AS authorityGrantId, resource_snapshot_id AS resourceSnapshotId, target_fingerprint AS targetFingerprint, created_at AS createdAt, updated_at AS updatedAt, terminal_at AS terminalAt FROM durable_operations WHERE operation_key = ?").get(operationKey) as DurableOperation | undefined;
  }
  public listToolAudits(operationId: string): readonly ToolAuditRecord[] {
    const rows = this.db.prepare("SELECT audit_id AS auditId, operation_id AS operationId, ordinal, tool_identity AS toolIdentity, effect_class AS effectClass, authority_review_id AS authorityReviewId, decision_code AS decisionCode, input_fingerprint AS inputFingerprint, sanitized_input_json AS sanitizedInputJson, sanitized_result_json AS sanitizedResultJson, affected_targets_json AS affectedTargetsJson, started_at AS startedAt, terminal_at AS terminalAt, outcome_code AS outcomeCode FROM tool_audit_records WHERE operation_id = ? ORDER BY ordinal").all(operationId) as ToolAuditRow[];
    return rows.map(mapToolAudit);
  }
  public listOperationAttempts(operationId: string): readonly OperationExecutionAttempt[] {
    return this.db.prepare("SELECT operation_id AS operationId, ordinal, state, handoff_started_at AS handoffStartedAt, finished_at AS finishedAt, sanitized_outcome_code AS sanitizedOutcomeCode FROM operation_execution_attempts WHERE operation_id = ? ORDER BY ordinal").all(operationId) as OperationExecutionAttempt[];
  }
  public listReconciliationEvidence(operationId: string): readonly ReconciliationEvidence[] {
    return this.db.prepare("SELECT evidence_id AS evidenceId, operation_id AS operationId, ordinal, classification, observed_at AS observedAt FROM reconciliation_evidence WHERE operation_id = ? ORDER BY ordinal").all(operationId) as ReconciliationEvidence[];
  }
  public listToolAuditCorrections(operationId: string): readonly ToolAuditCorrection[] {
    const rows = this.db.prepare("SELECT c.correction_id AS correctionId, c.audit_id AS auditId, c.ordinal, c.reason_code AS reasonCode, c.sanitized_delta_json AS sanitizedDeltaJson, c.created_at AS createdAt FROM tool_audit_corrections c JOIN tool_audit_records a ON a.audit_id = c.audit_id WHERE a.operation_id = ? ORDER BY c.ordinal").all(operationId) as ToolAuditCorrectionRow[];
    return rows.map((row) => ({
      correctionId: row.correctionId,
      auditId: row.auditId,
      ordinal: row.ordinal,
      reasonCode: row.reasonCode,
      sanitizedDelta: JSON.parse(row.sanitizedDeltaJson) as Readonly<Record<string, unknown>>,
      createdAt: row.createdAt,
    }));
  }
  public operationHasActiveBarrier(operationId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM operation_barriers WHERE operation_id = ? AND removed_at IS NULL").get(operationId));
  }
  public listEvents(): readonly EventRecord[] { return this.db.prepare("SELECT sequence, name, aggregate_id as aggregateId, payload, emitted_at as emittedAt FROM projection_events ORDER BY sequence").all() as EventRecord[]; }
  public close(): void { this.db.close(); }

  private createArtifact(mediaType: string, content: string, displayLabel: string): ArtifactRef { const bytes = Buffer.from(content, "utf8"); const ref: ArtifactRef = { artifactId: randomUUID(), mediaType, byteCount: bytes.byteLength, checksum: createHash("sha256").update(bytes).digest("hex"), displayLabel }; this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)").run(ref.artifactId, ref.mediaType, ref.byteCount, ref.checksum, ref.displayLabel, content); return ref; }
  private currentExecutionAttempt(operationId: string): OperationExecutionAttempt | undefined {
    return this.db.prepare("SELECT operation_id AS operationId, ordinal, state, handoff_started_at AS handoffStartedAt, finished_at AS finishedAt, sanitized_outcome_code AS sanitizedOutcomeCode FROM operation_execution_attempts WHERE operation_id = ? AND state = 'executing' ORDER BY ordinal DESC LIMIT 1").get(operationId) as OperationExecutionAttempt | undefined;
  }
  private appendAuditCorrection(operationId: string, reasonCode: string, delta: Readonly<Record<string, unknown>>, now: string): void {
    const audit = this.db.prepare("SELECT audit_id AS auditId FROM tool_audit_records WHERE operation_id = ? ORDER BY ordinal LIMIT 1").get(operationId) as { auditId: string } | undefined;
    if (!audit) throw new Error("tool-audit-not-found");
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM tool_audit_corrections WHERE audit_id = ?").get(audit.auditId) as { count: number };
    this.db.prepare("INSERT INTO tool_audit_corrections (correction_id, audit_id, ordinal, reason_code, sanitized_delta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), audit.auditId, count.count + 1, reasonCode, JSON.stringify(boundedSanitizedRecord(delta, "audit-correction")), now);
  }
  private ensureOperationBarrier(operation: DurableOperation, now: string): void {
    this.db.prepare("INSERT INTO operation_barriers (barrier_id, operation_id, scope_kind, scope_fingerprint, created_at, removed_at, removal_reason) VALUES (?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(operation_id) DO NOTHING")
      .run(randomUUID(), operation.operationId, operation.effectClass === "repository-write" ? "workspace-mutation" : "external-target", operation.targetFingerprint, now);
  }
  private appendEvent(name: string, aggregateId: string, payload: string, emittedAt: string): void { this.db.prepare("INSERT INTO projection_events (name, aggregate_id, payload, emitted_at) VALUES (?, ?, ?, ?)").run(name, aggregateId, payload, emittedAt); }
  private transaction(work: () => void): void { this.db.transaction(work)(); }
  /** Extension-host restarts cannot resume model work; make any prior in-flight attempt inspectable and retryable. */
  private interruptAbandonedOperations(): void {
    const now = new Date().toISOString();
    const operations = this.db.prepare("SELECT operation_id AS operationId FROM durable_operations WHERE state = 'executing'").all() as { operationId: string }[];
    for (const operation of operations) this.markToolOutcomeUnknown(operation.operationId, now);
  }
  private interruptAbandonedAttempts(): void { const now = new Date().toISOString(); this.transaction(() => { const attempts = this.db.prepare("SELECT attempt_id as attemptId FROM response_attempts WHERE state IN ('preparing','running','waiting-for-approval')").all() as { attemptId: string }[]; for (const attempt of attempts) { this.db.prepare("UPDATE response_attempts SET state = 'interrupted', ended_at = ? WHERE attempt_id = ?").run(now, attempt.attemptId); this.appendEvent("response.interrupted", attempt.attemptId, JSON.stringify({ reason: "extension-host-restart" }), now); } }); }
  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS artifacts (artifact_id TEXT PRIMARY KEY, media_type TEXT NOT NULL, byte_count INTEGER NOT NULL, checksum TEXT NOT NULL, display_label TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_sessions (chat_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New chat', version INTEGER NOT NULL, agent_identity TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, origin_chat_id TEXT REFERENCES chat_sessions(chat_id), trashed_at TEXT); CREATE TABLE IF NOT EXISTS chat_turns (turn_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, content_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), submitted_at TEXT NOT NULL, UNIQUE(chat_id, ordinal)); CREATE TABLE IF NOT EXISTS response_attempts (attempt_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, state TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, effective_model_id TEXT, snapshot_id TEXT, ended_at TEXT, UNIQUE(turn_id, ordinal)); CREATE TABLE IF NOT EXISTS chat_outputs (output_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id) ON DELETE CASCADE, artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_stream_outputs (turn_id TEXT PRIMARY KEY REFERENCES chat_turns(turn_id) ON DELETE CASCADE, content TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_summaries (summary_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, content TEXT NOT NULL, provenance TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session_ledger (entry_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, provenance TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS resource_snapshots (snapshot_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES response_attempts(attempt_id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_write_lock (lock_id INTEGER PRIMARY KEY CHECK(lock_id = 1), holder_id TEXT NOT NULL, acquired_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_trust (server_identity TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('trusted','denied')), decided_at TEXT NOT NULL, invalidated_at TEXT, PRIMARY KEY(server_identity, fingerprint)); CREATE TABLE IF NOT EXISTS tool_audits (audit_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES response_attempts(attempt_id) ON DELETE CASCADE, operation_key TEXT NOT NULL, tool_identity TEXT NOT NULL, snapshot_id TEXT NOT NULL, decision TEXT NOT NULL, input TEXT NOT NULL, outcome TEXT, created_at TEXT NOT NULL, completed_at TEXT); CREATE TABLE IF NOT EXISTS projection_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, emitted_at TEXT NOT NULL);");
    this.db.exec("CREATE TABLE IF NOT EXISTS authority_reviews (review_id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL CHECK(owner_kind IN ('chat','task')), owner_id TEXT NOT NULL, version INTEGER NOT NULL, grant_scope TEXT NOT NULL CHECK(grant_scope IN ('chat-once','chat-session','task')), effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), requested_scope_json TEXT NOT NULL, resource_snapshot_id TEXT, logical_scope TEXT NOT NULL, risk_summary TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','approved','denied','stale','cancelled')), decision TEXT CHECK(decision IN ('approved','denied')), confirmation_hash TEXT, created_at TEXT NOT NULL, resolved_at TEXT); CREATE TABLE IF NOT EXISTS authority_grants (grant_id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES authority_reviews(review_id) ON DELETE RESTRICT, scope_json TEXT NOT NULL, effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), owner_kind TEXT NOT NULL CHECK(owner_kind IN ('chat','task')), owner_id TEXT NOT NULL, resource_snapshot_id TEXT, fingerprint TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, consumed_at TEXT);");
    this.db.exec("CREATE TABLE IF NOT EXISTS durable_operations (operation_id TEXT PRIMARY KEY, version INTEGER NOT NULL, operation_key TEXT NOT NULL UNIQUE, parent_kind TEXT NOT NULL CHECK(parent_kind IN ('response-attempt','assignment-attempt')), parent_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('intent-recorded','executing','retry-wait','reconciling','outcome-unknown','succeeded','failed','cancelled')), effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), intent_fingerprint TEXT NOT NULL, authority_grant_id TEXT REFERENCES authority_grants(grant_id) ON DELETE RESTRICT, resource_snapshot_id TEXT REFERENCES resource_snapshots(snapshot_id) ON DELETE RESTRICT, target_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT); CREATE TABLE IF NOT EXISTS operation_execution_attempts (operation_id TEXT NOT NULL REFERENCES durable_operations(operation_id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL CHECK(ordinal >= 1), state TEXT NOT NULL CHECK(state IN ('executing','known-applied','known-not-applied','failed','cancelled','interrupted')), handoff_started_at TEXT NOT NULL, finished_at TEXT, sanitized_outcome_code TEXT, PRIMARY KEY(operation_id, ordinal)); CREATE TABLE IF NOT EXISTS operation_barriers (barrier_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(operation_id) ON DELETE RESTRICT, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('workspace-mutation','external-target')), scope_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, removed_at TEXT, removal_reason TEXT); CREATE TABLE IF NOT EXISTS reconciliation_evidence (evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES durable_operations(operation_id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL, classification TEXT NOT NULL CHECK(classification IN ('applied','not-applied','inconclusive')), observed_at TEXT NOT NULL, UNIQUE(operation_id, ordinal)); CREATE TABLE IF NOT EXISTS tool_audit_records (audit_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES durable_operations(operation_id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL, tool_identity TEXT NOT NULL, effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), authority_review_id TEXT REFERENCES authority_reviews(review_id) ON DELETE RESTRICT, decision_code TEXT NOT NULL CHECK(decision_code IN ('allowed','denied')), input_fingerprint TEXT NOT NULL, sanitized_input_json TEXT NOT NULL, sanitized_result_json TEXT, affected_targets_json TEXT NOT NULL, started_at TEXT, terminal_at TEXT, outcome_code TEXT CHECK(outcome_code IN ('applied','not-applied','failed','denied','interrupted','unknown')), UNIQUE(operation_id, ordinal)); CREATE TABLE IF NOT EXISTS tool_audit_corrections (correction_id TEXT PRIMARY KEY, audit_id TEXT NOT NULL REFERENCES tool_audit_records(audit_id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL, reason_code TEXT NOT NULL, sanitized_delta_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(audit_id, ordinal));");
    this.db.exec("DROP TRIGGER IF EXISTS tool_audit_immutable_fields; CREATE TRIGGER IF NOT EXISTS tool_audit_no_delete BEFORE DELETE ON tool_audit_records BEGIN SELECT RAISE(ABORT, 'tool-audit-append-only'); END; CREATE TRIGGER IF NOT EXISTS tool_audit_correction_no_update BEFORE UPDATE ON tool_audit_corrections BEGIN SELECT RAISE(ABORT, 'tool-audit-correction-append-only'); END; CREATE TRIGGER IF NOT EXISTS tool_audit_correction_no_delete BEFORE DELETE ON tool_audit_corrections BEGIN SELECT RAISE(ABORT, 'tool-audit-correction-append-only'); END; CREATE TRIGGER IF NOT EXISTS reconciliation_evidence_no_update BEFORE UPDATE ON reconciliation_evidence BEGIN SELECT RAISE(ABORT, 'reconciliation-evidence-append-only'); END; CREATE TRIGGER IF NOT EXISTS reconciliation_evidence_no_delete BEFORE DELETE ON reconciliation_evidence BEGIN SELECT RAISE(ABORT, 'reconciliation-evidence-append-only'); END; CREATE TRIGGER tool_audit_immutable_fields BEFORE UPDATE ON tool_audit_records WHEN OLD.audit_id <> NEW.audit_id OR OLD.operation_id <> NEW.operation_id OR OLD.ordinal <> NEW.ordinal OR OLD.tool_identity <> NEW.tool_identity OR OLD.effect_class <> NEW.effect_class OR OLD.decision_code <> NEW.decision_code OR OLD.input_fingerprint <> NEW.input_fingerprint OR OLD.sanitized_input_json <> NEW.sanitized_input_json OR OLD.authority_review_id IS NOT NEW.authority_review_id OR OLD.outcome_code IS NOT NULL OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at) OR (OLD.terminal_at IS NOT NULL AND NEW.terminal_at IS NOT OLD.terminal_at) OR (OLD.sanitized_result_json IS NOT NULL AND NEW.sanitized_result_json IS NOT OLD.sanitized_result_json) OR (NEW.outcome_code IS NULL AND (NEW.terminal_at IS NOT OLD.terminal_at OR NEW.sanitized_result_json IS NOT OLD.sanitized_result_json)) OR (NEW.outcome_code IS NOT NULL AND NEW.terminal_at IS NULL) BEGIN SELECT RAISE(ABORT, 'tool-audit-immutable'); END;");
    this.addColumn("chat_sessions", "title", "TEXT NOT NULL DEFAULT 'New chat'");
    this.addColumn("chat_sessions", "origin_chat_id", "TEXT");
    this.addColumn("chat_sessions", "trashed_at", "TEXT");
    this.addColumn("response_attempts", "effective_model_id", "TEXT");
    this.addColumn("response_attempts", "snapshot_id", "TEXT");
    this.addColumn("response_attempts", "ended_at", "TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS resource_snapshots_attempt_unique ON resource_snapshots(attempt_id); CREATE UNIQUE INDEX IF NOT EXISTS authority_reviews_open_scope_unique ON authority_reviews(owner_kind, owner_id, logical_scope) WHERE status = 'open'; CREATE INDEX IF NOT EXISTS durable_operations_parent ON durable_operations(parent_kind, parent_id); CREATE INDEX IF NOT EXISTS durable_operations_recovery ON durable_operations(state) WHERE state IN ('executing','reconciling','outcome-unknown')");
  }
  private addColumn(table: string, column: string, type: string): void { try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* Existing databases already have the column. */ } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface AuthorityReviewRow {
  readonly reviewId: string;
  readonly ownerKind: AuthorityOwner["kind"];
  readonly ownerId: string;
  readonly version: number;
  readonly grantScope: AuthorityGrantScope;
  readonly effectClass: AuthorityEffectClass;
  readonly requestedScopeJson: string;
  readonly resourceSnapshotId: string | null;
  readonly riskSummary: string;
  readonly status: AuthorityReview["status"];
  readonly decision: AuthorityReviewDecision | null;
  readonly confirmationHash: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface AuthorityGrantRow {
  readonly grantId: string;
  readonly reviewId: string;
  readonly scope: AuthorityGrantScope;
  readonly scopeJson: string;
  readonly effectClass: AuthorityEffectClass;
  readonly ownerKind: AuthorityOwner["kind"];
  readonly ownerId: string;
  readonly resourceSnapshotId: string | null;
  readonly fingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly consumedAt: string | null;
}

function mapAuthorityReview(row: AuthorityReviewRow): AuthorityReview {
  return {
    reviewId: row.reviewId,
    owner: { kind: row.ownerKind, id: row.ownerId },
    version: row.version,
    grantScope: row.grantScope,
    effectClass: row.effectClass,
    requestedScope: JSON.parse(row.requestedScopeJson) as AuthorityReview["requestedScope"],
    resourceSnapshotId: row.resourceSnapshotId,
    riskSummary: row.riskSummary,
    status: row.status,
    decision: row.decision,
    confirmationHash: row.confirmationHash,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function mapAuthorityGrant(row: AuthorityGrantRow): AuthorityGrant {
  const scope = JSON.parse(row.scopeJson) as { readonly capabilities: readonly string[] };
  return {
    grantId: row.grantId,
    reviewId: row.reviewId,
    owner: { kind: row.ownerKind, id: row.ownerId },
    scope: row.scope,
    effectClass: row.effectClass,
    capabilities: scope.capabilities,
    resourceSnapshotId: row.resourceSnapshotId,
    fingerprint: row.fingerprint,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    consumedAt: row.consumedAt,
  };
}

interface ToolAuditRow {
  readonly auditId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly toolIdentity: string;
  readonly effectClass: ToolAuditRecord["effectClass"];
  readonly authorityReviewId: string | null;
  readonly decisionCode: ToolAuditRecord["decisionCode"];
  readonly inputFingerprint: string;
  readonly sanitizedInputJson: string;
  readonly sanitizedResultJson: string | null;
  readonly affectedTargetsJson: string;
  readonly startedAt: string | null;
  readonly terminalAt: string | null;
  readonly outcomeCode: ToolOutcomeCode | null;
}

interface ToolAuditCorrectionRow {
  readonly correctionId: string;
  readonly auditId: string;
  readonly ordinal: number;
  readonly reasonCode: string;
  readonly sanitizedDeltaJson: string;
  readonly createdAt: string;
}

function mapToolAudit(row: ToolAuditRow): ToolAuditRecord {
  return {
    auditId: row.auditId,
    operationId: row.operationId,
    ordinal: row.ordinal,
    toolIdentity: row.toolIdentity,
    effectClass: row.effectClass,
    authorityReviewId: row.authorityReviewId,
    decisionCode: row.decisionCode,
    inputFingerprint: row.inputFingerprint,
    sanitizedInput: JSON.parse(row.sanitizedInputJson) as Readonly<Record<string, unknown>>,
    sanitizedResult: row.sanitizedResultJson === null ? null : JSON.parse(row.sanitizedResultJson) as Readonly<Record<string, unknown>>,
    affectedTargets: JSON.parse(row.affectedTargetsJson) as readonly string[],
    startedAt: row.startedAt,
    terminalAt: row.terminalAt,
    outcomeCode: row.outcomeCode,
  };
}

function validateHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field}-must-be-sha256`);
}

function boundedSanitizedRecord(value: Readonly<Record<string, unknown>>, field: string): Readonly<Record<string, unknown>> {
  const sanitized = sanitize({ ...value });
  let encoded: string;
  try { encoded = JSON.stringify(sanitized); }
  catch { throw new Error(`${field}-invalid-json`); }
  if (Buffer.byteLength(encoded, "utf8") > 64 * 1024) throw new Error(`${field}-too-large`);
  return JSON.parse(encoded) as Readonly<Record<string, unknown>>;
}

function boundedTargets(values: readonly string[]): readonly string[] {
  if (values.length > 100) throw new Error("affected-targets-too-many");
  const targets = [...new Set(values)].sort();
  if (targets.some((target) => !/^(?:repo|endpoint|resource):[A-Za-z0-9._/-]{1,480}$/.test(target))) throw new Error("affected-target-invalid");
  for (const target of targets.filter((value) => value.startsWith("repo:"))) {
    const path = target.slice("repo:".length);
    if (path.startsWith("/") || path.split("/").some((segment) => segment === "..")) throw new Error("affected-target-invalid");
  }
  return targets;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
