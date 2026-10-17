#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = process.platform === "win32" ? "publint.cmd" : "publint";

const result = spawnSync(bin, [], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
