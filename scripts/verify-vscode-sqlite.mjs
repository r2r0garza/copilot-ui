import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultExtensionHostPath = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)";
const extensionHostPath = process.env.VSCODE_EXTENSION_HOST_PATH ?? defaultExtensionHostPath;

if (!existsSync(extensionHostPath)) {
  throw new Error(`VS Code Extension Host was not found at ${extensionHostPath}. Set VSCODE_EXTENSION_HOST_PATH to verify the extension runtime.`);
}

const verificationSource = [
  "const Database = require('better-sqlite3')",
  "const database = new Database(':memory:')",
  "database.prepare('SELECT 1 AS value').get()",
  "database.close()",
  "console.log('VS Code SQLite ABI:', process.versions.modules)",
].join("; ");

const result = spawnSync(extensionHostPath, ["-e", verificationSource], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
