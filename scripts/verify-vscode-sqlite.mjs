import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultElectronPath = "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";
const electronPath = process.env.VSCODE_ELECTRON_PATH ?? defaultElectronPath;

if (!existsSync(electronPath)) {
  throw new Error(`VS Code Electron was not found at ${electronPath}. Set VSCODE_ELECTRON_PATH to verify the extension runtime.`);
}

const result = spawnSync(electronPath, ["-e", "require('better-sqlite3'); console.log('VS Code SQLite ABI:', process.versions.modules)"], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
