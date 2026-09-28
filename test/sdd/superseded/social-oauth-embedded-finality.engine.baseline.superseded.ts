/**
 * SUPERSEDED by test/sdd/social-oauth-embedded-finality.engine.target.test.ts
 *
 * Former characterization of Slice 02 CURRENT defects:
 * - createClient rejected auth.social / auth.oauth / auth.socialProviders
 *   with ATHENA_AUTH_FEATURE_UNSUPPORTED
 * - no NormalizedSocialAuthConfig; NormalizedAthenaAuthConfig had no social
 * - ATHENA_AUTH_SCHEMA_GENERATION === 27; no athena.oauth_transactions
 * - no src/auth/social/server/ engine tree
 * - no src/auth/local/social/
 * - PKCE/state unbound (no OAuthTransactionStore / state_hash /
 *   pkce_verifier_ciphertext)
 * - no atomic DELETE FROM athena.oauth_transactions … RETURNING *
 *
 * Stay-true at implement: four social HTTP routes remained unserved
 * (B-SOE-MISSING-ROUTES). Target suite is the CI source of truth.
 * Do not invert titles in place.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/02-engine-config-store.md
 * Dual-suite IDs: docs/sdd/xylex/athena-social-oauth-embedded-finality/dual-suite/dual-suite-spec.md
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_TABLES,
} from "../../../src/auth/contract/index.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../../src/auth/local/schema-manifest.ts";
import {
  AthenaConfigurationError,
  createClient,
} from "../../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const authRoot = join(srcRoot, "auth");
const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_social_oauth_engine_baseline";

const FOUR_SOCIAL_MISSING_ROUTES = [
  "GET /callback/{provider}",
  "POST /link-social",
  "POST /sign-in/social",
  "POST /unlink-account",
] as const;

const ENGINE_SERVER_FILES = [
  "engine.ts",
  "types.ts",
  "provider-registry.ts",
  "transaction-store.ts",
  "account-resolver.ts",
  "callback.ts",
  "redirect.ts",
  "session.ts",
  "errors.ts",
] as const;

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function authSourcesMention(pattern: RegExp): boolean {
  return collectTsFiles(authRoot).some((file) =>
    pattern.test(readFileSync(file, "utf8"))
  );
}

function extractInterfaceBody(src: string, name: string): string {
  const needle = `export interface ${name} {`;
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing export interface ${name}`);
  let depth = 0;
  for (let i = start + needle.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  assert.fail(`unclosed interface ${name}`);
}

function inventoryKnownMissing(): string {
  const src = readPkg("test/auth-route-inventory.test.ts");
  const match = src.match(
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
}

function expectAuthFeatureUnsupported(auth: unknown): void {
  assert.throws(
    () =>
      createClient({
        auth: auth as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED" &&
      /oauth|social/i.test(error.message)
  );
}

test("B-SOE-CONSTRUCT-SOCIAL: P?: createClient rejects auth.social with ATHENA_AUTH_FEATURE_UNSUPPORTED", () => {
  const v3Src = readPkg("src/v3-client.ts");
  assert.match(v3Src, /function rejectUnsupportedEmbeddedAuthFeatures/);
  assert.match(v3Src, /raw\.oauth \|\| raw\.social \|\| raw\.socialProviders/);
  expectAuthFeatureUnsupported({
    mode: "local",
    social: {
      providers: {
        github: {
          clientId: "github-client",
          clientSecret: "github-secret",
        },
        google: {
          clientId: "google-client",
          clientSecret: "google-secret",
        },
      },
    },
  });
});

test("B-SOE-CONSTRUCT-OAUTH: P?: createClient rejects auth.oauth object bag with ATHENA_AUTH_FEATURE_UNSUPPORTED", () => {
  expectAuthFeatureUnsupported({
    oauth: { google: { clientId: "x" } },
  });
});

test("B-SOE-CONSTRUCT-SOCIALPROVIDERS: P?: createClient rejects auth.socialProviders with ATHENA_AUTH_FEATURE_UNSUPPORTED", () => {
  expectAuthFeatureUnsupported({
    socialProviders: { google: { clientId: "x" } },
  });
});

test("B-SOE-NO-NORMALIZED: P?: NormalizedSocialAuthConfig does not exist", () => {
  assert.equal(
    authSourcesMention(/\bNormalizedSocialAuthConfig\b/),
    false,
    "NormalizedSocialAuthConfig must be absent under src/auth"
  );
});

test("B-SOE-NO-SOCIAL-FIELD: P?: NormalizedAthenaAuthConfig has no social field", () => {
  const configSrc = readPkg("src/auth/config.ts");
  const body = extractInterfaceBody(configSrc, "NormalizedAthenaAuthConfig");
  assert.match(body, /\bpasskey:/);
  assert.equal(
    /\bsocial\??:/.test(body),
    false,
    "NormalizedAthenaAuthConfig must not declare a social field"
  );
  const localBody = extractInterfaceBody(configSrc, "AthenaAuthLocalConfig");
  assert.equal(
    /\bsocial\??:/.test(localBody),
    false,
    "AthenaAuthLocalConfig must not declare a social field"
  );
});

test("B-SOE-MISSING-ROUTES: P?: four social routes remain in KNOWN_MISSING_IN_LOCAL", () => {
  const listed = inventoryKnownMissing();
  for (const route of FOUR_SOCIAL_MISSING_ROUTES) {
    assert.match(
      listed,
      new RegExp(`"${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `KNOWN_MISSING_IN_LOCAL must list ${route}`
    );
  }
  const runtime = readPkg("src/auth/local/runtime.ts");
  const router = readPkg("src/auth/local/router.ts");
  const blob = `${runtime}\n${router}`;
  assert.equal(
    /path === "\/sign-in\/social"/.test(blob),
    false,
    "local runtime/router must not serve POST /sign-in/social"
  );
  assert.equal(
    /path === "\/link-social"/.test(blob),
    false,
    "local runtime/router must not serve POST /link-social"
  );
  assert.equal(
    /path === "\/unlink-account"/.test(blob),
    false,
    "local runtime/router must not serve POST /unlink-account"
  );
  assert.equal(
    /\/callback\//.test(blob),
    false,
    "local runtime/router must not serve GET /callback/{provider}"
  );
});

test("B-SOE-GEN-27: P?: ATHENA_AUTH_SCHEMA_GENERATION === 27 and no oauth_transactions", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 27);
  assert.equal(
    "oauthTransactions" in ATHENA_AUTH_TABLES,
    false,
    "ATHENA_AUTH_TABLES must not list oauthTransactions"
  );
  assert.equal(
    Object.values(ATHENA_AUTH_TABLES).includes("athena.oauth_transactions"),
    false
  );
  assert.equal(
    ATHENA_AUTH_MIGRATION_EXPECTATIONS[28],
    undefined,
    "generation 28 oauth_transactions expectations must not exist"
  );
  const schemaSrc = readPkg("src/auth/local/schema.ts");
  const manifestSrc = readPkg("src/auth/local/schema-manifest.ts");
  assert.equal(schemaSrc.includes("oauth_transactions"), false);
  assert.equal(manifestSrc.includes("oauth_transactions"), false);
  assert.match(schemaSrc, /027_auth_bridge_codes/);
});

test("B-SOE-NO-SERVER-TREE: P?: src/auth/social/server/ does not exist", () => {
  const serverDir = join(authRoot, "social", "server");
  assert.equal(existsSync(serverDir), false);
  for (const file of ENGINE_SERVER_FILES) {
    assert.equal(
      existsSync(join(serverDir, file)),
      false,
      `engine file src/auth/social/server/${file} must be absent`
    );
  }
});

test("B-SOE-NO-LOCAL-SOCIAL: P?: src/auth/local/social/ does not exist", () => {
  assert.equal(existsSync(join(authRoot, "local", "social")), false);
});

test("B-SOE-PKCE-UNBOUND: P?: PKCE/state are not Athena-auth-bound (no state_hash transaction store)", () => {
  const pkcePath = join(authRoot, "oauth2", "pkce.ts");
  const authorizePath = join(authRoot, "oauth2", "create-authorization-url.ts");
  assert.equal(existsSync(pkcePath), true);
  assert.equal(existsSync(authorizePath), true);
  const pkceSrc = readFileSync(pkcePath, "utf8");
  const authorizeSrc = readFileSync(authorizePath, "utf8");
  assert.match(pkceSrc, /export async function generateCodeChallenge/);
  assert.match(authorizeSrc, /code_challenge_method/);
  assert.match(authorizeSrc, /"S256"/);
  assert.equal(
    authSourcesMention(/\bOAuthTransactionStore\b/),
    false,
    "OAuthTransactionStore must not exist yet"
  );
  assert.equal(
    authSourcesMention(/\bstate_hash\b/),
    false,
    "state_hash must not be persisted yet"
  );
  assert.equal(
    authSourcesMention(/\bpkce_verifier_ciphertext\b/),
    false,
    "encrypted PKCE verifier column must not exist yet"
  );
});

test("B-SOE-NO-ATOMIC-CONSUME: P?: no DELETE FROM athena.oauth_transactions … RETURNING *", () => {
  assert.equal(
    authSourcesMention(/DELETE FROM athena\.oauth_transactions/i),
    false
  );
  assert.equal(authSourcesMention(/\boauth_transactions\b/), false);
});
