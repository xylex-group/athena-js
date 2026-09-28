/**
 * SUPERSEDED by test/sdd/social-oauth-embedded-runtime.target.test.ts
 *
 * Former characterization of Slice 03 CURRENT defects (O6–O18):
 * - four social HTTP routes unserved (KNOWN_MISSING_IN_LOCAL)
 * - no AuthRouteDomain "social"; no local/social/{runtime,routes}.ts
 * - capability advertisement false; HTTP ports NotWired
 * - AuthRuntimeDependencies had no getSocialRuntime
 *
 * Retired after runtime target 18/18 GREEN (2026-08-25). Not collected by
 * pnpm test (superseded/ is skipped). Stay-true firewall (B-SOR-FIREWALL)
 * remains asserted in the target suite. Do not invert titles in place.
 * Target suite is the CI source of truth.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/03-http-hooks-auth-ui.md
 * Dual-suite IDs: docs/sdd/xylex/athena-social-oauth-embedded-finality/dual-suite/dual-suite-spec.md
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  createEmbeddedCapabilitySnapshot,
  isSocialCapabilityEnabled,
} from "../../../src/auth/capabilities.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../../src/auth/contract/index.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../../src/auth/contract/operations.generated.ts";
import { deriveEmbeddedCapabilityAdvertisement } from "../../../src/auth/contract/operations.ts";
import { createSocialAccountResolver } from "../../../src/auth/social/server/account-resolver.ts";
import { createSocialCallbackPort } from "../../../src/auth/social/server/callback.ts";
import { AthenaSocialServerNotWiredError } from "../../../src/auth/social/server/errors.ts";
import { createSocialRedirectPort } from "../../../src/auth/social/server/redirect.ts";
import { createSocialSessionPort } from "../../../src/auth/social/server/session.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const localSocialDir = join(srcRoot, "auth", "local", "social");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");

const FOUR_SOCIAL_MISSING_ROUTES = [
  "GET /callback/{provider}",
  "POST /link-social",
  "POST /sign-in/social",
  "POST /unlink-account",
] as const;

const EXPECTED_DOMAINS = [
  "admin",
  "credential",
  "email",
  "organization",
  "passkey",
  "session",
  "token",
  "user",
] as const;

const FORBIDDEN_PUBLIC_CTORS = [
  "createOAuthClient",
  "createSocialClient",
  "createGoogleClient",
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

function inventoryKnownMissing(): string {
  const src = readPkg("test/auth-route-inventory.test.ts");
  const match = src.match(
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
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

function extractTypeUnion(src: string, name: string): string {
  const needle = `export type ${name} =`;
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing export type ${name}`);
  const end = src.indexOf(";", start);
  assert.ok(end > start, `unclosed type ${name}`);
  return src.slice(start, end + 1);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

test("B-SOR-MISSING-ROUTES: P?: four social routes remain in KNOWN_MISSING_IN_LOCAL", () => {
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
  assert.equal(/path === "\/sign-in\/social"/.test(blob), false);
  assert.equal(/path === "\/link-social"/.test(blob), false);
  assert.equal(/path === "\/unlink-account"/.test(blob), false);
  assert.equal(/\/callback\//.test(blob), false);
  for (const route of FOUR_SOCIAL_MISSING_ROUTES) {
    const [method, path] = route.split(" ");
    const op = ATHENA_AUTH_OPERATIONS.find(
      (operation) => operation.method === method && operation.path === path
    );
    assert.ok(op, `operations catalog must list ${route}`);
    assert.equal(op.embedded, "unsupported", `${route} embedded unsupported`);
  }
});

test("B-SOR-NO-SOCIAL-DOMAIN: P?: createAuthRouter domains are session|credential|user|organization|passkey|token|email|admin with no social", () => {
  const router = readPkg("src/auth/local/router.ts");
  const domainType = extractTypeUnion(router, "AuthRouteDomain");
  assert.equal(
    /\b"social"\b/.test(domainType),
    false,
    "AuthRouteDomain must not include social"
  );
  for (const domain of EXPECTED_DOMAINS) {
    assert.match(domainType, new RegExp(`"${domain}"`));
  }
  assert.match(
    router,
    /path\.startsWith\("\/sign-in"\)/,
    "/sign-in/* still maps to credential"
  );
  const domainsInit = router.match(
    /const domains: Record<AuthRouteDomain, AuthRouteHandler\[]> = \{([\s\S]*?)\};/
  );
  assert.ok(domainsInit, "createAuthRouter domain table must exist");
  const table = domainsInit[1] ?? "";
  assert.equal(/\bsocial:\s*\[/.test(table), false);
  for (const domain of EXPECTED_DOMAINS) {
    assert.match(table, new RegExp(`\\b${domain}:\\s*\\[`));
  }
});

test("B-SOR-NO-RUNTIME-TS: P?: src/auth/local/social/runtime.ts does not exist", () => {
  assert.equal(existsSync(localSocialDir), true, "engine adapters exist");
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), false);
  assert.equal(existsSync(join(localSocialDir, "index.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "memory-store.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "postgres-store.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "pkce-encryption.ts")), true);
});

test("B-SOR-NO-ROUTES-TS: P?: src/auth/local/social/routes.ts does not exist", () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), false);
  const files = readdirSync(localSocialDir).filter((name) =>
    name.endsWith(".ts")
  );
  assert.equal(files.includes("routes.ts"), false);
  assert.equal(files.includes("runtime.ts"), false);
  const companions = readPkg("test/auth-domain-hooks.test.ts");
  assert.equal(
    companions.includes("local/social/routes.ts"),
    false,
    "companion scan must not list local/social/routes.ts until the file exists"
  );
  assert.equal(
    companions.includes("local/social/runtime.ts"),
    false,
    "companion scan must not list local/social/runtime.ts until the file exists"
  );
});

test("B-SOR-ADVERTISE-FALSE: P?: social.providers is [] and socialProvidersAdvertised is false", () => {
  const snapshot = createEmbeddedCapabilitySnapshot();
  assert.deepEqual(snapshot.social.providers, []);
  assert.equal(isSocialCapabilityEnabled(snapshot), false);
  assert.deepEqual(
    ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.social.providers,
    []
  );
  const advertised = deriveEmbeddedCapabilityAdvertisement(
    ATHENA_AUTH_OPERATIONS
  );
  assert.equal(advertised.socialProvidersAdvertised, false);
  const capsSrc = readPkg("src/auth/capabilities.ts");
  assert.match(capsSrc, /social:\s*\{\s*providers:\s*\[\]\s*\}/);
  const opsSrc = readPkg("src/auth/contract/operations.ts");
  assert.equal(
    /socialProvidersAdvertised:\s*true/.test(opsSrc),
    false,
    "do not special-case social advertisement on"
  );
});

test("B-SOR-PORTS-NOT-WIRED: P?: redirect/callback/session/account-resolver ports throw AthenaSocialServerNotWiredError", async () => {
  const redirect = createSocialRedirectPort();
  await assert.rejects(
    () =>
      redirect.issue({ url: "https://accounts.google.com/o/oauth2/v2/auth" }),
    (error: unknown) =>
      error instanceof AthenaSocialServerNotWiredError &&
      errorCode(error) === "ATHENA_AUTH_SOCIAL_SERVER_NOT_WIRED"
  );
  const callback = createSocialCallbackPort();
  await assert.rejects(
    () =>
      callback.handle({
        code: "code",
        provider: "google",
        state: "state",
      }),
    (error: unknown) =>
      error instanceof AthenaSocialServerNotWiredError &&
      errorCode(error) === "ATHENA_AUTH_SOCIAL_SERVER_NOT_WIRED"
  );
  const session = createSocialSessionPort();
  await assert.rejects(
    () => session.acceptAfterCallback({}),
    (error: unknown) =>
      error instanceof AthenaSocialServerNotWiredError &&
      errorCode(error) === "ATHENA_AUTH_SOCIAL_SERVER_NOT_WIRED"
  );
  const resolver = createSocialAccountResolver();
  await assert.rejects(
    () =>
      resolver.resolve({
        email: "user@example.test",
        providerId: "google",
        providerUserId: "sub",
      }),
    (error: unknown) =>
      error instanceof AthenaSocialServerNotWiredError &&
      errorCode(error) === "ATHENA_AUTH_SOCIAL_SERVER_NOT_WIRED"
  );
  const redirectSrc = readPkg("src/auth/social/server/redirect.ts");
  assert.equal(/\bresolveSocialCallbackUri\b/.test(redirectSrc), false);
  assert.equal(/\bvalidateSocialCallbackUri\b/.test(redirectSrc), false);
  assert.equal(/\bvalidatePostAuthRedirect\b/.test(redirectSrc), false);
});

test("B-SOR-NO-GET-SOCIAL-RUNTIME: P?: AuthRuntimeDependencies has no getSocialRuntime", () => {
  const depsSrc = readPkg("src/auth/local/runtime-dependencies.ts");
  const body = extractInterfaceBody(depsSrc, "AuthRuntimeDependencies");
  assert.equal(/\bgetSocialRuntime\b/.test(body), false);
  assert.equal(/\bAthenaEmbeddedSocialRuntime\b/.test(depsSrc), false);
  assert.match(body, /\bmutate:/);
  assert.match(body, /\bissueSession:/);
  assert.match(body, /\brequireSession:/);
  assert.match(body, /\bconfig:/);
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), false);
});

test("B-SOR-FIREWALL: P?: clientSecret, OAuthTransactionStore, and social/server cannot enter browser, next/client, RN, or Auth UI", () => {
  const surfaces: Array<{ label: string; files: string[] }> = [
    { files: [join(srcRoot, "browser.ts")], label: "src/browser.ts" },
    {
      files: [join(srcRoot, "next", "client.ts")],
      label: "src/next/client.ts",
    },
    {
      files: collectTsFiles(join(srcRoot, "react-native")),
      label: "src/react-native",
    },
    { files: collectTsFiles(authUiSrc), label: "packages/athena-auth-ui/src" },
  ];
  const forbidden = [
    "OAuthTransactionStore",
    "createAthenaSocialServerEngine",
    "pkce_verifier_ciphertext",
    "encryptPkceVerifier",
    "auth/social/server",
    "auth/local/social",
  ];
  for (const surface of surfaces) {
    assert.ok(surface.files.length > 0, `${surface.label} must exist`);
    const blob = surface.files
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    for (const needle of forbidden) {
      assert.equal(
        blob.includes(needle),
        false,
        `${needle} must not appear in ${surface.label}`
      );
    }
    for (const file of surface.files) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const src = existsSync(file) ? readFileSync(file, "utf8") : "";
      assert.equal(
        /from ["'][^"']*auth\/social\/server[^"']*["']/.test(src),
        false,
        `${rel} must not import social/server`
      );
      assert.equal(
        /from ["'][^"']*auth\/local\/social[^"']*["']/.test(src),
        false,
        `${rel} must not import local/social`
      );
      assert.equal(
        /\bclientSecret\b/.test(src) &&
          /auth\/social\/server|OAuthTransactionStore/.test(src),
        false,
        `${rel} must not pair clientSecret with the social server graph`
      );
    }
  }
  const indexSrc = readPkg("src/index.ts");
  const v3Src = readPkg("src/v3-client.ts");
  const pkg = JSON.parse(readPkg("package.json")) as {
    exports?: Record<string, unknown>;
  };
  const blob = `${indexSrc}\n${v3Src}`;
  for (const name of FORBIDDEN_PUBLIC_CTORS) {
    assert.equal(blob.includes(name), false, `${name} must not be public`);
  }
  assert.equal("createOAuthClient" in (pkg.exports ?? {}), false);
  assert.equal("./oauth" in (pkg.exports ?? {}), false);
  assert.equal(
    typeof ATHENA_AUTH_SCHEMA_GENERATION,
    "number",
    "schema generation must come from the contract constant"
  );
  assert.notEqual(ATHENA_AUTH_SCHEMA_GENERATION, 26);
  assert.notEqual(ATHENA_AUTH_SCHEMA_GENERATION, 27);
});
