import { spawnSync } from "node:child_process";

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let status = 1;
try {
  if (
    run(packageManager, ["run", "rebuild:node"]) === 0 &&
    run(packageManager, ["run", "compile"]) === 0
  ) {
    status = run(node, ["scripts/manual-test-m3.mjs", ...process.argv.slice(2)]);
  }
} finally {
  const restoreStatus = run(packageManager, ["run", "rebuild:vscode"]);
  if (restoreStatus !== 0) status = restoreStatus;
  else if (run(packageManager, ["run", "verify:vscode"]) !== 0) status = 1;
}

process.exitCode = status;
