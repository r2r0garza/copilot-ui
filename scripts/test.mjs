import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
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
}

process.exitCode = status;
