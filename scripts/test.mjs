import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const run = (args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

let status = 1;
try {
  if (run(["run", "rebuild:node"]) === 0) status = run(["run", "verify"]);
} finally {
  const restoreStatus = run(["run", "rebuild:vscode"]);
  if (restoreStatus !== 0) status = restoreStatus;
  else if (run(["run", "verify:vscode"]) !== 0) status = 1;
}

process.exitCode = status;
