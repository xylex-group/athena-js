/**
 * P1 freeze baseline — combined Athena Auth Runtime Finality.
 * Characterizes CURRENT HEAD d1ac057be86c58170423a7e2461589604e7a55db.
 * Must stay GREEN this cycle (docs freeze only; no src/ product change).
 * Persistence gen 22 is landed — no_delta.
 *
 * Spec: docs/sdd/xylex/athena-auth-runtime-finality/specs/01-p1-program-freeze.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-auth-runtime-finality.p1-freeze.baseline.test.ts
 *   test/sdd/athena-auth-runtime-finality.p1-freeze.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  isSocialCapabilityEnabled,
} from "../../../src/auth/capabilities.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../../src/auth/contract/index.ts";
import { createAthenaPasskeyServerEngine } from "../../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../../src/auth/passkey/server/errors.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");

const SIX_PASSKEY = [
  "GET /passkey/list-user-passkeys",
  "POST /passkey/delete-passkey",
  "POST /passkey/generate-authenticate-options",
  "POST /passkey/update-passkey",
  "POST /passkey/verify-authentication",
] as const;

const FOUR_SOCIAL = [
  "GET /callback/{provider}",
  "POST /link-social",
  "POST /sign-in/social",
  "POST /unlink-account",
] as const;

const FORBIDDEN = [
  "createPasskeyClient",
  "createOAuthClient",
  "createSocialClient",
  "athena.oauth",
] as const;

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function inventoryKnownMissing(): string {
  const src = readPkg("test/auth-route-inventory.test.ts");
  const match = src.match(
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
}

test("B-RTF-INVENTORY: 4 KNOWN_MISSING_IN_LOCAL = social only", () => {
  const listed = inventoryKnownMissing();
  const quoted = [...listed.matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.equal(quoted.length, 4);
  assert.equal(quoted.includes("GET /.well-known/webauthn"), false);
  assert.equal(
    quoted.includes("GET /passkey/generate-register-options"),
    false,
    "GET /passkey/generate-register-options is served locally"
  );
  for (const route of SIX_PASSKEY) {
    assert.equal(quoted.includes(route), false, `served ${route}`);
  }
  for (const route of FOUR_SOCIAL) {
    assert.equal(quoted.includes(route), true, `missing ${route}`);
  }
});

test("B-RTF-LIST-ACCOUNTS: GET /list-accounts is served (not a gap)", () => {
  const listed = inventoryKnownMissing();
  assert.equal(listed.includes("GET /list-accounts"), false);
  assert.match(
    readPkg("src/auth/local/router.ts"),
    /path === "\/list-accounts" && method === "GET"/
  );
});

test("B-RTF-FAIL-CLOSED: passkeys false, social.providers [], engine not wired", () => {
  const snap = ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT;
  assert.equal(snap.passkeys, false);
  assert.deepEqual(snap.social?.providers, []);
  assert.equal(isSocialCapabilityEnabled(snap), false);
  assert.throws(
    () =>
      createAthenaPasskeyServerEngine({
        audit: {} as never,
        challenges: {} as never,
        clock: {} as never,
        credentials: {} as never,
        sessions: {} as never,
      }).startRegistration({} as never),
    (error: unknown) => error instanceof AthenaPasskeyServerNotWiredError
  );
});

test("B-RTF-PERS-NO-DELTA: JS schema generation 24 (email default templates)", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 28);
  assert.match(readPkg("src/auth/local/schema.ts"), /023_auth_observability/);
  assert.match(
    readPkg("src/auth/local/email/schema-sql.ts"),
    /024_email_event_default_templates/
  );
});

test("B-RTF-NO-NS: no createPasskeyClient / createOAuthClient / createSocialClient / athena.oauth", () => {
  const blob = `${readPkg("src/index.ts")}\n${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}`;
  for (const name of FORBIDDEN) {
    assert.equal(blob.includes(name), false, `${name} must stay absent`);
  }
});

test("B-RTF-NO-SOCIAL-HTTP: local runtime has no four social routes", () => {
  const runtime = readPkg("src/auth/local/runtime.ts");
  assert.equal(/path === "\/sign-in\/social"/.test(runtime), false);
  assert.equal(/path === "\/link-social"/.test(runtime), false);
  assert.equal(/path === "\/unlink-account"/.test(runtime), false);
  assert.equal(/\/callback\//.test(runtime), false);
});
