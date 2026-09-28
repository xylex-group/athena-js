#!/usr/bin/env node
/**
 * Workspace-dev CLI: runs TypeScript `src/cli/bin.ts` via tsx.
 * Production `bin/athena-js.js` continues to load packed `dist/cli/index.js`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(binPath), "..");
const entry = path.join(packageRoot, "src", "cli", "bin.ts");
const projectCwd = process.cwd();

const child = spawn(
  process.execPath,
  ["--import", "tsx", entry, "--cwd", projectCwd, ...process.argv.slice(2)],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
