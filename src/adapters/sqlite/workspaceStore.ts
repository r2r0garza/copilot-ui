import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ArtifactRef { readonly artifactId: string; readonly mediaType: string; readonly byteCount: number; readonly checksum: string; readonly displayLabel: string; }
export interface ChatRecord { readonly chatId: string; readonly version: number; readonly agentIdentity: string; readonly requestedModelId: string | null; readonly createdAt: string; readonly updatedAt: string; }
export interface TurnRecord { readonly turnId: string; readonly chatId: string; readonly ordinal: number; readonly content: string; readonly submittedAt: string; }
export interface ResponseAttemptRecord { readonly attemptId: string; readonly turnId: string; readonly ordinal: number; readonly state: "preparing"; readonly requestedModelId: string | null; readonly createdAt: string; }
export interface OutputRecord { readonly outputId: string; readonly turnId: string; readonly content: string; readonly createdAt: string; }
export interface EventRecord { readonly sequence: number; readonly name: string; readonly aggregateId: string; readonly payload: string; readonly emittedAt: string; }

/** M1’s workspace-local authority: state, immutable artifacts, and projection events share SQLite transactions. */
export class WorkspaceStore {
  private readonly db: Database.Database;

  public constructor(storageDirectory: string) {
    mkdirSync(storageDirectory, { recursive: true });
    this.db = new Database(join(storageDirectory, "bridgit.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  public createChat(agentIdentity: string, requestedModelId: string | null, now = new Date().toISOString()): ChatRecord {
    const chat: ChatRecord = { chatId: randomUUID(), version: 1, agentIdentity, requestedModelId, createdAt: now, updatedAt: now };
    this.transaction(() => { this.db.prepare("INSERT INTO chat_sessions VALUES (@chatId, @version, @agentIdentity, @requestedModelId, @createdAt, @updatedAt)").run(chat); this.appendEvent("chat.session-created", chat.chatId, JSON.stringify(chat), now); });
    return chat;
  }

  public submitTurn(chatId: string, content: string, now = new Date().toISOString()): TurnRecord {
    const chat = this.getChat(chatId); if (!chat) throw new Error("chat-not-found");
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM chat_turns WHERE chat_id = ?").get(chatId) as { count: number };
    const turn: TurnRecord = { turnId: randomUUID(), chatId, ordinal: count.count + 1, content, submittedAt: now };
    this.transaction(() => { const artifact = this.createArtifact("text/plain", content, "Chat turn"); this.db.prepare("INSERT INTO chat_turns VALUES (?, ?, ?, ?, ?)").run(turn.turnId, chatId, turn.ordinal, artifact.artifactId, now); this.db.prepare("UPDATE chat_sessions SET version = version + 1, updated_at = ? WHERE chat_id = ?").run(now, chatId); this.appendEvent("chat.turn-submitted", chatId, JSON.stringify({ ...turn, content: undefined }), now); });
    return turn;
  }

  public createResponseAttempt(turnId: string, requestedModelId: string | null, now = new Date().toISOString()): ResponseAttemptRecord { const row = this.db.prepare("SELECT COUNT(*) AS count FROM response_attempts WHERE turn_id = ?").get(turnId) as { count: number }; const attempt: ResponseAttemptRecord = { attemptId: randomUUID(), turnId, ordinal: row.count + 1, state: "preparing", requestedModelId, createdAt: now }; this.transaction(() => { this.db.prepare("INSERT INTO response_attempts VALUES (?, ?, ?, ?, ?, ?)").run(attempt.attemptId, attempt.turnId, attempt.ordinal, attempt.state, attempt.requestedModelId, attempt.createdAt); this.appendEvent("response.preparation-started", turnId, JSON.stringify(attempt), now); }); return attempt; }
  /** Stores the latest visible stream text so an interrupted extension host can restore it on reload. */
  public checkpointOutput(turnId: string, content: string, now = new Date().toISOString()): void { this.transaction(() => { this.db.prepare("INSERT INTO chat_stream_outputs (turn_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(turn_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at").run(turnId, content, now); this.appendEvent("chat.output-checkpointed", turnId, JSON.stringify({ byteCount: Buffer.byteLength(content, "utf8") }), now); }); }
  public appendOutput(turnId: string, content: string, now = new Date().toISOString()): OutputRecord { const output: OutputRecord = { outputId: randomUUID(), turnId, content, createdAt: now }; this.transaction(() => { const artifact = this.createArtifact("text/plain", content, "Assistant response"); this.db.prepare("INSERT INTO chat_outputs VALUES (?, ?, ?, ?)").run(output.outputId, turnId, artifact.artifactId, now); this.db.prepare("DELETE FROM chat_stream_outputs WHERE turn_id = ?").run(turnId); this.appendEvent("chat.output-appended", turnId, JSON.stringify({ ...output, content: undefined }), now); }); return output; }

  public getChat(chatId: string): ChatRecord | undefined { return this.db.prepare("SELECT chat_id as chatId, version, agent_identity as agentIdentity, requested_model_id as requestedModelId, created_at as createdAt, updated_at as updatedAt FROM chat_sessions WHERE chat_id = ?").get(chatId) as ChatRecord | undefined; }
  public listChats(): readonly ChatRecord[] { return this.db.prepare("SELECT chat_id as chatId, version, agent_identity as agentIdentity, requested_model_id as requestedModelId, created_at as createdAt, updated_at as updatedAt FROM chat_sessions ORDER BY created_at").all() as ChatRecord[]; }
  public listTurns(chatId: string): readonly TurnRecord[] { return (this.db.prepare("SELECT t.turn_id as turnId, t.chat_id as chatId, t.ordinal, a.content, t.submitted_at as submittedAt FROM chat_turns t JOIN artifacts a ON a.artifact_id = t.content_artifact_id WHERE t.chat_id = ? ORDER BY t.ordinal").all(chatId) as TurnRecord[]); }
  public listOutputs(chatId: string): readonly OutputRecord[] { return this.db.prepare("SELECT o.output_id as outputId, o.turn_id as turnId, a.content, o.created_at as createdAt FROM chat_outputs o JOIN chat_turns t ON t.turn_id = o.turn_id JOIN artifacts a ON a.artifact_id = o.artifact_id WHERE t.chat_id = ? UNION ALL SELECT 'stream:' || s.turn_id as outputId, s.turn_id as turnId, s.content, s.updated_at as createdAt FROM chat_stream_outputs s JOIN chat_turns t ON t.turn_id = s.turn_id WHERE t.chat_id = ? ORDER BY createdAt").all(chatId, chatId) as OutputRecord[]; }
  public listEvents(): readonly EventRecord[] { return this.db.prepare("SELECT sequence, name, aggregate_id as aggregateId, payload, emitted_at as emittedAt FROM projection_events ORDER BY sequence").all() as EventRecord[]; }
  public close(): void { this.db.close(); }

  private createArtifact(mediaType: string, content: string, displayLabel: string): ArtifactRef { const bytes = Buffer.from(content, "utf8"); const ref: ArtifactRef = { artifactId: randomUUID(), mediaType, byteCount: bytes.byteLength, checksum: createHash("sha256").update(bytes).digest("hex"), displayLabel }; this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)").run(ref.artifactId, ref.mediaType, ref.byteCount, ref.checksum, ref.displayLabel, content); return ref; }
  private appendEvent(name: string, aggregateId: string, payload: string, emittedAt: string): void { this.db.prepare("INSERT INTO projection_events (name, aggregate_id, payload, emitted_at) VALUES (?, ?, ?, ?)").run(name, aggregateId, payload, emittedAt); }
  private transaction(work: () => void): void { this.db.transaction(work)(); }
  private migrate(): void { this.db.exec("CREATE TABLE IF NOT EXISTS artifacts (artifact_id TEXT PRIMARY KEY, media_type TEXT NOT NULL, byte_count INTEGER NOT NULL, checksum TEXT NOT NULL, display_label TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_sessions (chat_id TEXT PRIMARY KEY, version INTEGER NOT NULL, agent_identity TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_turns (turn_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(chat_id), ordinal INTEGER NOT NULL, content_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), submitted_at TEXT NOT NULL, UNIQUE(chat_id, ordinal)); CREATE TABLE IF NOT EXISTS response_attempts (attempt_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id), ordinal INTEGER NOT NULL, state TEXT NOT NULL, requested_model_id TEXT, created_at TEXT NOT NULL, UNIQUE(turn_id, ordinal)); CREATE TABLE IF NOT EXISTS chat_outputs (output_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id), artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_stream_outputs (turn_id TEXT PRIMARY KEY REFERENCES chat_turns(turn_id), content TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projection_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, emitted_at TEXT NOT NULL);"); }
}
