#!/usr/bin/env node
/**
 * Transitive build-output audit for Node vs Next `server-only` (ADR 0064).
 *
 * Root + CLI artifacts must not import `server-only`. Public/framework
 * server edges must keep the marker. Browser/RN/next-client stay free of it.
 *
 * Usage (from packages/athena-js, after `pnpm build`):
 *   node scripts/audit-runtime-boundaries.mjs
 *
 * Exit 0: allowlist/denylist holds.
 * Exit 1: missing artifacts or a boundary violation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");

const SERVER_ONLY_IMPORT_RE =
  /\bimport\s*["']server-only["']|\bfrom\s*["']server-only["']|\brequire\(\s*["']server-only["']\s*\)/;

const NODE_ROOT_FORBIDDEN = [
  { id: "server-only", re: SERVER_ONLY_IMPORT_RE },
  { id: "next/headers", re: /["']next\/headers["']/ },
  { id: "next/navigation", re: /["']next\/navigation["']/ },
  { id: "next/server", re: /["']next\/server["']/ },
];

const BROWSER_FORBIDDEN = [
  { id: "server-only", re: SERVER_ONLY_IMPORT_RE },
  { id: "pg", re: /["']pg["']/ },
  { id: "node:fs", re: /["']node:fs(?:\/promises)?["']/ },
  { id: "node:net", re: /["']node:net["']/ },
  { id: "node:tls", re: /["']node:tls["']/ },
  { id: "node:dns", re: /["']node:dns["']/ },
];

const NODE_ROOT_ARTIFACTS = ["index.js", "index.cjs"];

const BROWSER_ARTIFACTS = [
  "browser.js",
  "browser.cjs",
  "next/client.js",
  "next/client.cjs",
  "react-native.js",
  "react-native.cjs",
];

const REQUIRED_SERVER_ONLY = [
  "server.js",
  "server.cjs",
  "next/server.js",
  "next/server.cjs",
  "next/session.js",
  "next/session.cjs",
  "auth/server.js",
  "auth/server.cjs",
  "email/node.js",
  "email/node.cjs",
];

function posix(path) {
  return path.replaceAll("\\", "/");
}

function collectFiles(dir, suffixes) {
  const out = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, suffixes));
      continue;
    }
    if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

function readDist(rel) {
  const path = join(distDir, rel);
  if (!existsSync(path)) {
    console.error(
      `[runtime-boundaries] missing dist/${posix(rel)} — run pnpm build first`
    );
    process.exit(1);
  }
  return {
    content: readFileSync(path, "utf8"),
    path,
    size: statSync(path).size,
  };
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function main() {
  console.log("=== Runtime boundary audit (server-only) ===");
  console.log(`package root: ${packageRoot}`);

  for (const rel of NODE_ROOT_ARTIFACTS) {
    const { content, size } = readDist(rel);
    console.log(`--- dist/${posix(rel)} (${size} bytes) ---`);
    for (const rule of NODE_ROOT_FORBIDDEN) {
      if (rule.re.test(content)) {
        fail(`dist/${posix(rel)} must not contain ${rule.id}`);
      }
    }
    console.log(`OK: dist/${posix(rel)} — Node-root denylist`);
  }

  for (const rel of BROWSER_ARTIFACTS) {
    const { content, size } = readDist(rel);
    console.log(`--- dist/${posix(rel)} (${size} bytes) ---`);
    for (const rule of BROWSER_FORBIDDEN) {
      if (rule.re.test(content)) {
        fail(`dist/${posix(rel)} must not contain ${rule.id}`);
      }
    }
    console.log(`OK: dist/${posix(rel)} — browser denylist`);
  }

  const cliRoot = join(distDir, "cli");
  if (!existsSync(cliRoot)) {
    fail("missing dist/cli — run pnpm build first");
  }
  for (const file of collectFiles(cliRoot, [".js", ".cjs"])) {
    const rel = posix(relative(packageRoot, file));
    const content = readFileSync(file, "utf8");
    if (SERVER_ONLY_IMPORT_RE.test(content)) {
      fail(`${rel} must not contain server-only`);
    }
  }
  console.log("OK: dist/cli/** — no server-only");

  for (const rel of REQUIRED_SERVER_ONLY) {
    const { content, size } = readDist(rel);
    console.log(`--- dist/${posix(rel)} (${size} bytes) ---`);
    if (!SERVER_ONLY_IMPORT_RE.test(content)) {
      fail(`dist/${posix(rel)} must keep server-only`);
    }
    console.log(`OK: dist/${posix(rel)} — server-only present`);
  }

  console.log(
    "\nPASS: Node root/CLI are server-only-free; public edges keep the marker"
  );
}

main();
