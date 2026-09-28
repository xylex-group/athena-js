#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", join(cwd, "scripts/docs/cli.mts"), ...process.argv.slice(2)],
  { cwd, stdio: "inherit" }
);
process.exit(result.status ?? 1);
