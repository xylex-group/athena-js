#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") {
  console.error("Usage: node scripts/check-export.mjs ios|android");
  process.exit(2);
}

const output = join(".expo-export", platform);
rmSync(output, { force: true, recursive: true });
const result = spawnSync(
  process.execPath,
  [
    "./node_modules/expo/bin/cli",
    "export",
    "--platform",
    platform,
    "--no-bytecode",
    "--output-dir",
    output,
  ],
  {
    encoding: "utf8",
    shell: false,
    stdio: "inherit",
  }
);
const exported = existsSync(output);
rmSync(output, { force: true, recursive: true });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (!exported) {
  console.error(`[expo-rn53] ${platform} export did not create ${output}`);
  process.exit(1);
}
console.log(`[expo-rn53] OK: production ${platform} export`);
