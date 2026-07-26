import * as vscode from "vscode";

import type { ProtocolRequest } from "./catalog";
import { ProtocolGateway, type GatewayResponse } from "./gateway";

export type ProtocolDispatcher = (request: ProtocolRequest) => Promise<unknown>;

/** Production bridge: the only Webview ingress is validated by ProtocolGateway. */
export function bindProductionProtocol(panel: vscode.WebviewPanel, gateway: ProtocolGateway, dispatch: ProtocolDispatcher): vscode.Disposable {
  return panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const result = isHello(message) ? gateway.hello(message) : gateway.validateRequest(message);
    if (isRequest(result)) {
      const value = await dispatch(result);
      await panel.webview.postMessage({ kind: "result", outcome: "accepted", requestId: result.requestId, value });
      return;
    }
    await panel.webview.postMessage(result);
  });
}

/** Headless adapter uses the exact same gateway and dispatcher as the production bridge. */
export function createFakeProtocolAdapter(gateway: ProtocolGateway, dispatch: ProtocolDispatcher): { receive(message: unknown): Promise<GatewayResponse | unknown> } {
  return { async receive(message) { const result = isHello(message) ? gateway.hello(message) : gateway.validateRequest(message); return isRequest(result) ? dispatch(result) : result; } };
}

function isHello(value: unknown): value is { kind: "protocol.hello" } { return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "protocol.hello"; }
function isRequest(value: GatewayResponse | ProtocolRequest): value is ProtocolRequest { return "protocolVersion" in value; }
