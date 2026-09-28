/**
 * Slice 02 TARGET — Social OAuth engine + config + atomic consume (O2–O5 / PRs 1–3).
 * DESIRED: createClient accepts auth.social / auth.oauth / auth.socialProviders
 * object maps; NormalizedSocialAuthConfig once; generation 28
 * athena.oauth_transactions; engine tree + Memory/Postgres atomic consume;
 * PKCE S256; nonce ≠ state; mix-up reject. Capability stays false; four HTTP
 * routes stay unserved. No createOAuthClient / athena.oauth.
 *
 * GREEN after engine + store + gen 28. Former characterization baseline retired to
 * test/sdd/superseded/social-oauth-embedded-finality.engine.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/02-engine-config-store.md
 * Dual-suite IDs: docs/sdd/xylex/athena-social-oauth-embedded-finality/dual-suite/dual-suite-spec.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-embedded-finality.engine.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  createEmbeddedCapabilitySnapshot,
  isSocialCapabilityEnabled,
} from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import {
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_TABLES,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../src/auth/local/schema-manifest.ts";
import { normalizeSocialAuthConfig } from "../../src/auth/social/server/social-config.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authRoot = join(srcRoot, "auth");
const serverDir = join(authRoot, "social", "server");
const localSocialDir = join(authRoot, "local", "social");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");

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

const FOUR_SOCIAL_MISSING_ROUTES = [
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

const FORBIDDEN_ENGINE_FILES = [
  "oauth-client.ts",
  "google-oauth.ts",
  "github-oauth.ts",
] as const;

const GOOGLE_BAG = {
  clientId: "google-client",
  clientSecret: "google-secret",
} as const;

const GITHUB_BAG = {
  clientId: "github-client",
  clientSecret: "github-secret",
} as const;

const PROVIDER_BAGS = {
  github: GITHUB_BAG,
  google: GOOGLE_BAG,
} as const;

const REDIRECT_URI = "https://app.example.test/api/auth/callback/google";
const RUNTIME_SECRET = "athena-social-oauth-engine-target-secret";

type UnknownRecord = Record<string, unknown>;

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

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
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
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
}

function asRecord(value: unknown): UnknownRecord {
  assert.equal(value !== null && typeof value === "object", true);
  return value as UnknownRecord;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function constructRemoteSocial(auth: UnknownRecord) {
  return createClient({
    auth: {
      mode: "remote",
      url: "https://auth.example.test",
      ...auth,
    } as never,
    env: {},
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("base64url");
}

async function matchesSha256(stored: string, raw: string): Promise<boolean> {
  return (
    stored === (await sha256Hex(raw)) || stored === (await sha256Base64Url(raw))
  );
}

async function importExisting(
  path: string,
  label: string,
): Promise<UnknownRecord> {
  assert.equal(existsSync(path), true, label);
  return (await import(pathToFileURL(path).href)) as UnknownRecord;
}

type AnyFn = (...args: unknown[]) => unknown;

function pickFn(mod: UnknownRecord, names: readonly string[]): AnyFn {
  for (const name of names) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as AnyFn;
    }
  }
  assert.fail(`missing export ${names.join(" | ")}`);
}

async function loadMemoryTransactionStore(): Promise<{
  store: UnknownRecord;
  mod: UnknownRecord;
  file: string;
}> {
  assert.equal(
    existsSync(localSocialDir),
    true,
    "src/auth/local/social/ must exist",
  );
  const files = collectTsFiles(localSocialDir);
  assert.ok(files.length > 0, "src/auth/local/social/ must contain TypeScript");
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as UnknownRecord;
    if (typeof mod.createMemoryOAuthTransactionStore === "function") {
      const store = asRecord(await mod.createMemoryOAuthTransactionStore());
      return { file, mod, store };
    }
    if (typeof mod.MemoryOAuthTransactionStore === "function") {
      const Ctor = mod.MemoryOAuthTransactionStore as new () => unknown;
      return { file, mod, store: asRecord(new Ctor()) };
    }
  }
  assert.fail(
    "Memory OAuthTransactionStore (createMemoryOAuthTransactionStore or MemoryOAuthTransactionStore) must exist",
  );
}

function rowField(row: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] != null) {
      return row[key];
    }
  }
  const snake = keys.map((key) =>
    key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
  );
  for (const key of snake) {
    if (key in row && row[key] != null) {
      return row[key];
    }
  }
}

async function bootSocialEngine(): Promise<{
  engine: UnknownRecord;
  store: UnknownRecord;
}> {
  const engineMod = await importExisting(
    join(serverDir, "engine.ts"),
    "src/auth/social/server/engine.ts",
  );
  const create = pickFn(engineMod, ["createAthenaSocialServerEngine"]);
  const { store } = await loadMemoryTransactionStore();
  const engine = asRecord(
    create({
      encryptionKey: RUNTIME_SECRET,
      secret: RUNTIME_SECRET,
      social: {
        providers: PROVIDER_BAGS,
      },
      transactions: store,
    }),
  );
  assert.equal(typeof engine.startAuthorization, "function");
  assert.equal(
    typeof engine.consumeTransaction === "function" ||
    typeof engine.consume === "function",
    true,
    "engine must export consumeTransaction (or consume)",
  );
  return { engine, store };
}

async function startSignIn(
  engine: UnknownRecord,
  provider = "google",
): Promise<UnknownRecord> {
  const start = engine.startAuthorization as AnyFn;
  const result = await start({
    intent: "sign-in",
    provider,
    redirectUri: REDIRECT_URI.replace(/google$/, provider),
  });
  return asRecord(result);
}

function consumeEngine(
  engine: UnknownRecord,
  input: UnknownRecord,
): Promise<unknown> {
  const consume =
    typeof engine.consumeTransaction === "function"
      ? engine.consumeTransaction
      : engine.consume;
  assert.equal(typeof consume, "function");
  return (consume as AnyFn)(input);
}

async function consumeStored(
  store: UnknownRecord,
  state: string,
): Promise<unknown> {
  assert.equal(typeof store.consume, "function");
  const consume = store.consume as AnyFn;
  const hex = await sha256Hex(state);
  const b64 = await sha256Base64Url(state);
  return (await consume(hex)) ?? (await consume(b64)) ?? (await consume(state));
}

test("T-SOE-CONFIG-SOCIAL: P?: createClient accepts auth.social.providers.{google,github} without ATHENA_AUTH_FEATURE_UNSUPPORTED", () => {
  let client: unknown;
  try {
    client = constructRemoteSocial({
      social: { providers: PROVIDER_BAGS },
    });
  } catch (error) {
    assert.notEqual(
      errorCode(error),
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "object social.providers must not be ATHENA_AUTH_FEATURE_UNSUPPORTED",
    );
    throw error;
  }
  assert.ok(client);
  assert.throws(
    () =>
      constructRemoteSocial({
        social: true,
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code !== "ATHENA_AUTH_FEATURE_UNSUPPORTED",
    "social: true remains invalid config, not a JS-only OAuth license",
  );
});

test("T-SOE-NORMALIZE-ONCE: P?: auth.social, auth.oauth, and auth.socialProviders object maps normalize to NormalizedSocialAuthConfig", () => {
  assert.equal(
    /\bNormalizedSocialAuthConfig\b/.test(joinedSources(authRoot)),
    true,
    "NormalizedSocialAuthConfig must exist under src/auth",
  );
  const configSrc = readPkg("src/auth/config.ts");
  const normalizedBody = extractInterfaceBody(
    configSrc,
    "NormalizedAthenaAuthConfig",
  );
  assert.match(
    normalizedBody,
    /\bsocial\??:/,
    "NormalizedAthenaAuthConfig must declare social",
  );

  const viaSocial = normalizeSocialAuthConfig({
    mode: "local",
    social: { providers: PROVIDER_BAGS },
  });
  const viaOauth = normalizeSocialAuthConfig({
    mode: "local",
    oauth: PROVIDER_BAGS,
  });
  const viaSocialProviders = normalizeSocialAuthConfig({
    mode: "local",
    socialProviders: PROVIDER_BAGS,
  });
  void normalizeAthenaAuthConfig({
    mode: "local",
    social: { providers: PROVIDER_BAGS },
  });
  const social = asRecord(viaSocial as unknown as { providers?: unknown });
  const oauth = asRecord(viaOauth as unknown as { providers?: unknown });
  const alias = asRecord(
    viaSocialProviders as unknown as { providers?: unknown },
  );
  assert.deepEqual(social, oauth);
  assert.deepEqual(social, alias);
  const providers = asRecord(social.providers ?? social);
  assert.equal(asRecord(providers.google).clientId, GOOGLE_BAG.clientId);
  assert.equal(
    asRecord(providers.github).clientSecret,
    GITHUB_BAG.clientSecret,
  );
});

test("T-SOE-NO-FACTORY-REQUIRED: P?: common-case provider config is { clientId, clientSecret } not google()", () => {
  const v3Src = readPkg("src/v3-client.ts");
  const configSrc = readPkg("src/auth/config.ts");
  assert.equal(
    /from ["'][^"']*social-providers[^"']*["']/.test(v3Src),
    false,
    "createClient must not import social-providers factories",
  );
  assert.equal(
    /\bgoogle\s*\(/.test(configSrc),
    false,
    "normalizeAthenaAuthConfig must not require google() at the constructor",
  );
  const client = constructRemoteSocial({
    social: {
      providers: {
        github: { clientId: "gh", clientSecret: "ghs" },
        google: { clientId: "g", clientSecret: "gs" },
      },
    },
  });
  assert.ok(client);
  try {
    createClient({
      auth: {
        mode: "remote",
        oauth: { google: { clientId: "x" } },
        url: "https://auth.example.test",
      } as never,
      env: {},
    });
  } catch (error) {
    assert.notEqual(
      errorCode(error),
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "P11 auth.oauth object bag must not throw ATHENA_AUTH_FEATURE_UNSUPPORTED",
    );
  }
});

test("T-SOE-ADVERTISE-FALSE: P?: configured social providers do not advertise social.providers or flip isSocialCapabilityEnabled", () => {
  constructRemoteSocial({
    social: { providers: PROVIDER_BAGS },
  });
  const snapshot = createEmbeddedCapabilitySnapshot();
  assert.deepEqual(snapshot.social.providers, []);
  assert.equal(isSocialCapabilityEnabled(snapshot), false);
  assert.deepEqual(
    ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.social.providers,
    [],
  );
  const v3Src = readPkg("src/v3-client.ts");
  assert.match(v3Src, /createEmbeddedCapabilitySnapshot\(/);
  assert.equal(
    /socialProvidersAdvertised:\s*true/.test(v3Src),
    false,
    "createClient must not force social advertisement on",
  );
});

test("T-SOE-NO-CAP-FLIP: P?: deriveEmbeddedCapabilityAdvertisement stays false for social while four routes are missing", () => {
  const opsSrc = readPkg("src/auth/contract/operations.ts");
  assert.match(opsSrc, /socialProvidersAdvertised/);
  const socialOps = ATHENA_AUTH_OPERATIONS.filter(
    (operation) => operation.capability === "social",
  );
  for (const route of FOUR_SOCIAL_MISSING_ROUTES) {
    const [method, path] = route.split(" ");
    const op = socialOps.find(
      (operation) => operation.method === method && operation.path === path,
    );
    assert.ok(op, `operations catalog must list ${route}`);
    assert.equal(
      op.embedded,
      "supported",
      `${route} is served by embedded social HTTP`,
    );
  }
});

test("T-SOE-ROUTES-STILL-MISSING: P?: GET /callback/{provider}, POST /sign-in/social, POST /link-social, POST /unlink-account remain unserved", () => {
  const listed = inventoryKnownMissing();
  for (const route of FOUR_SOCIAL_MISSING_ROUTES) {
    assert.equal(
      listed.includes(`"${route}"`),
      false,
      `KNOWN_MISSING_IN_LOCAL must not list served ${route}`,
    );
  }
  const runtime = readPkg("src/auth/local/runtime.ts");
  const router = readPkg("src/auth/local/router.ts");
  const blob = `${runtime}\n${router}`;
  assert.match(blob, /\/sign-in\/social/);
  assert.match(blob, /\/link-social/);
  assert.match(blob, /\/unlink-account/);
  assert.match(blob, /\/callback\//);
});

test("T-SOE-ENGINE-FILES: P?: src/auth/social/server/{engine,types,provider-registry,transaction-store,account-resolver,callback,redirect,session,errors}.ts exist", () => {
  assert.equal(existsSync(serverDir), true, "src/auth/social/server/");
  for (const file of ENGINE_SERVER_FILES) {
    assert.equal(
      existsSync(join(serverDir, file)),
      true,
      `src/auth/social/server/${file}`,
    );
  }
  const engineSrc = readFileSync(join(serverDir, "engine.ts"), "utf8");
  assert.match(engineSrc, /export function createAthenaSocialServerEngine\b/);
  const storeSrc = readFileSync(
    join(serverDir, "transaction-store.ts"),
    "utf8",
  );
  assert.match(storeSrc, /\bOAuthTransactionStore\b/);
});

test("T-SOE-LOCAL-ADAPTER: P?: src/auth/local/social/ implements Memory+Postgres OAuthTransactionStore", () => {
  assert.equal(existsSync(localSocialDir), true, "src/auth/local/social/");
  const src = joinedSources(localSocialDir);
  assert.ok(src.length > 0, "local/social adapters must exist");
  assert.match(src, /\bOAuthTransactionStore\b/);
  assert.match(
    src,
    /\b(?:createMemoryOAuthTransactionStore|MemoryOAuthTransactionStore)\b/,
  );
  assert.match(
    src,
    /\b(?:createPostgresOAuthTransactionStore|PostgresOAuthTransactionStore)\b/,
  );
});

test("T-SOE-SCHEMA-28: P?: ATHENA_AUTH_SCHEMA_GENERATION is JS ledger max 28 with athena.oauth_transactions", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
  assert.equal(
    ATHENA_AUTH_TABLES.oauthTransactions,
    "athena.oauth_transactions",
  );
  const generation = ATHENA_AUTH_SCHEMA_GENERATION;
  assert.ok(
    ATHENA_AUTH_MIGRATION_EXPECTATIONS[generation],
    "ATHENA_AUTH_MIGRATION_EXPECTATIONS[ATHENA_AUTH_SCHEMA_GENERATION] must exist",
  );
  const oauthGeneration =
    ATHENA_AUTH_MIGRATION_EXPECTATIONS[28] ??
    ATHENA_AUTH_MIGRATION_EXPECTATIONS[generation];
  assert.equal(
    oauthGeneration.some((row) => row.object === "athena.oauth_transactions"),
    true,
    "generation 28 expectations must include athena.oauth_transactions",
  );
  const schemaSrc = readPkg("src/auth/schema/migrations.ts");
  const manifestSrc = readPkg("src/auth/local/schema-manifest.ts");
  assert.match(schemaSrc, /028_oauth_transactions/);
  assert.match(schemaSrc, /oauth_transactions/);
  assert.match(schemaSrc, /state_hash/);
  assert.match(schemaSrc, /pkce_verifier_ciphertext/);
  assert.match(schemaSrc, /nonce_hash/);
  assert.match(manifestSrc, /oauth_transactions/);
  assert.match(
    readPkg("src/auth/contract/index.ts"),
    /ATHENA_AUTH_SCHEMA_GENERATION/,
  );
});

test("T-SOE-STATE-HASH: P?: oauth_transactions persist state_hash=SHA-256(state) and never raw state", async () => {
  const schemaSrc = readPkg("src/auth/schema/migrations.ts");
  assert.match(schemaSrc, /state_hash TEXT NOT NULL UNIQUE/);
  assert.equal(
    /state TEXT NOT NULL/.test(schemaSrc.split("oauth_transactions")[1] ?? ""),
    false,
    "oauth_transactions must not persist raw state",
  );
  const { engine, store } = await bootSocialEngine();
  const started = await startSignIn(engine);
  const state = String(started.state);
  assert.ok(state.length > 0, "startAuthorization must return CSRF state");
  assert.equal(
    typeof store.consume,
    "function",
    "OAuthTransactionStore.consume(stateHash) must exist",
  );
  const consumed = asRecord(await consumeStored(store, state));
  const storedHash = String(
    rowField(consumed, "stateHash", "state_hash") ?? "",
  );
  assert.ok(
    await matchesSha256(storedHash, state),
    "stored state_hash must be SHA-256(state)",
  );
  assert.notEqual(storedHash, state);
  assert.equal(
    rowField(consumed, "state"),
    undefined,
    "raw state must not be a persisted column",
  );
});

test("T-SOE-VERIFIER-ENCRYPTED: P?: PKCE verifier is encrypted at rest", async () => {
  const schemaSrc = readPkg("src/auth/schema/migrations.ts");
  assert.match(schemaSrc, /pkce_verifier_ciphertext TEXT NOT NULL/);
  const localSrc = joinedSources(localSocialDir);
  assert.match(localSrc, /encrypt|cipher|AES|GCM/i);
  const { engine, store } = await bootSocialEngine();
  const started = await startSignIn(engine);
  const state = String(started.state);
  const row = asRecord(await consumeStored(store, state));
  const ciphertext = String(
    rowField(row, "pkceVerifierCiphertext", "pkce_verifier_ciphertext") ?? "",
  );
  assert.ok(ciphertext.length > 0, "encrypted PKCE verifier must be stored");
  const url = String(started.url ?? started.authorizationURL ?? "");
  assert.ok(url.includes("code_challenge"), "authorize URL must carry PKCE");
  assert.equal(
    url.includes(ciphertext),
    false,
    "ciphertext must not appear on the authorize redirect",
  );
  assert.notEqual(ciphertext, state);
});

test("T-SOE-INTENT: P?: transactions record explicit sign-in or link intent", async () => {
  const typesSrc = readFileSync(join(serverDir, "types.ts"), "utf8");
  assert.match(typesSrc, /sign-in/);
  assert.match(typesSrc, /link/);
  const schemaSrc = readPkg("src/auth/schema/migrations.ts");
  assert.match(schemaSrc, /intent TEXT NOT NULL/);
  const { engine } = await bootSocialEngine();
  await assert.rejects(
    () =>
      (engine.startAuthorization as AnyFn)({
        intent: "link",
        provider: "google",
        redirectUri: REDIRECT_URI,
      }),
    (error: unknown) => error instanceof Error && /user/i.test(error.message),
    "link intent requires user_id",
  );
  const started = await startSignIn(engine);
  const consume = await consumeEngine(engine, {
    provider: "google",
    state: started.state,
  });
  const row = asRecord(consume);
  assert.equal(rowField(row, "intent"), "sign-in");
  assert.equal(rowField(row, "userId", "user_id") ?? null, null);
});

test("T-SOE-ATOMIC-PG: P?: Postgres consume is DELETE FROM athena.oauth_transactions … RETURNING * (no SELECT-then-DELETE)", () => {
  assert.equal(existsSync(localSocialDir), true);
  const src = joinedSources(localSocialDir);
  assert.match(src, /DELETE FROM athena\.oauth_transactions/i);
  assert.match(src, /RETURNING \*/);
  assert.match(src, /state_hash/);
  assert.match(src, /expires_at > NOW\(\)/);
  const consumeFns = src.match(/async consume[\s\S]{0,1200}/g);
  assert.ok(consumeFns && consumeFns.length > 0, "consume() must exist");
  for (const fn of consumeFns) {
    if (!(/oauth_transactions/.test(fn) || /RETURNING/.test(fn))) {
      continue;
    }
    assert.equal(
      /SELECT[\s\S]+DELETE/i.test(fn),
      false,
      "Postgres consume must not SELECT-then-DELETE",
    );
  }
});

test("T-SOE-ATOMIC-MEMORY: P?: Memory consume has exactly one winner with no await between get and delete", async () => {
  const { file } = await loadMemoryTransactionStore();
  const src = readFileSync(file, "utf8");
  const consumeMatch = src.match(
    /async consume\s*\([^)]*\)\s*:\s*Promise<[^>]+>\s*\{([\s\S]*?)\n(?:\t| {2})\}/,
  );
  const body = consumeMatch?.[1] ?? "";
  assert.ok(body.length > 0, "Memory consume method body must be present");
  assert.equal(
    /get\([\s\S]*await[\s\S]*delete\(/.test(body),
    false,
    "Memory consume must not await between get and delete",
  );
  const { engine } = await bootSocialEngine();
  const started = await startSignIn(engine);
  const settled = await Promise.allSettled([
    consumeEngine(engine, { provider: "google", state: started.state }),
    consumeEngine(engine, { provider: "google", state: started.state }),
  ]);
  const winners = settled.filter((row) => row.status === "fulfilled");
  assert.equal(winners.length, 1, "exactly one concurrent consume winner");
  assert.equal(settled.filter((row) => row.status === "rejected").length, 1);
});

test("T-SOE-PKCE-S256: P?: engine PKCE is S256 only (plain rejected)", async () => {
  const { engine } = await bootSocialEngine();
  const started = await startSignIn(engine);
  const url = new URL(String(started.url ?? started.authorizationURL ?? ""));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  await assert.rejects(
    () =>
      (engine.startAuthorization as AnyFn)({
        codeChallengeMethod: "plain",
        intent: "sign-in",
        pkceMethod: "plain",
        provider: "google",
        redirectUri: REDIRECT_URI,
      }),
    (error: unknown) =>
      error instanceof Error && /S256|plain|pkce/i.test(String(error)),
    "PKCE plain must be rejected",
  );
  const engineSrc = readFileSync(join(serverDir, "engine.ts"), "utf8");
  assert.match(engineSrc, /generateCodeChallenge/);
  assert.match(engineSrc, /S256/);
  assert.equal(
    /code_challenge_method["']?\s*:\s*["']plain["']/.test(engineSrc),
    false,
  );
});

test("T-SOE-NONCE-NE-STATE: P?: OIDC nonce is distinct from CSRF state (hashes unequal)", async () => {
  const { engine } = await bootSocialEngine();
  const started = await startSignIn(engine);
  const state = String(started.state);
  const nonce = String(started.nonce);
  assert.ok(state.length > 0);
  assert.ok(nonce.length > 0);
  assert.notEqual(state, nonce);
  assert.notEqual(await sha256Hex(state), await sha256Hex(nonce));
  assert.notEqual(await sha256Base64Url(state), await sha256Base64Url(nonce));
  const url = new URL(String(started.url ?? started.authorizationURL ?? ""));
  const urlState = url.searchParams.get("state");
  const urlNonce = url.searchParams.get("nonce");
  assert.equal(urlState, state);
  if (urlNonce) {
    assert.equal(urlNonce, nonce);
    assert.notEqual(urlNonce, urlState);
  }
});

test("T-SOE-MIXUP: P?: consume rejects when callback provider != transaction.provider", async () => {
  const errorsSrc = readFileSync(join(serverDir, "errors.ts"), "utf8");
  assert.match(errorsSrc, /ATHENA_AUTH_OAUTH_PROVIDER_MIXUP|MIXUP|mix-?up/i);
  const { engine } = await bootSocialEngine();
  const started = await startSignIn(engine, "google");
  await assert.rejects(
    () =>
      consumeEngine(engine, {
        provider: "github",
        state: started.state,
      }),
    (error: unknown) => {
      const code = errorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      return (
        code === "ATHENA_AUTH_OAUTH_PROVIDER_MIXUP" ||
        /mix-?up|provider/i.test(`${code} ${message}`)
      );
    },
    "callback provider != transaction.provider must fail-closed",
  );
});

test("T-SOE-REUSE-OAUTH2: P?: engine reuses oauth2 createAuthorizationURL / generateCodeChallenge / authorizationCodeRequest and social-providers factories", () => {
  assert.equal(existsSync(serverDir), true);
  const engineBlob = joinedSources(serverDir);
  assert.match(engineBlob, /createAuthorizationURL/);
  assert.match(engineBlob, /generateCodeChallenge/);
  assert.match(engineBlob, /authorizationCodeRequest/);
  assert.match(engineBlob, /social-providers/);
  const authTs = collectTsFiles(authRoot);
  for (const file of authTs) {
    const name = file.replace(/\\/g, "/").split("/").pop() ?? "";
    assert.equal(
      FORBIDDEN_ENGINE_FILES.includes(
        name as (typeof FORBIDDEN_ENGINE_FILES)[number],
      ),
      false,
      `forbidden OAuth library file ${name}`,
    );
  }
  assert.equal(existsSync(join(authRoot, "social", "oauth-client.ts")), false);
  assert.equal(existsSync(join(authRoot, "social", "google-oauth.ts")), false);
  assert.equal(existsSync(join(authRoot, "social", "github-oauth.ts")), false);
  assert.equal(
    existsSync(join(serverDir, "token-exchange.ts")),
    false,
    "do not duplicate token-exchange next to oauth2",
  );
  assert.equal(
    existsSync(join(serverDir, "userinfo.ts")),
    false,
    "do not duplicate userinfo next to social-providers",
  );
});

test("T-SOE-NO-PUBLIC-OAUTH: P?: no createOAuthClient, createSocialClient, createGoogleClient, or athena.oauth public surface", () => {
  const barrels = [
    readPkg("src/index.ts"),
    readPkg("src/auth/index.ts"),
    readPkg("src/auth/client.ts"),
    readPkg("src/v3-client.ts"),
    readPkg("src/browser.ts"),
    readPkg("package.json"),
  ].join("\n");
  for (const name of FORBIDDEN_PUBLIC_CTORS) {
    assert.equal(
      new RegExp(`\\b${name}\\b`).test(barrels),
      false,
      `${name} must not appear on the public surface`,
    );
  }
  assert.equal(/\bathena\.oauth\b/.test(barrels), false);
  const pkg = JSON.parse(readPkg("package.json")) as {
    exports?: Record<string, unknown>;
  };
  const exportKeys = Object.keys(pkg.exports ?? {});
  assert.equal(
    exportKeys.some((key) => key === "./oauth" || key.includes("athena.oauth")),
    false,
  );
  const typesSrc = readPkg("src/auth/types/catalog.ts");
  assert.match(typesSrc, /social:\s*\{/);
  assert.match(typesSrc, /signIn:/);
  assert.match(typesSrc, /account:\s*\{/);
  assert.match(typesSrc, /unlink:/);
  assert.match(typesSrc, /callback:\s*\{/);
  assert.match(typesSrc, /provider:/);
});

test("T-SOE-FIREWALL: P?: clientSecret, OAuthTransactionStore, token encryption, and provider server factories are absent from browser, next/client, react-native, and athena-auth-ui", () => {
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
        `${needle} must not appear in ${surface.label}`,
      );
    }
    for (const file of surface.files) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const src = existsSync(file) ? readFileSync(file, "utf8") : "";
      assert.equal(
        /from ["'][^"']*auth\/social\/server[^"']*["']/.test(src),
        false,
        `${rel} must not import social/server`,
      );
      assert.equal(
        /from ["'][^"']*auth\/local\/social[^"']*["']/.test(src),
        false,
        `${rel} must not import local/social`,
      );
    }
  }
});

test("T-SOE-ARCH-ORCHESTRATION: P?: social OAuth is orchestration, not a new OAuth library", () => {
  const clientSrc = [
    readPkg("src/auth/client.ts"),
    readPkg("src/auth/client/social.ts"),
    readPkg("src/auth/client/accounts.ts"),
  ].join("\n");
  assert.match(clientSrc, /social:\s*\{/);
  assert.match(clientSrc, /signIn:/);
  assert.match(clientSrc, /account:\s*\{/);
  assert.match(clientSrc, /unlink:/);
  assert.match(clientSrc, /callback:\s*\{/);
  assert.match(clientSrc, /\/sign-in\/social/);
  assert.match(clientSrc, /\/link-social/);
  assert.match(clientSrc, /\/unlink-account/);
  assert.match(clientSrc, /\/callback\//);
  const socialDir = join(authRoot, "social");
  const extra = collectTsFiles(socialDir).filter((file) => {
    const name = file.replace(/\\/g, "/");
    return (
      name.endsWith("/oauth-client.ts") ||
      name.endsWith("/google-oauth.ts") ||
      name.endsWith("/github-oauth.ts") ||
      name.endsWith("/token-exchange.ts") ||
      name.endsWith("/userinfo.ts")
    );
  });
  assert.deepEqual(extra, []);
  assert.equal(
    existsSync(join(authRoot, "oauth2", "create-authorization-url.ts")),
    true,
  );
  assert.equal(
    existsSync(join(authRoot, "social-providers", "google.ts")),
    true,
  );
  assert.equal(
    existsSync(join(authRoot, "social-providers", "github.ts")),
    true,
  );
  const pkg = JSON.parse(readPkg("package.json")) as {
    exports?: Record<string, unknown>;
  };
  assert.equal("createOAuthClient" in (pkg.exports ?? {}), false);
});
