/**
 * P1 freeze TARGET — combined program pack existence (docs only).
 *
 * DESIRED (this slice): combined pack + Track C pack + remainder at
 * CURRENT HEAD d1ac057be86c58170423a7e2461589604e7a55db. Sequence P2–P15
 * then O1–O20 / PR 1–15. Do not demand product src.
 *
 * GREEN after pack write. Never `pnpm test:sdd`.
 *
 * Spec: docs/sdd/xylex/athena-auth-runtime-finality/specs/01-p1-program-freeze.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-auth-runtime-finality.p1-freeze.baseline.test.ts
 *   test/sdd/athena-auth-runtime-finality.p1-freeze.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const combinedDir = join(
  repoRoot,
  "docs",
  "sdd",
  "xylex",
  "athena-auth-runtime-finality"
);
const trackCDir = join(
  repoRoot,
  "docs",
  "sdd",
  "xylex",
  "athena-social-oauth-embedded-finality"
);
const remainderPath = join(
  repoRoot,
  "docs",
  "sdd",
  "xylex",
  "athena-embedded-auth-remainder.md"
);

const CURRENT_HEAD = "d1ac057be86c58170423a7e2461589604e7a55db";
const STALE_REMAINDER_PIN = "f2e2ed678ae19e815d5b40ce5f15427cdb12209b";

const COMBINED_FILES = [
  "README.md",
  "SPEC.md",
  "PHASE-0-FREEZE.md",
  "specs/01-p1-program-freeze.md",
] as const;

const TRACK_C_FILES = [
  "README.md",
  "SPEC.md",
  "PHASE-0-FREEZE.md",
  "specs/01-contract-freeze.md",
] as const;

const MATRIX_STUBS = [
  "matrices/provider.md",
  "matrices/route.md",
  "matrices/security.md",
  "matrices/collision.md",
  "matrices/session.md",
] as const;

function readCombined(rel: string): string {
  const path = join(combinedDir, rel);
  assert.equal(existsSync(path), true, `missing combined file ${rel}`);
  return readFileSync(path, "utf8");
}

test("T-RTF-PACK: combined program pack exists and pins live HEAD", () => {
  assert.equal(existsSync(combinedDir), true, "missing combined pack dir");
  for (const rel of COMBINED_FILES) {
    const text = readCombined(rel);
    assert.match(text, /athena-auth-runtime-finality/);
    assert.match(text, new RegExp(CURRENT_HEAD));
  }
  const spec = readCombined("SPEC.md");
  assert.match(spec, /adr_needed/);
  assert.match(spec, /Never `pnpm test:sdd`/i);
});

test("T-RTF-SEQUENCE: SPEC names P2-P15 then O1-O20 and PR 1-15", () => {
  const spec = readCombined("SPEC.md");
  assert.match(spec, /P2/);
  assert.match(spec, /P15/);
  assert.match(spec, /O1/);
  assert.match(spec, /O20/);
  assert.match(spec, /PR 1/);
  assert.match(spec, /\*\*15\*\*/);
  assert.match(spec, /one client/i);
  assert.match(spec, /one session owner/i);
  assert.match(spec, /one account model/i);
  assert.match(spec, /fail-closed/i);
  assert.match(spec, /durable security state/i);
  assert.match(spec, /createPasskeyClient/);
  assert.match(spec, /createOAuthClient/);
  assert.match(spec, /createSocialClient/);
  assert.match(spec, /athena\.oauth/);
});

test("T-RTF-TRACK-C: social freeze pack + matrix stubs exist", () => {
  assert.equal(existsSync(trackCDir), true, "missing Track C pack");
  for (const rel of TRACK_C_FILES) {
    const path = join(trackCDir, rel);
    assert.equal(existsSync(path), true, `missing Track C ${rel}`);
    const text = readFileSync(path, "utf8");
    assert.match(text, /athena-social-oauth-embedded-finality/);
    assert.match(text, new RegExp(CURRENT_HEAD));
  }
  for (const rel of MATRIX_STUBS) {
    assert.equal(
      existsSync(join(trackCDir, rel)),
      true,
      `missing matrix stub ${rel}`
    );
  }
});

test("T-RTF-REMAINDER: 11 gaps, Track C opened, f2e2ed678 stale", () => {
  const remainder = readFileSync(remainderPath, "utf8");
  assert.match(remainder, new RegExp(CURRENT_HEAD));
  assert.match(remainder, /\*\*11\*\*/);
  assert.match(remainder, /7 passkey \+ 4 social/);
  assert.match(remainder, /athena-social-oauth-embedded-finality/);
  assert.match(remainder, /athena-auth-runtime-finality/);
  assert.equal(
    remainder.includes(STALE_REMAINDER_PIN) && /stale/i.test(remainder),
    true
  );
  assert.equal(remainder.includes("*not opened*"), false);
});

test("T-RTF-NO-PRODUCT: spec excludes challenge-store / social HTTP / OAuthTransactionStore", () => {
  const spec = readCombined("SPEC.md");
  assert.match(spec, /src\/auth\/local\/passkey/);
  assert.match(spec, /OAuthTransactionStore/);
  assert.match(spec, /Do not implement/i);
  assert.match(spec, /browser provider secrets/i);
});
