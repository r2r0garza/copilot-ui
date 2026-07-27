import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { validateRepositoryPath } from "../execution-authority/policy";
import type { ToolResource } from "../resources/catalog";

const MAX_LIST_ENTRIES = 500;
const DEFAULT_LIST_ENTRIES = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_READ_BYTES = 128 * 1024;

type JsonObject = Readonly<Record<string, unknown>>;

const listInputSchema = schema({
  properties: {
    path: { type: "string", description: "Repository-relative directory. Defaults to the repository root." },
    maxEntries: { type: "integer", minimum: 1, maximum: MAX_LIST_ENTRIES, description: "Maximum direct children to return." },
  },
});
const listResultSchema = schema({
  required: ["path", "entries", "truncated"],
  properties: {
    path: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "kind"],
        properties: {
          path: { type: "string" },
          kind: { enum: ["file", "directory", "link", "other"] },
          byteLength: { type: ["integer", "null"] },
        },
      },
    },
    truncated: { type: "boolean" },
  },
});
const readInputSchema = schema({
  required: ["path"],
  properties: {
    path: { type: "string", description: "Repository-relative regular UTF-8 file path." },
    maxBytes: { type: "integer", minimum: 1, maximum: MAX_FILE_BYTES, description: "Reject files larger than this bounded byte limit." },
  },
});
const readResultSchema = schema({
  required: ["path", "content", "byteLength", "sha256"],
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    byteLength: { type: "integer" },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
});
const writeInputSchema = schema({
  required: ["path", "mode", "content"],
  properties: {
    path: { type: "string", description: "Repository-relative file beneath an existing repository directory." },
    mode: { enum: ["create", "replace"], description: "Create requires absence. Replace requires an exact expectedSha256." },
    content: { type: "string", description: "Complete UTF-8 replacement content, limited to 1 MiB." },
    expectedSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$", description: "Required for replace and matched immediately before the atomic replacement." },
  },
});
const writeResultSchema = schema({
  required: ["path", "operation", "byteLength", "sha256", "previousSha256"],
  properties: {
    path: { type: "string" },
    operation: { enum: ["created", "replaced"] },
    byteLength: { type: "integer" },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    previousSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
  },
});

export const repositoryToolCatalog: readonly ToolResource[] = [
  tool("files/list", "List direct children of a repository directory.", "read", listInputSchema, listResultSchema),
  tool("files/read", "Read a bounded UTF-8 repository file.", "read", readInputSchema, readResultSchema),
  tool("files/write", "Create or atomically replace a repository file.", "repository-write", writeInputSchema, writeResultSchema),
];

export interface RepositoryListResult {
  readonly path: string;
  readonly entries: readonly {
    readonly path: string;
    readonly kind: "file" | "directory" | "link" | "other";
    readonly byteLength: number | null;
  }[];
  readonly truncated: boolean;
}

export interface RepositoryReadResult {
  readonly path: string;
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RepositoryWriteResult {
  readonly path: string;
  readonly operation: "created" | "replaced";
  readonly byteLength: number;
  readonly sha256: string;
  readonly previousSha256: string | null;
}

export type RepositoryToolResult = RepositoryListResult | RepositoryReadResult | RepositoryWriteResult;

/** Repository-confined implementation behind the immutable Workbench Tool catalog. */
export class RepositoryToolExecutor {
  private readonly repositoryRoot: string;

  public constructor(repositoryRoot: string) {
    const suppliedRoot = resolve(repositoryRoot);
    if (lstatSync(suppliedRoot).isSymbolicLink()) throw new Error("linked-repository-root-requires-approval");
    const canonical = realpathSync(repositoryRoot);
    if (!statSync(canonical).isDirectory()) throw new Error("repository-root-must-be-directory");
    this.repositoryRoot = canonical;
  }

  public invoke(identity: string, input: unknown): RepositoryToolResult {
    if (identity === "files/list") return this.list(input);
    if (identity === "files/read") return this.read(input);
    if (identity === "files/write") return this.write(input);
    throw new Error("tool-not-found");
  }

  private list(input: unknown): RepositoryListResult {
    const value = record(input, ["path", "maxEntries"]);
    const requestedPath = optionalString(value.path, "path") ?? ".";
    const maxEntries = optionalInteger(value.maxEntries, "maxEntries", 1, MAX_LIST_ENTRIES) ?? DEFAULT_LIST_ENTRIES;
    const target = this.resolveExisting(requestedPath);
    if (!lstatSync(target.absolute).isDirectory()) throw new Error("path-must-be-directory");

    const all = readdirSync(target.absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    const entries = all.slice(0, maxEntries).map((entry) => {
      const absolute = join(target.absolute, entry.name);
      const kind = entry.isSymbolicLink() ? "link" : entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other";
      return {
        path: repositoryRelative(this.repositoryRoot, absolute),
        kind,
        byteLength: kind === "file" ? lstatSync(absolute).size : null,
      } as const;
    });
    return { path: target.relative, entries, truncated: all.length > entries.length };
  }

  private read(input: unknown): RepositoryReadResult {
    const value = record(input, ["path", "maxBytes"]);
    const requestedPath = requiredString(value.path, "path");
    const maxBytes = optionalInteger(value.maxBytes, "maxBytes", 1, MAX_FILE_BYTES) ?? DEFAULT_READ_BYTES;
    const target = this.resolveExisting(requestedPath);
    const bytes = readBoundedFile(target.absolute, maxBytes, "file-exceeds-read-limit");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("file-must-be-valid-utf8"); }
    return { path: target.relative, content, byteLength: bytes.byteLength, sha256: hash(bytes) };
  }

  private write(input: unknown): RepositoryWriteResult {
    const value = record(input, ["path", "mode", "content", "expectedSha256"]);
    const requestedPath = requiredString(value.path, "path");
    const mode = value.mode;
    if (mode !== "create" && mode !== "replace") throw new Error("mode-must-be-create-or-replace");
    const content = requiredString(value.content, "content", true);
    const bytes = Buffer.from(content, "utf8");
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("content-exceeds-write-limit");
    const expectedSha256 = optionalNullableHash(value.expectedSha256);
    const target = this.resolveWritable(requestedPath);
    let previousSha256: string | null = null;

    if (mode === "create") {
      if (expectedSha256 !== null) throw new Error("create-must-not-declare-expected-sha256");
      if (existsSync(target.absolute)) throw new Error("create-target-already-exists");
    } else {
      if (expectedSha256 === null) throw new Error("replace-requires-expected-sha256");
      const existing = this.resolveExisting(target.relative);
      if (!lstatSync(existing.absolute).isFile()) throw new Error("replace-target-must-be-regular-file");
      previousSha256 = hash(readBoundedFile(existing.absolute, MAX_FILE_BYTES, "replace-target-exceeds-write-limit"));
      if (previousSha256 !== expectedSha256) throw new Error("replace-target-changed");
    }

    const temporary = join(target.parent, `.bridgit-${randomUUID()}.tmp`);
    let temporaryExists = false;
    try {
      const descriptor = openSync(temporary, "wx", 0o600);
      temporaryExists = true;
      try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }

      if (mode === "create") {
        if (existsSync(target.absolute)) throw new Error("create-target-already-exists");
        linkSync(temporary, target.absolute);
        unlinkSync(temporary);
        temporaryExists = false;
      } else {
        const current = this.resolveExisting(target.relative);
        if (!lstatSync(current.absolute).isFile()) throw new Error("replace-target-must-be-regular-file");
        if (hash(readBoundedFile(current.absolute, MAX_FILE_BYTES, "replace-target-exceeds-write-limit")) !== expectedSha256) throw new Error("replace-target-changed");
        renameSync(temporary, target.absolute);
        temporaryExists = false;
      }
      syncDirectory(target.parent);
    } finally {
      if (temporaryExists) {
        try { unlinkSync(temporary); } catch { /* Preserve the original classified failure. */ }
      }
    }

    return {
      path: target.relative,
      operation: mode === "create" ? "created" : "replaced",
      byteLength: bytes.byteLength,
      sha256: hash(bytes),
      previousSha256,
    };
  }

  private resolveExisting(candidate: string): { readonly absolute: string; readonly relative: string } {
    const normalized = validateRepositoryPath(this.repositoryRoot, candidate);
    const absolute = resolve(this.repositoryRoot, normalized);
    this.rejectLinkedSegments(normalized, true);
    const canonical = realpathSync(absolute);
    assertContained(this.repositoryRoot, canonical);
    return { absolute: canonical, relative: repositoryRelative(this.repositoryRoot, canonical) || "." };
  }

  private resolveWritable(candidate: string): { readonly absolute: string; readonly relative: string; readonly parent: string } {
    const normalized = validateRepositoryPath(this.repositoryRoot, candidate);
    if (normalized === "" || normalized === ".") throw new Error("write-target-must-be-file");
    this.rejectLinkedSegments(normalized, false);
    const absolute = resolve(this.repositoryRoot, normalized);
    const parent = realpathSync(dirname(absolute));
    assertContained(this.repositoryRoot, parent);
    if (!lstatSync(parent).isDirectory()) throw new Error("write-parent-must-exist");
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) throw new Error("linked-path-rejected");
    return { absolute, relative: repositoryRelative(this.repositoryRoot, absolute), parent };
  }

  private rejectLinkedSegments(candidate: string, requireTarget: boolean): void {
    const segments = candidate === "." ? [] : candidate.split("/");
    let current = this.repositoryRoot;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      if (!existsSync(current)) {
        if (requireTarget || index < segments.length - 1) throw new Error("path-not-found");
        return;
      }
      if (lstatSync(current).isSymbolicLink()) throw new Error("linked-path-rejected");
    }
  }
}

function tool(identity: string, description: string, effectClass: ToolResource["effectClass"], inputSchema: JsonObject, resultSchema: JsonObject): ToolResource {
  return {
    identity,
    description,
    origin: "workbench",
    effectClass,
    status: "available",
    inputSchema,
    inputSchemaFingerprint: hash(Buffer.from(JSON.stringify(inputSchema))),
    resultSchema,
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

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) throw new Error(`${field}-must-be-string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${field}-out-of-range`);
  return value as number;
}

function optionalNullableHash(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("expected-sha256-invalid");
  return value;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readBoundedFile(path: string, maximum: number, limitError: string): Buffer {
  const metadata = lstatSync(path);
  if (!metadata.isFile()) throw new Error("path-must-be-regular-file");
  if (metadata.size > maximum) throw new Error(limitError);
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(maximum + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const read = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (read === 0) break;
      offset += read;
    }
    if (offset > maximum) throw new Error(limitError);
    return buffer.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

function repositoryRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function assertContained(root: string, target: string): void {
  if (target !== root && !target.startsWith(root + sep)) throw new Error("path-outside-repository-boundary");
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
