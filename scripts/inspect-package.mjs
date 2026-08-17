#!/usr/bin/env node
/**
 * Lightweight export + tarball inspection for check:release (P14).
 * Does not publish. Fails if the public export map or packed files look empty.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!pkg.exports || typeof pkg.exports !== "object") {
  console.error("inspect-package: package.json exports map is missing");
  process.exit(1);
}

const required = [".", "./next/server", "./next/client", "./browser"];
for (const key of required) {
  if (!(key in pkg.exports)) {
    console.error(`inspect-package: missing export "${key}"`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "athena-js-pack-"));
try {
  const packed = execFileSync("pnpm", ["pack", "--pack-destination", dir], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!packed.includes(".tgz")) {
    console.error("inspect-package: pnpm pack did not produce a tarball");
    process.exit(1);
  }
  console.log(`inspect-package: packed ${packed.split(/\s+/).at(-1)}`);
} finally {
  rmSync(dir, { force: true, recursive: true });
}
