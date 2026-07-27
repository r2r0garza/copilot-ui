import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { TextDecoder } from "node:util";

import { secretMinimizedEnvironment, validateRepositoryPath } from "../execution-authority";
import type { ToolResource } from "../resources/catalog";

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_STATUS_ENTRIES = 1000;
const MAX_COMMIT_MESSAGE_BYTES = 4096;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

type JsonObject = Readonly<Record<string, unknown>>;
type GitToolResult = GitStatusResult | GitStageResult | GitCommitResult;

const statusInputSchema = schema({ properties: {} });
const statusResultSchema = schema({
  required: ["branch", "head", "detached", "entries", "truncated", "indexFingerprint"],
  properties: {
    branch: { type: ["string", "null"] },
    head: { type: ["string", "null"], pattern: "^[a-f0-9]{40,64}$" },
    detached: { type: "boolean" },
    entries: { type: "array" },
    truncated: { type: "boolean" },
    indexFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
});
const stageInputSchema = schema({
  required: ["paths"],
  properties: {
    paths: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: "string", description: "Exact repository-relative regular file or tracked deletion." },
    },
  },
});
const stageResultSchema = schema({
  required: ["stagedPaths", "indexFingerprint"],
  properties: {
    stagedPaths: { type: "array", items: { type: "string" } },
    indexFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
});
const commitInputSchema = schema({
  required: ["message", "expectedIndexFingerprint"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: MAX_COMMIT_MESSAGE_BYTES },
    expectedIndexFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
});
const commitResultSchema = schema({
  required: ["commit", "message", "committedPaths", "indexFingerprint"],
  properties: {
    commit: { type: "string", pattern: "^[a-f0-9]{40,64}$" },
    message: { type: "string" },
    committedPaths: { type: "array", items: { type: "string" } },
    indexFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
});

export interface GitStatusEntry {
  readonly path: string;
  readonly originalPath: string | null;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
  readonly kind: "tracked" | "untracked" | "conflict";
}

export interface GitStatusResult {
  readonly branch: string | null;
  readonly head: string | null;
  readonly detached: boolean;
  readonly entries: readonly GitStatusEntry[];
  readonly truncated: boolean;
  readonly indexFingerprint: string;
}

export interface GitStageResult {
  readonly stagedPaths: readonly string[];
  readonly indexFingerprint: string;
}

export interface GitCommitResult {
  readonly commit: string;
  readonly message: string;
  readonly committedPaths: readonly string[];
  readonly indexFingerprint: string;
}

export function repositoryGitToolCatalog(repositoryRoot: string): readonly ToolResource[] {
  const available = isPrimaryRepositoryRoot(repositoryRoot);
  const status = available ? "available" : "unavailable";
  const reason = available ? undefined : "Safe Git requires the active folder to be a primary repository root with a local .git directory.";
  return [
    tool("git/status", "Observe structured repository and index status.", "read", statusInputSchema, statusResultSchema, status, reason),
    tool("git/stage", "Stage exact repository files or tracked deletions.", "repository-write", stageInputSchema, stageResultSchema, status, reason),
    tool("git/commit", "Create one local commit from an unchanged staged index.", "repository-write", commitInputSchema, commitResultSchema, status, reason),
  ];
}

/**
 * Narrow local Git adapter. Callers choose one declared operation; arbitrary
 * subcommands, remote mutation, branch movement, cleanup, and history rewrite
 * have no entry point.
 */
export class SafeGitExecutor {
  private readonly repositoryRoot: string;
  private readonly gitDirectory: string;

  public constructor(repositoryRoot: string) {
    const suppliedRoot = resolve(repositoryRoot);
    if (!existsSync(suppliedRoot)) throw new Error("repository-root-not-found");
    if (lstatSync(suppliedRoot).isSymbolicLink()) throw new Error("linked-repository-root-requires-approval");
    const canonicalRoot = realpathSync(suppliedRoot);
    if (!statSync(canonicalRoot).isDirectory()) throw new Error("repository-root-must-be-directory");
    const gitDirectory = join(canonicalRoot, ".git");
    if (!existsSync(gitDirectory) || lstatSync(gitDirectory).isSymbolicLink() || !lstatSync(gitDirectory).isDirectory()) throw new Error("primary-git-directory-required");
    this.repositoryRoot = canonicalRoot;
    this.gitDirectory = gitDirectory;

    const topLevel = this.git(["rev-parse", "--show-toplevel"]).stdout.trim();
    try {
      if (realpathSync(topLevel) !== canonicalRoot) throw new Error("repository-root-mismatch");
    } catch {
      throw new Error("repository-root-mismatch");
    }
  }

  public invoke(identity: string, input: unknown): GitToolResult {
    if (identity === "git/status") return this.status(input);
    if (identity === "git/stage") return this.stage(input);
    if (identity === "git/commit") return this.commit(input);
    throw new Error("tool-not-found");
  }

  private status(input: unknown): GitStatusResult {
    record(input, []);
    const branchResult = this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], [0, 1]);
    const headResult = this.git(["rev-parse", "--verify", "HEAD"], [0, 128]);
    const entries = parsePorcelain(this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout);
    return {
      branch: branchResult.status === 0 ? branchResult.stdout.trim() : null,
      head: headResult.status === 0 ? headResult.stdout.trim() : null,
      detached: branchResult.status !== 0 && headResult.status === 0,
      entries: entries.slice(0, MAX_STATUS_ENTRIES),
      truncated: entries.length > MAX_STATUS_ENTRIES,
      indexFingerprint: this.indexFingerprint(),
    };
  }

  private stage(input: unknown): GitStageResult {
    const value = record(input, ["paths"]);
    const paths = stringList(value.paths, "paths", 1, 100);
    const normalized = paths.map((path) => this.validateStagePath(path));
    this.rejectFilteredPaths(normalized);
    this.git(["add", "--", ...normalized]);
    return { stagedPaths: this.stagedPaths(), indexFingerprint: this.indexFingerprint() };
  }

  private commit(input: unknown): GitCommitResult {
    const value = record(input, ["message", "expectedIndexFingerprint"]);
    const message = requiredString(value.message, "message").trim();
    if (!message || Buffer.byteLength(message, "utf8") > MAX_COMMIT_MESSAGE_BYTES || /[\0\r]/.test(message)) throw new Error("commit-message-invalid");
    const expectedIndexFingerprint = requiredHash(value.expectedIndexFingerprint, "expectedIndexFingerprint");
    if (this.indexFingerprint() !== expectedIndexFingerprint) throw new Error("git-index-changed");
    const committedPaths = this.stagedPaths();
    if (committedPaths.length === 0) throw new Error("git-index-empty");

    this.git(["commit", "--no-verify", "--no-gpg-sign", "--no-post-rewrite", "-m", message]);
    const commit = this.git(["rev-parse", "--verify", "HEAD"]).stdout.trim();
    return { commit, message, committedPaths, indexFingerprint: this.indexFingerprint() };
  }

  private validateStagePath(candidate: string): string {
    const normalized = validateRepositoryPath(this.repositoryRoot, candidate);
    if (normalized === "" || normalized === ".git" || normalized.startsWith(".git/")) throw new Error("git-internal-path-rejected");
    const absolute = resolve(this.repositoryRoot, normalized);
    if (existsSync(absolute)) {
      const value = lstatSync(absolute);
      if (value.isSymbolicLink()) throw new Error("linked-path-rejected");
      if (!value.isFile()) throw new Error("git-stage-requires-exact-file");
      this.rejectLinkedParents(normalized);
      return normalized;
    }

    this.rejectLinkedParents(normalized);
    const tracked = this.git(["ls-files", "--stage", "--", normalized]).stdout.trim();
    if (!tracked) throw new Error("git-stage-path-not-found");
    if (tracked.startsWith("120000 ")) throw new Error("linked-path-rejected");
    return normalized;
  }

  private rejectLinkedParents(candidate: string): void {
    const segments = candidate.split("/");
    let current = this.repositoryRoot;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      if (!existsSync(current)) throw new Error("path-not-found");
      if (lstatSync(current).isSymbolicLink()) throw new Error("linked-path-rejected");
      if (!lstatSync(current).isDirectory()) throw new Error("path-parent-must-be-directory");
      if (existsSync(join(current, ".git"))) throw new Error("nested-git-boundary-rejected");
    }
  }

  private rejectFilteredPaths(paths: readonly string[]): void {
    const output = this.git(["check-attr", "-z", "filter", "--", ...paths]).stdout;
    const fields = output.split("\0").filter(Boolean);
    for (let index = 0; index + 2 < fields.length; index += 3) {
      if (fields[index + 2] !== "unspecified") throw new Error("git-filter-prohibited");
    }
  }

  private stagedPaths(): readonly string[] {
    return this.git(["diff", "--cached", "--name-only", "-z", "--no-ext-diff", "--no-textconv"]).stdout.split("\0").filter(Boolean).sort();
  }

  private indexFingerprint(): string {
    const index = join(this.gitDirectory, "index");
    if (existsSync(index) && statSync(index).size > 32 * 1024 * 1024) throw new Error("git-index-too-large");
    const bytes = existsSync(index) ? readFileSync(index) : Buffer.alloc(0);
    return createHash("sha256").update(bytes).digest("hex");
  }

  private git(arguments_: readonly string[], acceptedStatuses: readonly number[] = [0]): { readonly status: number; readonly stdout: string } {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const options = [
      "--no-pager",
      "--no-replace-objects",
      "-c", `core.hooksPath=${nullDevice}`,
      "-c", "commit.gpgSign=false",
      "-c", "tag.gpgSign=false",
      "-c", "credential.helper=",
      "-c", "core.askPass=",
      "-c", "core.fsmonitor=false",
      "-c", "maintenance.auto=false",
      "-c", "gc.auto=0",
      "-c", "diff.external=",
      "-c", "diff.trustExitCode=false",
      "-c", "interactive.diffFilter=",
      ...arguments_,
    ];
    const result = spawnSync("git", options, {
      cwd: this.repositoryRoot,
      encoding: "buffer",
      timeout: 15_000,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      env: safeGitEnvironment(nullDevice),
    });
    if (result.error || result.signal || !acceptedStatuses.includes(result.status ?? -1)) throw new Error(`safe-git-command-failed:${arguments_[0] ?? "unknown"}`);
    try { return { status: result.status ?? -1, stdout: UTF8.decode(result.stdout) }; }
    catch { throw new Error("safe-git-output-invalid-utf8"); }
  }
}

function isPrimaryRepositoryRoot(repositoryRoot: string): boolean {
  try {
    const root = resolve(repositoryRoot);
    const gitDirectory = join(root, ".git");
    return !lstatSync(root).isSymbolicLink() && lstatSync(root).isDirectory() && !lstatSync(gitDirectory).isSymbolicLink() && lstatSync(gitDirectory).isDirectory();
  } catch {
    return false;
  }
}

function parsePorcelain(output: string): readonly GitStatusEntry[] {
  const records = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record_ = records[index];
    if (!record_) continue;
    if (record_.length < 4 || record_[2] !== " ") throw new Error("git-status-output-invalid");
    const indexStatus = record_[0];
    const worktreeStatus = record_[1];
    const path = record_.slice(3);
    let originalPath: string | null = null;
    if ("RC".includes(indexStatus) || "RC".includes(worktreeStatus)) originalPath = records[++index] || null;
    entries.push({
      path,
      originalPath,
      indexStatus,
      worktreeStatus,
      kind: indexStatus === "?" && worktreeStatus === "?" ? "untracked" : new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]).has(`${indexStatus}${worktreeStatus}`) ? "conflict" : "tracked",
    });
  }
  return entries;
}

function safeGitEnvironment(nullDevice: string): Readonly<NodeJS.ProcessEnv> {
  const noInteraction = process.platform === "win32" ? "cmd /c exit 1" : "/usr/bin/false";
  return secretMinimizedEnvironment({
    inherit: ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"],
    neutralHome: nullDevice,
    fixed: {
      LC_ALL: "C",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: noInteraction,
      SSH_ASKPASS: noInteraction,
      GIT_EDITOR: noInteraction,
      GIT_SEQUENCE_EDITOR: noInteraction,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_ALLOW_PROTOCOL: "",
    },
  });
}

function tool(
  identity: string,
  description: string,
  effectClass: ToolResource["effectClass"],
  inputSchema: JsonObject,
  resultSchema: JsonObject,
  status: ToolResource["status"],
  reason: string | undefined,
): ToolResource {
  return {
    identity,
    description,
    origin: "workbench",
    effectClass,
    status,
    inputSchema,
    inputSchemaFingerprint: createHash("sha256").update(JSON.stringify(inputSchema)).digest("hex"),
    resultSchema,
    reason,
  };
}

function schema(value: { readonly required?: readonly string[]; readonly properties: JsonObject }): JsonObject {
  return { type: "object", additionalProperties: false, required: value.required ?? [], properties: value.properties };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("tool-input-must-be-object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("tool-input-contains-unknown-field");
  return input;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field}-must-be-string`);
  return value;
}

function requiredHash(value: unknown, field: string): string {
  const hash = requiredString(value, field);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${field}-must-be-sha256`);
  return hash;
}

function stringList(value: unknown, field: string, minimum: number, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || value.some((item) => typeof item !== "string" || item.length === 0)) throw new Error(`${field}-must-be-string-list`);
  if (new Set(value).size !== value.length) throw new Error(`${field}-must-be-unique`);
  return value as string[];
}
