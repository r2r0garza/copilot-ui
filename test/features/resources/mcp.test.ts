import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import test from "node:test";

import {
  prepareMcpConnection,
  readMcpConfiguration,
  resolveMcpInput,
  startMcpOAuth,
  type McpInputPort,
  type McpVariableValues,
} from "../../../src/features/resources/mcp";

test("validates stdio, HTTP, and SSE servers independently", () => {
  const file = mcpFile({
    inputs: [
      { id: "token", type: "promptString", description: "Token", password: true },
      { id: "region", type: "pickString", description: "Region", options: ["west", "east"] },
      { id: "account", type: "command", command: "extension.pickAccount" },
    ],
    servers: {
      local: {
        command: "node",
        args: ["server.js", "${input:region}"],
        cwd: "${workspaceFolder}",
        env: { TOKEN: "${input:token}" },
        dev: { watch: "src/**/*.ts" },
      },
      remote: {
        type: "http",
        url: "https://example.test/${input:account}",
        oauth: { clientId: "client-id" },
      },
      events: { type: "sse", url: "https://events.example.test" },
      broken: { type: "http", command: "node", url: "https://invalid.test" },
      sandboxed: { command: "node", sandboxEnabled: true },
      literalSecret: { command: "node", env: { API_KEY: "do-not-store-this" } },
    },
  });

  const catalog = readMcpConfiguration(file);
  assert.equal(catalog.topLevelValid, true);
  assert.deepEqual(catalog.servers.map((server) => [server.name, server.transport, server.status]), [
    ["broken", null, "invalid"],
    ["events", "sse", "available"],
    ["literalSecret", null, "invalid"],
    ["local", "stdio", "available"],
    ["remote", "http", "available"],
    ["sandboxed", "stdio", "unavailable"],
  ]);
  assert.deepEqual(catalog.servers.find((server) => server.name === "local")?.inputIds, ["region", "token"]);
  assert.equal(catalog.servers.find((server) => server.name === "remote")?.requiresOAuth, true);
  assert.equal(catalog.definitions.has("sandboxed"), false);
  assert.equal(catalog.diagnostics.some((item) => item.code === "mcp.dev-ignored"), true);
});

test("malformed input and server entries stay isolated from unrelated servers", () => {
  const invalidInputs = readMcpConfiguration(mcpFile({ inputs: [{ id: "x", type: "pickString", options: [] }], servers: { valid: { command: "node" } } }));
  assert.equal(invalidInputs.topLevelValid, true);
  assert.equal(invalidInputs.servers[0].status, "available");
  assert.equal(invalidInputs.diagnostics.some((item) => item.code === "mcp.input-invalid"), true);

  const isolated = readMcpConfiguration(mcpFile({
    inputs: [{ id: "token", type: "promptString" }],
    servers: {
      valid: { command: "node" },
      missing: { command: "node", env: { TOKEN: "${input:missing}" } },
      envFile: { command: "node", envFile: ".env" },
    },
  }));
  assert.equal(isolated.servers.find((server) => server.name === "valid")?.status, "available");
  assert.equal(isolated.servers.find((server) => server.name === "missing")?.status, "invalid");
  assert.equal(isolated.servers.find((server) => server.name === "envFile")?.status, "invalid");
});

test("input resolution cannot prompt or execute commands without a user action", async () => {
  const calls: string[] = [];
  const port: McpInputPort = {
    async prompt() { calls.push("prompt"); return "secret"; },
    async pick() { calls.push("pick"); return "west"; },
    async executeCommand() { calls.push("command"); return "account"; },
  };
  const configuration = readMcpConfiguration(mcpFile({
    inputs: [
      { id: "token", type: "promptString" },
      { id: "region", type: "pickString", options: ["west"] },
      { id: "account", type: "command", command: "extension.pickAccount" },
    ],
    servers: {},
  }));

  await assert.rejects(() => resolveMcpInput(configuration.inputs.get("token")!, port, false), /requires-user-action/);
  assert.deepEqual(calls, []);
  assert.equal(await resolveMcpInput(configuration.inputs.get("token")!, port, true), "secret");
  assert.equal(await resolveMcpInput(configuration.inputs.get("region")!, port, true), "west");
  assert.equal(await resolveMcpInput(configuration.inputs.get("account")!, port, true), "account");
  assert.deepEqual(calls, ["prompt", "pick", "command"]);
});

test("OAuth returns only an opaque credential handle and requires a user action", async () => {
  const configuration = readMcpConfiguration(mcpFile({
    servers: { remote: { type: "http", url: "https://example.test/mcp", oauth: { clientId: "client-id" } } },
  }));
  const server = configuration.definitions.get("remote")!;
  let calls = 0;
  const port = { async authorize() { calls += 1; return { credentialHandle: "secret-storage:remote" }; } };
  await assert.rejects(() => startMcpOAuth(server, port, false), /requires-user-action/);
  assert.equal(calls, 0);
  assert.deepEqual(await startMcpOAuth(server, port, true), { credentialHandle: "secret-storage:remote" });
  assert.equal(calls, 1);
});

test("connection plans require exact trust and contain only explicit environment values", () => {
  const workspace = mkdtempSync(join(tmpdir(), "bridgit-mcp-workspace-"));
  const configuration = readMcpConfiguration(mcpFile({
    inputs: [{ id: "token", type: "promptString", password: true }],
    servers: {
      local: {
        command: "${env:NODE}",
        args: ["server.js", "${workspaceFolderBasename}"],
        cwd: "${workspaceFolder}",
        env: { TOKEN: "${input:token}", HOME_ALIAS: "${userHome}" },
      },
    },
  }));
  const server = configuration.definitions.get("local")!;
  const values: McpVariableValues = {
    workspaceFolder: workspace,
    workspaceFolderBasename: basename(workspace),
    userHome: "/safe/user-home",
    pathSeparator: sep,
    environment: { NODE: "node", SHOULD_NOT_LEAK: "secret" },
    inputs: {},
  };

  assert.equal(prepareMcpConnection(server, undefined, values).status, "blocked");
  assert.equal(prepareMcpConnection(server, { fingerprint: "0".repeat(64), decision: "trusted" }, values).status, "blocked");
  assert.equal(prepareMcpConnection(server, { fingerprint: server.fingerprint, decision: "denied" }, values).status, "blocked");
  const trust = { fingerprint: server.fingerprint, decision: "trusted" } as const;
  const missing = prepareMcpConnection(server, trust, values);
  assert.deepEqual(missing, { status: "blocked", reasonCode: "input-required", detail: "Input 'token' requires a user action." });

  const ready = prepareMcpConnection(server, trust, { ...values, inputs: { token: "resolved-secret" } });
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.equal(ready.plan.command, "node");
  assert.equal(ready.plan.cwd, workspace);
  assert.deepEqual(ready.plan.environment, { TOKEN: "resolved-secret", HOME_ALIAS: "/safe/user-home" });
  assert.equal(ready.plan.inheritProcessEnvironment, false);
  assert.match(ready.plan.isolationKey, /^local:[a-f0-9]{64}$/);
});

test("fingerprints are canonical and change for material server configuration changes", () => {
  const first = readMcpConfiguration(mcpFile({ servers: { server: { command: "node", args: ["a"], env: { B: "2", A: "1" } } } }));
  const reordered = readMcpConfiguration(mcpFile({ servers: { server: { env: { A: "1", B: "2" }, args: ["a"], command: "node" } } }));
  const changed = readMcpConfiguration(mcpFile({ servers: { server: { command: "node", args: ["b"], env: { A: "1", B: "2" } } } }));
  assert.equal(first.servers[0].fingerprint, reordered.servers[0].fingerprint);
  assert.notEqual(first.servers[0].fingerprint, changed.servers[0].fingerprint);
});

function mcpFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "bridgit-mcp-"));
  mkdirSync(join(root, ".vscode"), { recursive: true });
  const file = join(root, ".vscode", "mcp.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}
