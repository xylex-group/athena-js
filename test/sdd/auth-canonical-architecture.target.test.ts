/**
 * Target RED on PR #696 pin acb0f21c — thin createAthenaAuthRuntime + JS adapter.
 * Encodes original found case (monolith handleRoute + forget-password/invitation
 * procedures + missing adapter). Spec: docs/sdd/xylex/athena-auth-canonical-architecture/
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const localRoot = join(pkgRoot, "src", "auth", "local");
const authRoot = join(pkgRoot, "src", "auth");
const runtimeSrc = readFileSync(join(localRoot, "runtime.ts"), "utf8");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(next));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(next);
    }
  }
  return out;
}

function filesContaining(root: string, needle: string): string[] {
  return walkTs(root).filter((file) =>
    readFileSync(file, "utf8").includes(needle)
  );
}

function sourceContaining(root: string, needle: string): string {
  return filesContaining(root, needle)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

test("P1: athena-js runtime.ts 2300+ line monolith — createRuntimeDependencies exists", () => {
  assert.ok(
    filesContaining(localRoot, "createRuntimeDependencies").length > 0,
    "createRuntimeDependencies must exist under src/auth/local"
  );
});

test("P1: athena-js runtime.ts 2300+ line monolith — createAuthRouter + typed route()", () => {
  const files = filesContaining(localRoot, "createAuthRouter");
  assert.ok(
    files.length > 0,
    "createAuthRouter must exist under src/auth/local"
  );
  const src = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(src, /\broute\s*\(/);
});

test("P1: athena-js runtime.ts 2300+ line monolith — route() domains", () => {
  const src = sourceContaining(localRoot, "createAuthRouter");
  assert.ok(src.length > 0, "createAuthRouter source required for domain list");
  for (const domain of [
    "session",
    "credential",
    "user",
    "organization",
    "passkey",
    "token",
    "email",
    "admin",
  ]) {
    assert.match(src, new RegExp(`\\b${domain}\\b`));
  }
});

test("P1: athena-js runtime.ts 2300+ line monolith — request middleware", () => {
  const named = [
    ...filesContaining(localRoot, "createAuthRequestMiddleware"),
    ...filesContaining(localRoot, "createRequestMiddleware"),
  ];
  assert.ok(
    named.length > 0,
    "named request middleware factory (createAuthRequestMiddleware) must exist"
  );
  const src = named.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(src, /enforceOrigin/);
  assert.match(src, /runWithAuthRequestTiming|attachAuthTimingHeaders/);
  assert.match(src, /runWithAuthTrace|errorResponse/);
});

test("P1: athena-js runtime.ts 2300+ line monolith — createAthenaAuthRuntime composes deps + router", () => {
  assert.match(runtimeSrc, /createRuntimeDependencies/);
  assert.match(runtimeSrc, /createAuthRouter/);
});

test("P1: athena-js runtime.ts 2300+ line monolith — runtime.ts does not own forget-password biz", () => {
  assert.doesNotMatch(runtimeSrc, /path === "\/forget-password"/);
  assert.doesNotMatch(
    runtimeSrc,
    /eventType:\s*authEmailEvents\.user\.password\.reset/
  );
});

test("P1: athena-js runtime.ts 2300+ line monolith — runtime.ts does not own invitation biz", () => {
  assert.doesNotMatch(runtimeSrc, /path === "\/organization\/invite-member"/);
  assert.doesNotMatch(
    runtimeSrc,
    /event:\s*"organization\.invitation\.create"/
  );
});

test("P1: Auth UI client.ts god-object — BetterAuthCompatibilityAdapter lives in Athena JS", () => {
  const adapterPath = join(authRoot, "better-auth-adapter.ts");
  assert.equal(
    existsSync(adapterPath),
    true,
    "src/auth/better-auth-adapter.ts"
  );
  const src = readFileSync(adapterPath, "utf8");
  assert.ok(
    src.includes("BetterAuthCompatibilityAdapter") ||
      src.includes("createBetterAuthCompatibilityAdapter")
  );
});
