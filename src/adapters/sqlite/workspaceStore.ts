import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  authorityGrantFingerprint,
  authorityReviewConfirmationHash,
  normalizeAuthorityScope,
  validateGrantOwner,
  type AuthorityEffectClass,
  type AuthorityGrant,
  type AuthorityGrantScope,
  type AuthorityOwner,
  type AuthorityReview,
  type AuthorityReviewDecision,
  type CreateAuthorityReview,
} from "../../features/execution-authority";

export interface ArtifactRef { readonly artifactId: string; readonly mediaType: string; readonly byteCount: number; readonly checksum: string; readonly displayLabel: string; }
export interface ChatRecord { readonly chatId: string; readonly title: string; readonly version: number; readonly agentIdentity: string; readonly requestedModelId: string | null; readonly createdAt: string; readonly updatedAt: string; readonly originChatId: string | null; readonly trashedAt: string | null; }
export interface TurnRecord { readonly turnId: string; readonly chatId: string; readonly ordinal: number; readonly content: string; readonly submittedAt: string; }
export type AttemptState = "preparing" | "running" | "waiting-for-approval" | "succeeded" | "blocked" | "failed" | "cancelled" | "interrupted";
export interface ResponseAttemptRecord { readonly attemptId: string; readonly turnId: string; readonly ordinal: number; readonly state: AttemptState; readonly requestedModelId: string | null; readonly effectiveModelId: string | null; readonly snapshotId: string | null; readonly createdAt: string; readonly endedAt: string | null; }
export interface OutputRecord { readonly outputId: string; readonly turnId: string; readonly content: string; readonly createdAt: string; }
export interface EventRecord { readonly sequence: number; readonly name: string; readonly aggregateId: string; readonly payload: string; readonly emittedAt: string; }
export interface ToolAuditRecord { readonly auditId: string; readonly attemptId: string; readonly operationKey: string; readonly toolIdentity: string; readonly snapshotId: string; readonly decision: string; readonly input: string; readonly outcome: string | null; readonly createdAt: string; readonly completedAt: string | null; }
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
  public recordToolAudit(record: ToolAuditRecord): void { this.transaction(() => { this.db.prepare("INSERT INTO tool_audits VALUES (@auditId, @attemptId, @operationKey, @toolIdentity, @snapshotId, @decision, @input, @outcome, @createdAt, @completedAt)").run(record); this.appendEvent("tool.audit-recorded", record.attemptId, JSON.stringify({ auditId: record.auditId, decision: record.decision }), record.createdAt); }); }
  public completeToolOperation(auditId: string, outcome: string, now = new Date().toISOString()): void { this.db.prepare("UPDATE tool_audits SET outcome = ?, completed_at = ? WHERE audit_id = ? AND completed_at IS NULL").run(outcome, now, auditId); }
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
  public listEvents(): readonly EventRecord[] { return this.db.prepare("SELECT sequence, name, aggregate_id as aggregateId, payload, emitted_at as emittedAt FROM projection_events ORDER BY sequence").all() as EventRecord[]; }
  public close(): void { this.db.close(); }

  private createArtifact(mediaType: string, content: string, displayLabel: string): ArtifactRef { const bytes = Buffer.from(content, "utf8"); const ref: ArtifactRef = { artifactId: randomUUID(), mediaType, byteCount: bytes.byteLength, checksum: createHash("sha256").update(bytes).digest("hex"), displayLabel }; this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)").run(ref.artifactId, ref.mediaType, ref.byteCount, ref.checksum, ref.displayLabel, content); return ref; }
  private appendEvent(name: string, aggregateId: string, payload: string, emittedAt: string): void { this.db.prepare("INSERT INTO projection_events (name, aggregate_id, payload, emitted_at) VALUES (?, ?, ?, ?)").run(name, aggregateId, payload, emittedAt); }
  private transaction(work: () => void): void { this.db.transaction(work)(); }
  /** Extension-host restarts cannot resume model work; make any prior in-flight attempt inspectable and retryable. */
  private interruptAbandonedAttempts(): void { const now = new Date().toISOString(); this.transaction(() => { const attempts = this.db.prepare("SELECT attempt_id as attemptId FROM response_attempts WHERE state IN ('preparing','running','waiting-for-approval')").all() as { attemptId: string }[]; for (const attempt of attempts) { this.db.prepare("UPDATE response_attempts SET state = 'interrupted', ended_at = ? WHERE attempt_id = ?").run(now, attempt.attemptId); this.appendEvent("response.interrupted", attempt.attemptId, JSON.stringify({ reason: "extension-host-restart" }), now); } }); }
  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS artifacts (artifact_id TEXT PRIMARY KEY, media_type TEXT NOT NULL, byte_count INTEGER NOT NULL, checksum TEXT NOT NULL, display_label TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_sessions (chat_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New chat', version INTEGER NOT NULL, agent_identity TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, origin_chat_id TEXT REFERENCES chat_sessions(chat_id), trashed_at TEXT); CREATE TABLE IF NOT EXISTS chat_turns (turn_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, content_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), submitted_at TEXT NOT NULL, UNIQUE(chat_id, ordinal)); CREATE TABLE IF NOT EXISTS response_attempts (attempt_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, state TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, effective_model_id TEXT, snapshot_id TEXT, ended_at TEXT, UNIQUE(turn_id, ordinal)); CREATE TABLE IF NOT EXISTS chat_outputs (output_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id) ON DELETE CASCADE, artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_stream_outputs (turn_id TEXT PRIMARY KEY REFERENCES chat_turns(turn_id) ON DELETE CASCADE, content TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_summaries (summary_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, content TEXT NOT NULL, provenance TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session_ledger (entry_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, provenance TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS resource_snapshots (snapshot_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES response_attempts(attempt_id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_write_lock (lock_id INTEGER PRIMARY KEY CHECK(lock_id = 1), holder_id TEXT NOT NULL, acquired_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_trust (server_identity TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('trusted','denied')), decided_at TEXT NOT NULL, invalidated_at TEXT, PRIMARY KEY(server_identity, fingerprint)); CREATE TABLE IF NOT EXISTS tool_audits (audit_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES response_attempts(attempt_id) ON DELETE CASCADE, operation_key TEXT NOT NULL, tool_identity TEXT NOT NULL, snapshot_id TEXT NOT NULL, decision TEXT NOT NULL, input TEXT NOT NULL, outcome TEXT, created_at TEXT NOT NULL, completed_at TEXT); CREATE TABLE IF NOT EXISTS projection_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, emitted_at TEXT NOT NULL);");
    this.db.exec("CREATE TABLE IF NOT EXISTS authority_reviews (review_id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL CHECK(owner_kind IN ('chat','task')), owner_id TEXT NOT NULL, version INTEGER NOT NULL, grant_scope TEXT NOT NULL CHECK(grant_scope IN ('chat-once','chat-session','task')), effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), requested_scope_json TEXT NOT NULL, resource_snapshot_id TEXT, logical_scope TEXT NOT NULL, risk_summary TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','approved','denied','stale','cancelled')), decision TEXT CHECK(decision IN ('approved','denied')), confirmation_hash TEXT, created_at TEXT NOT NULL, resolved_at TEXT); CREATE TABLE IF NOT EXISTS authority_grants (grant_id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES authority_reviews(review_id) ON DELETE RESTRICT, scope_json TEXT NOT NULL, effect_class TEXT NOT NULL CHECK(effect_class IN ('read','repository-write','ambient')), owner_kind TEXT NOT NULL CHECK(owner_kind IN ('chat','task')), owner_id TEXT NOT NULL, resource_snapshot_id TEXT, fingerprint TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, consumed_at TEXT);");
    this.addColumn("chat_sessions", "title", "TEXT NOT NULL DEFAULT 'New chat'");
    this.addColumn("chat_sessions", "origin_chat_id", "TEXT");
    this.addColumn("chat_sessions", "trashed_at", "TEXT");
    this.addColumn("response_attempts", "effective_model_id", "TEXT");
    this.addColumn("response_attempts", "snapshot_id", "TEXT");
    this.addColumn("response_attempts", "ended_at", "TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS resource_snapshots_attempt_unique ON resource_snapshots(attempt_id); CREATE UNIQUE INDEX IF NOT EXISTS authority_reviews_open_scope_unique ON authority_reviews(owner_kind, owner_id, logical_scope) WHERE status = 'open'");
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
