#!/usr/bin/env node
/**
 * Full tsup (JS + dts). The dts worker OOMs at the default heap; workers
 * inherit NODE_OPTIONS, so raise it before spawn.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const tsupCli = require.resolve("tsup/dist/cli-default.js");

const heap = "--max-old-space-size=16384";
const existing = process.env.NODE_OPTIONS ?? "";
if (!existing.includes("max-old-space-size")) {
  process.env.NODE_OPTIONS = existing ? `${existing} ${heap}` : heap;
}

const result = spawnSync(
  process.execPath,
  [tsupCli, ...process.argv.slice(2)],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  }
);
process.exit(result.status === null ? 1 : result.status);
