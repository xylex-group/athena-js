#!/usr/bin/env node

/**
 * Browser bundle dependency audit for @xylex-group/athena.
 *
 * Regression guard for ATHENA_BROWSER_BUNDLE_PG_LEAK (4.3.1): the browser
 * bundle statically reached `postgres/transport.ts` → `postgres/driver.ts` →
 * `import("pg")`, breaking Next.js/Turbopack with `Can't resolve 'dns'`.
 *
 * This script fails (exit 1) if the built browser artifacts contain any
 * runtime reference to `pg` or Node built-ins (dns/net/tls/fs/child_process/…).
 *
 * Usage (from packages/athena-js):
 *   pnpm build
 *   node scripts/audit-browser-bundle-safety.mjs
 *
 * Optional:
 *   node scripts/audit-browser-bundle-safety.mjs --build
 *     runs `pnpm build` in this package first
 *
 * Exit 0: dist/browser.{js,cjs} contain no forbidden dependency patterns.
 * Exit 1: missing artifacts or forbidden patterns found.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const distDir = join(packageRoot, "dist");

/**
 * Patterns that must not appear in built browser artifacts. These match
 * actual import/require sites — not prose in error messages.
 */
const BROWSER_FORBIDDEN = [
  { id: "pg (static)", re: /from\s+["']pg["']|require\(["']pg["']\)/ },
  { id: "pg (dynamic)", re: /import\(["']pg["']\)/ },
  {
    id: "dns",
    re: /from\s+["']dns["']|require\(["']dns["']\)|["']node:dns["']/,
  },
  {
    id: "net",
    re: /from\s+["']net["']|require\(["']net["']\)|["']node:net["']/,
  },
  {
    id: "tls",
    re: /from\s+["']tls["']|require\(["']tls["']\)|["']node:tls["']/,
  },
  {
    id: "fs",
    re: /from\s+["']fs(?:\/promises)?["']|require\(["']fs["']\)|["']node:fs["']/,
  },
  {
    id: "child_process",
    re: /from\s+["']child_process["']|require\(["']child_process["']\)|["']node:child_process["']/,
  },
  {
    id: "postgres transport/driver sources",
    re: /postgres\/(?:transport|driver)\.ts/,
  },
];

const BROWSER_ARTIFACTS = ["browser.js", "browser.cjs"];

function maybeBuild(args) {
  if (!args.includes("--build")) {
    return;
  }
  console.log("=== --build: building package first ===");
  const result = spawnSync("pnpm", ["build"], {
    cwd: packageRoot,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`[browser bundle audit] build failed (${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function scanArtifact(name) {
  const path = join(distDir, name);
  if (!existsSync(path)) {
    console.error(
      `[browser bundle audit] missing dist/${name} — run the package build first:\n` +
        "  pnpm --dir packages/athena-js build\n" +
        "  or: node scripts/audit-browser-bundle-safety.mjs --build"
    );
    process.exit(1);
  }

  const content = readFileSync(path, "utf8");
  const size = statSync(path).size;
  console.log(`--- dist/${name} (${size} bytes) ---`);

  const hits = BROWSER_FORBIDDEN.filter((rule) => rule.re.test(content)).map(
    (rule) => rule.id
  );
  if (hits.length > 0) {
    console.error(`FAIL: dist/${name} contains forbidden runtime dependencies:`);
    for (const id of hits) {
      console.error(`  - ${id}`);
    }
    console.error(
      "\nThe browser entry must have zero runtime dependency on pg and Node\n" +
        "built-ins. Direct PostgreSQL materialization belongs to the Node-only\n" +
        "entry (src/v3-client.ts), never to src/v3-client-core.ts or src/browser.ts."
    );
    process.exit(1);
  }

  if (!/ATHENA_POSTGRES_DIRECT_NODE_REQUIRED/.test(content)) {
    console.error(
      `FAIL: dist/${name} is missing the ATHENA_POSTGRES_DIRECT_NODE_REQUIRED guard\n` +
        "  (browser db.pgUri must fail fast with a server-only diagnostic)."
    );
    process.exit(1);
  }

  console.log(
    `OK: dist/${name} — no pg / dns / net / tls / fs / child_process runtime references; pgUri guard present`
  );
}

function main() {
  const args = process.argv.slice(2);
  maybeBuild(args);
  console.log("=== Browser bundle dependency audit ===");
  console.log(`package root: ${packageRoot}`);
  for (const artifact of BROWSER_ARTIFACTS) {
    scanArtifact(artifact);
  }
  console.log(
    "\nPASS: browser bundle has zero runtime dependency on pg / Node built-ins"
  );
}

main();
