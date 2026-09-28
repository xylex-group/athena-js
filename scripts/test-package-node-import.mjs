#!/usr/bin/env node
/**
 * Plain-Node root import probes (ADR 0064).
 *
 * Proves `import("@xylex-group/athena")` and `require("@xylex-group/athena")`
 * without `test/register-server-only.mjs`, Next, or `react-server`.
 *
 * Usage (from packages/athena-js, after `pnpm build`):
 *   node scripts/test-package-node-import.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const probeDir = join(pkgRoot, ".tmp", "node-import-probe");

const SERVER_ONLY_POISON =
  /Client Component|server-only|should only be used from a Server Component/i;

function fail(message) {
  console.error(`test-package-node-import: ${message}`);
  process.exit(1);
}

function plainEnv() {
  const env = { ...process.env };
  if (typeof env.NODE_OPTIONS === "string" && env.NODE_OPTIONS.length > 0) {
    env.NODE_OPTIONS = env.NODE_OPTIONS.split(/\s+/)
      .filter(
        (token) => token.length > 0 && !/register-server-only/i.test(token)
      )
      .join(" ");
  }
  return env;
}

function spawnPlain(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: plainEnv(),
  });
}

function assertOk(label, result) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (SERVER_ONLY_POISON.test(text)) {
    fail(`${label} leaked server-only:\n${text}`);
  }
  if (result.status !== 0) {
    fail(`${label} exited ${result.status}:\n${text}`);
  }
  console.log(`OK: ${label}`);
}

if (!existsSync(join(pkgRoot, "dist", "index.js"))) {
  fail("missing dist/index.js — run pnpm build first");
}
if (!existsSync(join(pkgRoot, "dist", "index.cjs"))) {
  fail("missing dist/index.cjs — run pnpm build first");
}

rmSync(probeDir, { force: true, recursive: true });
mkdirSync(probeDir, { recursive: true });

try {
  const esmProbe = join(probeDir, "esm-root-probe.mjs");
  writeFileSync(
    esmProbe,
    `await import("@xylex-group/athena");
console.log("esm-root:ok");
`
  );
  assertOk(
    'ESM import("@xylex-group/athena")',
    spawnPlain([esmProbe], pkgRoot)
  );

  const cjsProbe = join(probeDir, "cjs-root-probe.cjs");
  writeFileSync(
    cjsProbe,
    `require("@xylex-group/athena");
console.log("cjs-root:ok");
`
  );
  assertOk(
    'CJS require("@xylex-group/athena")',
    spawnPlain([cjsProbe], pkgRoot)
  );

  console.log("PASS: plain Node root ESM/CJS import without server-only shim");
} finally {
  rmSync(probeDir, { force: true, recursive: true });
}
