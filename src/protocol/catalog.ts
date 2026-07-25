import type { AnySchema } from "ajv";

export const protocolVersion = 1 as const;
export const catalogRevision = 1 as const;

export interface ProtocolHello { kind: "protocol.hello"; webviewInstanceId: string; webviewRelease: string; supportedProtocolVersions: number[]; bootstrapNonce: string; }
export interface ProtocolRequest { protocolVersion: 1; kind: "command" | "query"; name: "workbench.snapshot.get" | "chat.session.create" | "chat.turn.send"; requestId: string; webviewInstanceId: string; correlationId: string; causationId: string | null; operation: { operationId: string; intentId: string; submittedAt: string }; expectedVersions: Array<{ aggregateType: string; aggregateId: string; version: number | "absent" }>; payload: Record<string, unknown>; }

const id = { type: "string", minLength: 1, maxLength: 128 } as const;
const noExtra = { additionalProperties: false } as const;

export const helloSchema: AnySchema = { type: "object", ...noExtra, required: ["kind", "webviewInstanceId", "webviewRelease", "supportedProtocolVersions", "bootstrapNonce"], properties: { kind: { const: "protocol.hello", type: "string" }, webviewInstanceId: id, webviewRelease: { type: "string", minLength: 1, maxLength: 64 }, supportedProtocolVersions: { type: "array", minItems: 1, maxItems: 10, items: { type: "integer", minimum: 1 } }, bootstrapNonce: id } };

export const requestSchema: AnySchema = { type: "object", ...noExtra, required: ["protocolVersion", "kind", "name", "requestId", "webviewInstanceId", "correlationId", "causationId", "operation", "expectedVersions", "payload"], properties: { protocolVersion: { const: protocolVersion, type: "integer" }, kind: { enum: ["command", "query"], type: "string" }, name: { enum: ["workbench.snapshot.get", "chat.session.create", "chat.turn.send"], type: "string" }, requestId: id, webviewInstanceId: id, correlationId: id, causationId: { anyOf: [id, { type: "null" }] }, operation: { type: "object", ...noExtra, required: ["operationId", "intentId", "submittedAt"], properties: { operationId: id, intentId: id, submittedAt: { type: "string", format: "date-time" } } }, expectedVersions: { type: "array", maxItems: 64, items: { type: "object", ...noExtra, required: ["aggregateType", "aggregateId", "version"], properties: { aggregateType: id, aggregateId: id, version: { anyOf: [{ type: "integer", minimum: 0 }, { const: "absent", type: "string" }] } } } }, payload: { type: "object", maxProperties: 32, additionalProperties: true, required: [] } } };
