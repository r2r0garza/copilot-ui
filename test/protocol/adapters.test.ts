import assert from "node:assert/strict";
import test from "node:test";
import { createFakeProtocolAdapter } from "../../src/protocol/adapters";
import { ProtocolGateway } from "../../src/protocol/gateway";

test("fake adapter dispatches only a gateway-validated request", async () => {
  const gateway = new ProtocolGateway({ webviewInstanceId: "panel", bootstrapNonce: "nonce", workspaceId: "workspace", snapshot: () => ({ snapshotId: "s", workspaceId: "workspace", streamId: "stream", throughSequence: 0, generatedAt: "2026-07-25T00:00:00.000Z", chats: { sessions: [], turns: [], attempts: [] } }) });
  const adapter = createFakeProtocolAdapter(gateway, async (request) => ({ dispatched: request.name }));
  await adapter.receive({ kind: "protocol.hello", webviewInstanceId: "panel", webviewRelease: "0.1.0", supportedProtocolVersions: [1], bootstrapNonce: "nonce" });
  const result = await adapter.receive({ protocolVersion: 1, kind: "query", name: "workbench.snapshot.get", requestId: "r", webviewInstanceId: "panel", correlationId: "c", causationId: null, operation: { operationId: "o", intentId: "i", submittedAt: "2026-07-25T00:00:00.000Z" }, expectedVersions: [], payload: {} });
  assert.deepEqual(result, { dispatched: "workbench.snapshot.get" });
});
