import { catalogRevision, protocolVersion, type ProtocolHello, type ProtocolRequest } from "./catalog";
import { validateProtocolHello, validateProtocolRequest } from "./validator";

export interface AuthoritativeSnapshot { readonly snapshotId: string; readonly workspaceId: string; readonly streamId: string; readonly throughSequence: number; readonly generatedAt: string; readonly chats: { readonly sessions: readonly unknown[]; readonly turns: readonly unknown[]; readonly attempts: readonly unknown[] }; }
export type GatewayResponse = { readonly kind: "protocol.welcome"; readonly selectedProtocolVersion: 1; readonly catalogRevision: 1; readonly webviewInstanceId: string; readonly snapshot: AuthoritativeSnapshot } | { readonly kind: "protocol.reload-required"; readonly reason: "protocol-mismatch" | "instance-superseded" } | { readonly kind: "result"; readonly outcome: "rejected"; readonly code: string; readonly requestId: string | null };

export interface ProtocolGatewayOptions { readonly webviewInstanceId: string; readonly bootstrapNonce: string; readonly workspaceId: string; readonly snapshot: () => AuthoritativeSnapshot; }

/** Production and headless adapters both enter the Runtime through this boundary. */
export class ProtocolGateway {
  private bound = false;
  private readonly requestFingerprints = new Map<string, string>();
  private readonly acceptedResults = new Map<string, unknown>();

  public constructor(private readonly options: ProtocolGatewayOptions) {}

  public hello(value: unknown): GatewayResponse {
    const parsed = validateProtocolHello(value);
    if (!parsed.ok) return { kind: "protocol.reload-required", reason: "protocol-mismatch" };
    return this.acceptHello(parsed.value);
  }

  public validateRequest(value: unknown): GatewayResponse | ProtocolRequest {
    const parsed = validateProtocolRequest(value);
    if (!parsed.ok) return { kind: "result", outcome: "rejected", code: "schema-invalid", requestId: null };
    if (!this.bound) return { kind: "result", outcome: "rejected", code: "webview-unbound", requestId: parsed.value.requestId };
    if (parsed.value.webviewInstanceId !== this.options.webviewInstanceId) return { kind: "result", outcome: "rejected", code: "webview-instance-mismatch", requestId: parsed.value.requestId };
    const fingerprint = JSON.stringify(parsed.value);
    const previous = this.requestFingerprints.get(parsed.value.requestId);
    if (previous && previous !== fingerprint) return { kind: "result", outcome: "rejected", code: "request-identity-conflict", requestId: parsed.value.requestId };
    this.requestFingerprints.set(parsed.value.requestId, fingerprint);
    return parsed.value;
  }

  public rememberAccepted(operationId: string, result: unknown): unknown { const prior = this.acceptedResults.get(operationId); if (prior !== undefined) return prior; this.acceptedResults.set(operationId, result); return result; }

  public snapshot(): GatewayResponse | AuthoritativeSnapshot { return this.bound ? this.options.snapshot() : { kind: "result", outcome: "rejected", code: "webview-unbound", requestId: null }; }

  private acceptHello(hello: ProtocolHello): GatewayResponse {
    if (hello.webviewInstanceId !== this.options.webviewInstanceId || hello.bootstrapNonce !== this.options.bootstrapNonce) return { kind: "protocol.reload-required", reason: "instance-superseded" };
    if (!hello.supportedProtocolVersions.includes(protocolVersion)) return { kind: "protocol.reload-required", reason: "protocol-mismatch" };
    this.bound = true;
    return { kind: "protocol.welcome", selectedProtocolVersion: protocolVersion, catalogRevision, webviewInstanceId: hello.webviewInstanceId, snapshot: this.options.snapshot() };
  }
}
