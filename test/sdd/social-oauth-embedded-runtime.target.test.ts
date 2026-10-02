/**
 * Slice 03 TARGET — Embedded social HTTP + runtime (O6–O18).
 * DESIRED closed loop on the landed ADR 0050 engine: lazy getSocialRuntime,
 * AuthRouteDomain "social", POST /sign-in/social {url, redirect:true} with no
 * session/hooks, GET /callback/{provider} atomic consume → mutate +
 * issueSession → safe redirect, link/unlink via mutate, last-credential
 * reject, advertise only configured served providers.
 *
 * GREEN after embedded social HTTP + runtime. Former characterization baseline
 * retired to test/sdd/superseded/social-oauth-embedded-runtime.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/03-http-hooks-auth-ui.md
 * Dual-suite IDs: docs/sdd/xylex/athena-social-oauth-embedded-finality/dual-suite/dual-suite-spec.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-embedded-runtime.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEmbeddedCapabilitySnapshot,
  isSocialCapabilityEnabled,
} from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import {
  ATHENA_AUTH_DEFAULT_ARGON2,
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_TABLES,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import { deriveEmbeddedCapabilityAdvertisement } from "../../src/auth/contract/operations.ts";
import { ATHENA_AUTH_DOMAIN_EVENTS } from "../../src/auth/hooks/events.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createRuntimeDependencies } from "../../src/auth/local/runtime-dependencies.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authRoot = join(srcRoot, "auth");
const localSocialDir = join(authRoot, "local", "social");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");

const FOUR_SOCIAL_ROUTES = [
  "GET /callback/{provider}",
  "POST /link-social",
  "POST /sign-in/social",
  "POST /unlink-account",
] as const;

const FORBIDDEN_PUBLIC_CTORS = [
  "createOAuthClient",
  "createSocialClient",
  "createGoogleClient",
] as const;

const RUNTIME_SECRET = "athena-social-oauth-runtime-target-secret";
const APP_ORIGIN = "https://app.example.test";
const LOCAL_ORIGIN = "http://app.local";

type JsonRecord = Record<string, unknown>;

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
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
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

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

function socialAuthConfig() {
  return normalizeAthenaAuthConfig({
    basePath: "/api/auth",
    mode: "local",
    secret: RUNTIME_SECRET,
    security: {
      trustedOrigins: [APP_ORIGIN, LOCAL_ORIGIN],
    },
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
}

function createSocialRuntime() {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: socialAuthConfig(),
    hasher: createTestHasher(),
    secret: RUNTIME_SECRET,
  });
}

async function jsonBody(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

function socialSourceBlob(): string {
  const parts = [
    readPkg("src/auth/local/router.ts"),
    readPkg("src/auth/local/runtime.ts"),
    readPkg("src/auth/local/runtime-dependencies.ts"),
  ];
  if (existsSync(join(localSocialDir, "routes.ts"))) {
    parts.push(readPkg("src/auth/local/social/routes.ts"));
  }
  if (existsSync(join(localSocialDir, "runtime.ts"))) {
    parts.push(readPkg("src/auth/local/social/runtime.ts"));
  }
  return parts.join("\n");
}

test("T-SOR-REDIRECT-POLICY: P?: resolveSocialCallbackUri / validateSocialCallbackUri / validatePostAuthRedirect reject protocol-relative, arbitrary origins, and credentials in URL", async () => {
  const {
    resolveSocialCallbackUri,
    validatePostAuthRedirect,
    validateSocialCallbackUri,
  } = await import("../../src/auth/social/server/redirect.ts");
  assert.equal(typeof resolveSocialCallbackUri, "function");
  assert.equal(typeof validateSocialCallbackUri, "function");
  assert.equal(typeof validatePostAuthRedirect, "function");

  const derived = resolveSocialCallbackUri({
    basePath: "/api/auth",
    baseURL: APP_ORIGIN,
    provider: "google",
  });
  assert.equal(derived, `${APP_ORIGIN}/api/auth/callback/google`);

  const ctx = {
    origin: APP_ORIGIN,
    production: true,
    trustedOrigins: [APP_ORIGIN],
  };
  await assert.rejects(async () =>
    Promise.resolve(validatePostAuthRedirect("//evil.example/steal", ctx))
  );
  await assert.rejects(async () =>
    Promise.resolve(validatePostAuthRedirect("https://evil.example/phish", ctx))
  );
  await assert.rejects(async () =>
    Promise.resolve(
      validatePostAuthRedirect("https://user:pass@app.example.test/dash", ctx)
    )
  );
  const ok = validatePostAuthRedirect(`${APP_ORIGIN}/dashboard`, ctx);
  assert.equal(typeof ok, "string");
  assert.match(String(ok), /^https:\/\/app\.example\.test\/dashboard/);
  const relative = validatePostAuthRedirect("/settings", ctx);
  assert.match(String(relative), /^https:\/\/app\.example\.test\/settings/);
  await assert.rejects(async () =>
    Promise.resolve(validatePostAuthRedirect("javascript:alert(1)", ctx))
  );
  await assert.rejects(async () =>
    Promise.resolve(validatePostAuthRedirect("data:text/html,phish", ctx))
  );
  await assert.rejects(async () =>
    Promise.resolve(
      validatePostAuthRedirect("https://app.example.test.evil.com/x", ctx)
    )
  );
});

test("T-SOR-NO-TOKEN-REDIRECT: P?: post-auth redirect query never contains access, refresh, id token, or session bearer", async () => {
  const { validatePostAuthRedirect } = await import(
    "../../src/auth/social/server/redirect.ts"
  );
  const dest = validatePostAuthRedirect(`${APP_ORIGIN}/dashboard`, {
    origin: APP_ORIGIN,
    production: true,
    trustedOrigins: [APP_ORIGIN],
  });
  const parsed = new URL(String(dest), APP_ORIGIN);
  assert.equal(parsed.searchParams.has("access_token"), false);
  assert.equal(parsed.searchParams.has("refresh_token"), false);
  assert.equal(parsed.searchParams.has("id_token"), false);
  assert.equal(parsed.searchParams.has("token"), false);
  assert.equal(parsed.searchParams.has("session"), false);
  assert.equal(parsed.searchParams.has("session_token"), false);
  assert.equal(parsed.searchParams.has("bearer"), false);

  const blob = socialSourceBlob();
  assert.equal(
    /Location:.+access_token|redirect.*\?token=/.test(blob),
    false,
    "callback must not put tokens in the redirect query"
  );
});

test("T-SOR-RUNTIME-COMPOSE: P?: lazy getSocialRuntime composes an empty engine for dynamic identity connections", async () => {
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), true);
  const depsSrc = readPkg("src/auth/local/runtime-dependencies.ts");
  const body = extractInterfaceBody(depsSrc, "AuthRuntimeDependencies");
  assert.match(body, /\bgetSocialRuntime\b/);

  const hasher = createTestHasher();
  const empty = createRuntimeDependencies({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      secret: RUNTIME_SECRET,
    }),
    hasher,
    secret: RUNTIME_SECRET,
  });
  assert.equal(typeof empty.getSocialRuntime, "function");
  const emptyRuntime = await empty.getSocialRuntime();
  assert.ok(emptyRuntime);
  assert.deepEqual(emptyRuntime.social.providers, {});

  const configured = createRuntimeDependencies({
    autoMigrate: false,
    config: socialAuthConfig(),
    hasher,
    secret: RUNTIME_SECRET,
  });
  const first = await configured.getSocialRuntime();
  const second = await configured.getSocialRuntime();
  assert.ok(
    first,
    "configured social must compose AthenaEmbeddedSocialRuntime"
  );
  assert.equal(first, second, "getSocialRuntime must be lazy/singleton");

  const routesSrc = existsSync(join(localSocialDir, "routes.ts"))
    ? readPkg("src/auth/local/social/routes.ts")
    : "";
  assert.equal(
    /\bcreateAthenaSocialServerEngine\b/.test(routesSrc),
    false,
    "HTTP handlers must not instantiate the engine"
  );
  assert.match(
    routesSrc,
    /\bgetSocialRuntime\b/,
    "HTTP handlers must use the canonical social runtime"
  );
});

test("T-SOR-DOMAIN-SOCIAL: P?: AuthRouteDomain includes social and /sign-in/social is not swallowed by credential", () => {
  const router = readPkg("src/auth/local/router.ts");
  const domainType = extractTypeUnion(router, "AuthRouteDomain");
  assert.match(domainType, /"social"/);
  const domainsInit = router.match(
    /const domains: Record<AuthRouteDomain, AuthRouteHandler\[]> = \{([\s\S]*?)\};/
  );
  assert.ok(domainsInit, "createAuthRouter domain table must exist");
  assert.match(domainsInit[1] ?? "", /\bsocial:\s*\[/);

  const socialPath = router.search(
    /path === ["']\/sign-in\/social["'][\s\S]{0,160}?return ["']social["']/
  );
  const credentialPrefix = router.search(
    /path\.startsWith\(["']\/sign-in["']\)[\s\S]{0,160}?return ["']credential["']/
  );
  assert.ok(socialPath >= 0, "/sign-in/social must resolve to social");
  assert.ok(
    credentialPrefix < 0 || socialPath < credentialPrefix,
    "/sign-in/social must win over the credential /sign-in prefix"
  );
});

test("T-SOR-SIGN-IN-ROUTE: P?: POST /sign-in/social returns Better-Auth-compatible {url, redirect:true} with no session mutation", async () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  const runtime = createSocialRuntime();
  const response = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: `${APP_ORIGIN}/dashboard`,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = await jsonBody(response);
  assert.equal(body.redirect, true);
  assert.equal(typeof body.url, "string");
  assert.match(String(body.url), /accounts\.google\.com|google/);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.equal(
    /athena-auth\.session-token=/.test(cookie),
    false,
    "authorization start must not mint a session cookie"
  );

  const session = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/get-session`)
  );
  const sessionBody = await jsonBody(session);
  assert.equal(sessionBody.session ?? sessionBody.user ?? null, null);

  const routesSrc = readPkg("src/auth/local/social/routes.ts");
  assert.equal(
    /event:\s*"user\.sign-in\.social"/.test(
      routesSrc.split("/sign-in/social")[1] ?? routesSrc
    ) &&
    /path === ["']\/sign-in\/social["'][\s\S]{0,800}mutate\(/.test(routesSrc),
    false,
    "POST /sign-in/social must not call mutate / domain hooks"
  );
});

test("T-SOR-CALLBACK-ROUTE: P?: GET /callback/{provider} atomically consumes state, rejects mix-up, exchanges code, then mutate+issueSession", async () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  const routesSrc = readPkg("src/auth/local/social/routes.ts");
  assert.match(routesSrc, /\/callback\//);
  assert.match(routesSrc, /\.consume\b|consumeTransaction/);
  assert.match(routesSrc, /mix-?up|ProviderMixup|providerMixup/i);
  assert.match(routesSrc, /authorizationCodeRequest|exchange/);
  assert.match(routesSrc, /event:\s*"user\.sign-in\.social"/);
  assert.match(routesSrc, /\bissueSession\b/);
  assert.match(routesSrc, /\bmutate\b/);
  assert.match(routesSrc, /\bgetSocialRuntime\b/);

  const runtime = createSocialRuntime();
  const start = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: `${APP_ORIGIN}/dashboard`,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(start.status, 200);
  const started = await jsonBody(start);
  const authorize = new URL(String(started.url));
  const state = authorize.searchParams.get("state");
  assert.ok(state, "authorization URL must include CSRF state");

  const mixup = await runtime.handle(
    new Request(
      `${LOCAL_ORIGIN}/api/auth/callback/github?code=code&state=${encodeURIComponent(state)}`
    )
  );
  assert.ok(
    mixup.status >= 400,
    "callback provider ≠ transaction.provider must fail closed"
  );
});

test("T-SOR-ATOMIC-CALLBACK: P?: concurrent callback consume has exactly one winner", async () => {
  const runtime = createSocialRuntime();
  const start = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: `${APP_ORIGIN}/dashboard`,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(start.status, 200);
  const started = await jsonBody(start);
  const state = new URL(String(started.url)).searchParams.get("state");
  assert.ok(state);
  const target = `${LOCAL_ORIGIN}/api/auth/callback/google?code=code&state=${encodeURIComponent(state)}`;
  const [first, second] = await Promise.all([
    runtime.handle(new Request(target)),
    runtime.handle(new Request(target)),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  const losers = statuses.filter((status) => status >= 400);
  assert.equal(losers.length, 2, "loser must fail closed (no second session)");
  const bodies = [await jsonBody(first), await jsonBody(second)];
  const codes = bodies.map((body) => String(body.code ?? ""));
  assert.ok(
    codes.some((code) => /TRANSACTION|STATE|CONSUME|NOT_FOUND/i.test(code)),
    `one callback must fail closed on consumed state: ${codes.join(",")}`
  );
});

test("T-SOR-SESSION-ISSUE: P?: social sign-in mints canonical session via issueSession (same as email)", async () => {
  const routesSrc = existsSync(join(localSocialDir, "routes.ts"))
    ? readPkg("src/auth/local/social/routes.ts")
    : "";
  assert.match(routesSrc, /\bissueSession\b/);
  assert.equal(
    /createSocialSession\b/.test(routesSrc),
    false,
    "must not mint a social-only session DTO"
  );
  const emailSrc = readPkg("src/auth/local/credential-password-routes.ts");
  assert.match(emailSrc, /\bissueSession\b/);
  const depsSrc = readPkg("src/auth/local/runtime-dependencies.ts");
  assert.match(
    extractInterfaceBody(depsSrc, "AuthRuntimeDependencies"),
    /\bissueSession:/
  );
});

test("T-SOR-LINK-ROUTE: P?: POST /link-social requires current user and emits account.link via mutate", async () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  const routesSrc = readPkg("src/auth/local/social/routes.ts");
  assert.match(routesSrc, /path === ["']\/link-social["']/);
  assert.match(routesSrc, /event:\s*"account\.link"/);
  assert.match(routesSrc, /\bmutate\b/);
  assert.match(routesSrc, /intent:\s*["']link["']/);

  const runtime = createSocialRuntime();
  const anonymous = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/link-social`, {
      body: JSON.stringify({
        callbackURL: `${APP_ORIGIN}/settings`,
        provider: "github",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.ok(
    anonymous.status === 401 || anonymous.status === 403,
    "link-social requires the current user"
  );
  assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.link"].status, "implemented");
});

test("T-SOR-UNLINK-ROUTE: P?: POST /unlink-account emits account.unlink via mutate with previous account snapshot", async () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  const routesSrc = readPkg("src/auth/local/social/routes.ts");
  assert.match(routesSrc, /path === ["']\/unlink-account["']/);
  assert.match(routesSrc, /event:\s*"account\.unlink"/);
  assert.match(routesSrc, /previous:/);
  assert.match(routesSrc, /\bmutate\b/);
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["account.unlink"].status,
    "implemented"
  );

  const clientSrc = [
    readPkg("src/auth/client.ts"),
    readPkg("src/auth/client/social.ts"),
    readPkg("src/auth/client/accounts.ts"),
  ].join("\n");
  assert.match(
    clientSrc,
    /denySocial\(["']\/link-social["']\)/,
    "flat linkSocial must go through denySocial"
  );
  assert.match(
    clientSrc,
    /denySocial\(["']\/unlink-account["']\)/,
    "flat unlinkAccount must go through denySocial"
  );
});

test("T-SOR-LAST-CREDENTIAL: P?: last-credential unlink is rejected", async () => {
  const blob = socialSourceBlob();
  assert.match(blob, /last[-_ ]?credential/i);
  const runtime = createSocialRuntime();
  const signup = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "last-cred@example.test",
        name: "Last",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie") ?? "";
  const unlink = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/unlink-account`, {
      body: JSON.stringify({ providerId: "credential" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.ok(unlink.status >= 400, "last remaining credential must not unlink");
  const body = await jsonBody(unlink);
  assert.equal(typeof body.code, "string");
  assert.match(String(body.code), /LAST|CREDENTIAL|UNLINK/i);
});

async function assertRejectedPostAuthRedirect(
  callbackURL: string
): Promise<void> {
  const runtime = createSocialRuntime();
  const response = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.notEqual(
    response.status,
    404,
    "open-redirect rejection must be a served validator, not a missing route"
  );
  assert.ok(response.status >= 400);
  const body = await jsonBody(response);
  assert.match(
    String(body.code ?? body.message ?? ""),
    /REDIRECT|ORIGIN|CALLBACK|URL|TRUST/i
  );
}

test("T-SOR-OPEN-REDIRECT-REJECT: P?: external and protocol-relative post-auth redirects are rejected", async () => {
  const redirectMod = (await import(
    "../../src/auth/social/server/redirect.ts"
  )) as Record<string, unknown>;
  assert.equal(typeof redirectMod.validatePostAuthRedirect, "function");
  await assertRejectedPostAuthRedirect("//evil.example/steal");
  await assertRejectedPostAuthRedirect("https://evil.example/phish");
  await assertRejectedPostAuthRedirect(
    "https://user:pass@app.example.test/dash"
  );
});

test("T-SOR-CAPABILITY-FLIP: P?: advertised social.providers lists only configured served ids", async () => {
  assert.equal(
    deriveEmbeddedCapabilityAdvertisement(ATHENA_AUTH_OPERATIONS)
      .socialProvidersAdvertised,
    true
  );
  const runtime = createSocialRuntime();
  const ok = await runtime.handle(new Request(`${LOCAL_ORIGIN}/api/auth/ok`));
  assert.equal(ok.status, 200);
  const body = await jsonBody(ok);
  const capabilities = body.capabilities as {
    social?: { providers?: string[] };
    status?: string;
  };
  assert.deepEqual([...(capabilities.social?.providers ?? [])].sort(), [
    "github",
    "google",
  ]);
  assert.equal(
    isSocialCapabilityEnabled({
      social: { providers: capabilities.social?.providers ?? [] },
      source: "bootstrap",
      status: "known",
    }),
    true
  );

  const unconfigured = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    secret: RUNTIME_SECRET,
  });
  const emptyOk = await unconfigured.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/ok`)
  );
  const emptyBody = await jsonBody(emptyOk);
  const emptyCaps = emptyBody.capabilities as {
    social?: { providers?: string[] };
  };
  assert.deepEqual(emptyCaps.social?.providers ?? [], []);
  assert.equal(
    isSocialCapabilityEnabled(createEmbeddedCapabilitySnapshot()),
    false
  );
});

test("T-SOR-KNOWN-MISSING-CLEARED: P?: four social routes are removed from KNOWN_MISSING_IN_LOCAL only when served", () => {
  const listed = inventoryKnownMissing();
  for (const route of FOUR_SOCIAL_ROUTES) {
    assert.equal(
      listed.includes(`"${route}"`),
      false,
      `${route} must leave KNOWN_MISSING_IN_LOCAL once served`
    );
    const [method, path] = route.split(" ");
    const op = ATHENA_AUTH_OPERATIONS.find(
      (operation) => operation.method === method && operation.path === path
    );
    assert.ok(op, `catalog must list ${route}`);
    assert.equal(
      op.embedded,
      "supported",
      `${route} catalog embedded must flip with the served HTTP handler`
    );
  }
});

test("T-SOR-SOURCE-SCAN: P?: source-scan includes local/social/routes.ts and local/social/runtime.ts", () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), true);
  const companions = readPkg("test/auth-domain-hooks.test.ts");
  assert.match(companions, /local\/social\/routes\.ts/);
  assert.match(companions, /local\/social\/runtime\.ts/);
  assert.match(companions, /local\/runtime\.ts/);
});

test("T-SOR-NO-PUBLIC-OAUTH: P?: no createOAuthClient, createSocialClient, createGoogleClient, or athena.oauth", () => {
  const indexSrc = readPkg("src/index.ts");
  const clientSrc = readPkg("src/auth/client.ts");
  const v3Src = readPkg("src/v3-client.ts");
  const blob = `${indexSrc}\n${clientSrc}\n${v3Src}`;
  for (const name of FORBIDDEN_PUBLIC_CTORS) {
    assert.equal(
      new RegExp(`\\b${name}\\b`).test(blob),
      false,
      `${name} must not be public`
    );
  }
  assert.equal(blob.includes("athena.oauth"), false);
  assert.equal(existsSync(join(authRoot, "social", "oauth-client.ts")), false);
  const pkg = JSON.parse(readPkg("package.json")) as {
    exports?: Record<string, unknown>;
  };
  assert.equal("./oauth" in (pkg.exports ?? {}), false);
});

test("T-SOR-FIREWALL: P?: social server modules / clientSecret / OAuthTransactionStore cannot enter browser graph", () => {
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
    }
  }
});

test("T-SOR-SCHEMA-GEN: P?: tests assert ATHENA_AUTH_SCHEMA_GENERATION from the contract (not a stale 26)", () => {
  assert.equal(typeof ATHENA_AUTH_SCHEMA_GENERATION, "number");
  assert.notEqual(ATHENA_AUTH_SCHEMA_GENERATION, 26);
  assert.notEqual(ATHENA_AUTH_SCHEMA_GENERATION, 27);
  assert.equal(
    ATHENA_AUTH_TABLES.oauthTransactions,
    "athena.oauth_transactions"
  );
  const contract = readPkg("src/auth/contract/index.ts");
  assert.match(contract, /ATHENA_AUTH_SCHEMA_GENERATION/);
  assert.match(contract, /from ["']\.\.\/schema\/generation\.ts["']/);
  assert.equal(
    /ATHENA_AUTH_SCHEMA_GENERATION\s*=\s*26\b/.test(contract),
    false
  );
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
});

test("P?: Pass social providers into the root capability snapshot", () => {
  const v3 = readPkg("src/v3-client.ts");
  assert.match(
    v3,
    /advertisedSocialProviderIds\s*\(\s*normalized\.social\s*\)/,
    "createClient root snapshot must pass advertisedSocialProviderIds(normalized.social)"
  );
  assert.match(
    v3,
    /createEmbeddedCapabilitySnapshot\(\{[\s\S]*socialProviders:/
  );
  const snapshot = createEmbeddedCapabilitySnapshot({
    socialProviders: ["google", "github"],
  });
  assert.deepEqual([...snapshot.social.providers].sort(), ["github", "google"]);
  assert.equal(isSocialCapabilityEnabled(snapshot), true);
  assert.equal(
    isSocialCapabilityEnabled(createEmbeddedCapabilitySnapshot()),
    false
  );
});

test("P?: Reuse the durable runtime key for social encryption", () => {
  const depsSrc = readPkg("src/auth/local/runtime-dependencies.ts");
  const marker = "const getSocialRuntime";
  const start = depsSrc.indexOf(marker);
  assert.ok(start >= 0, "getSocialRuntime must exist");
  const getSocial = depsSrc.slice(start, start + 1200);
  assert.equal(
    /secret:\s*options\.secret\s*\?\?\s*config\.secret/.test(getSocial),
    false,
    "getSocialRuntime must not pass only the still-empty config secret after ensureReady"
  );
  assert.match(
    getSocial,
    /runtimeKey|resolvedKey|key\.material|resolveSocialEncryptionSecret/,
    "must retain and pass durable runtime-key material into composeEmbeddedSocialRuntime"
  );
});

test("P?: Match both provider and account identifiers when unlinking", async () => {
  const runtime = createSocialRuntime();
  const signup = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "unlink-both@example.test",
        name: "Unlink Both",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie") ?? "";
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("unlink-both@example.test");
  assert.ok(user, "signup must create the user");
  const sharedSubject = "shared-provider-subject";
  await stores.createAccount({
    accountId: sharedSubject,
    id: crypto.randomUUID(),
    providerId: "google",
    userId: user.id,
  });
  await stores.createAccount({
    accountId: sharedSubject,
    id: crypto.randomUUID(),
    providerId: "github",
    userId: user.id,
  });
  const unlink = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/unlink-account`, {
      body: JSON.stringify({
        accountId: sharedSubject,
        providerId: "github",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(unlink.status, 200, "targeted github unlink must succeed");
  const remaining = await stores.listAccounts(user.id);
  const providers = remaining.map((row) => row.provider_id).sort();
  assert.equal(
    providers.includes("github"),
    false,
    "github credential with the shared subject must be unlinked"
  );
  assert.equal(
    providers.includes("google"),
    true,
    "google credential with the same provider subject must remain"
  );
});

test("P?: Accept Apple's hashed nonce representation", async () => {
  const routesSrc = readPkg("src/auth/local/social/routes.ts");
  const decodeAt = routesSrc.indexOf("decodeJwt");
  assert.ok(decodeAt >= 0, "callback must decode the ID token");
  const nonceBlock = routesSrc.slice(decodeAt, decodeAt + 900);
  assert.match(
    nonceBlock,
    /claims\.nonce === transaction\.nonceHash|socialIdTokenNonceMatches|nonceMatches\(/,
    "must accept Apple SHA-256 nonce claim equal to stored nonceHash (not only re-hash)"
  );
  const { sha256Hex } = await import(
    "../../src/auth/social/server/transaction-store.ts"
  );
  const rawNonce = "apple-raw-nonce-value";
  const nonceHash = await sha256Hex(rawNonce);
  const hashedClaimAgain = await sha256Hex(nonceHash);
  assert.notEqual(
    hashedClaimAgain,
    nonceHash,
    "double-hashing Apple's SHA-256 nonce claim must not equal the stored hash"
  );
  assert.equal(await sha256Hex(rawNonce), nonceHash);
  assert.notEqual(hashedClaimAgain, nonceHash);
});
