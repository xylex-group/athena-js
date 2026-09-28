/**
 * Target suite — passkey cross-runtime extraction (slice 2).
 * GREEN after extract + canonical browser adapter + shared metadata fixtures.
 *
 * Spec: docs/sdd/xylex/athena-js-embedded-auth-passkeys-finality/specs/02-cross-runtime-extraction.md
 * Dual-suite: docs/sdd/xylex/athena-js-embedded-auth-passkeys-finality/dual-suite/dual-suite-spec.md
 *
 * Do not host via `pnpm test:sdd`. Baseline deleted after extract
 * (supersede_kind=delete). Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit ^
 *   test/sdd/passkey-cross-runtime.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { createAuthModule } from "../../src/auth/client.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const CANONICAL_PASSKEY_METHODS = [
  "generateRegisterOptions",
  "generateAuthenticateOptions",
  "verifyRegistration",
  "verifyAuthentication",
  "listUser",
  "delete",
  "update",
  "getRelatedOrigins",
] as const;

const FORBIDDEN_CLIENTS = [
  "createPasskeyClient",
  "createWebAuthnClient",
  "athena.webauthn",
  "embeddedAuth.passkey",
] as const;

const FORBIDDEN_HIGH_LEVEL = [
  "authenticate",
  "registerPasskey",
  "authenticateWithPasskey",
] as const;

const CEREMONY_HELPERS = ["register", "signIn"] as const;

/** Track A P6 inventory amend: POST verify-registration is no longer a stay-true gap. */
const SIX_REMAINING_PASSKEY_ROUTES = [
  "GET /passkey/list-user-passkeys",
  "POST /passkey/delete-passkey",
  "POST /passkey/generate-authenticate-options",
  "POST /passkey/update-passkey",
  "POST /passkey/verify-authentication",
] as const;

const EXTRACTED = [
  "src/auth/passkey/contract.ts",
  "src/auth/passkey/client-module.ts",
  "src/auth/passkey/requests.ts",
  "src/auth/passkey/normalize.ts",
] as const;

const BROWSER_ADAPTER = [
  "toPublicKeyCredentialCreationOptions",
  "toPublicKeyCredentialRequestOptions",
  "serializeRegistrationCredential",
  "serializeAuthenticationCredential",
] as const;

const META_HELPERS = [
  "mapPasskeyAuthenticatorMetadata",
  "parseStoredPasskeyTransports",
  "serializePasskeyTransports",
  "normalizePasskeyDeviceType",
  "normalizeCredentialCounter",
] as const;

const AUTHDATA_BE = 0x08;
const AUTHDATA_BS = 0x10;
const FLAGS_UP_AT = 0x41;
const FLAGS_BE_ONLY = 0x49;
const FLAGS_BE_BS = 0x59;

const TS_FIXTURE_REL = "contracts/auth/passkey/authenticator-metadata.json";
const RUST_FIXTURE_REL =
  "services/athena-auth/crates/api/src/plugins/passkey/fixtures/authenticator-metadata.json";
const MAPPER_REL = "src/auth/local/passkey-authenticator-metadata.ts";
const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_passkey_target";

const CHALLENGE_B64 = "AQID";
const USER_ID_B64 = "BAUG";

type PersistMapped = {
  backedUp: boolean;
  deviceType: "multiDevice" | "singleDevice";
  transports: string | null;
};

type PersistMapper = (input: {
  flags: number;
  transports?: readonly string[] | null;
}) => PersistMapped;

type CreationPublicKey = { rp: { id?: string } };
type RequestPublicKey = { rpId?: string };

type BrowserAdapter = {
  serializeAuthenticationCredential?: (credential: unknown) => unknown;
  serializeRegistrationCredential?: (credential: unknown) => unknown;
  toPublicKeyCredentialCreationOptions: (
    options: Record<string, unknown>,
    fallback?: { rpId?: string }
  ) => CreationPublicKey;
  toPublicKeyCredentialRequestOptions: (
    options: Record<string, unknown>,
    fallback?: { rpId?: string }
  ) => RequestPublicKey;
};

type CredentialCall = { publicKey?: CreationPublicKey & RequestPublicKey };

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function passkeyRel(name: string): string {
  return join(srcRoot, "auth", "passkey", name);
}

function browserAdapterCandidates(): string[] {
  return [
    join(srcRoot, "auth", "passkey", "browser", "index.ts"),
    join(srcRoot, "auth", "passkey", "browser", "options.ts"),
    join(srcRoot, "auth", "passkey", "browser.ts"),
  ];
}

function extractBalanced(src: string, start: number, openAt: number): string {
  let depth = 0;
  for (let i = openAt; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unbalanced block starting at ${start}`);
}

function extractInterface(src: string, name: string): string {
  const needle = `export interface ${name} {`;
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `${name} interface must exist`);
  const openAt = src.indexOf("{", start);
  return extractBalanced(src, start, openAt);
}

function assertNotPublicExport(
  haystack: string,
  symbol: string,
  where: string
) {
  assert.equal(
    new RegExp(
      `export\\s+(?:\\*\\s+from\\s+['"][^'"]*passkey[^'"]*['"]|\\{[^}]*\\b${symbol}\\b|async\\s+function\\s+${symbol}\\b|function\\s+${symbol}\\b|const\\s+${symbol}\\b)`
    ).test(haystack),
    false,
    `${symbol} must not be a public export from ${where}`
  );
}

async function loadBrowserAdapter(): Promise<BrowserAdapter> {
  const entry = browserAdapterCandidates().find((file) => existsSync(file));
  assert.ok(entry, "src/auth/passkey/browser adapter entry must exist");
  const mod = (await import(
    pathToFileURL(entry as string).href
  )) as Partial<BrowserAdapter> & Record<string, unknown>;
  assert.equal(
    typeof mod.toPublicKeyCredentialCreationOptions,
    "function",
    "toPublicKeyCredentialCreationOptions must be exported"
  );
  assert.equal(
    typeof mod.toPublicKeyCredentialRequestOptions,
    "function",
    "toPublicKeyCredentialRequestOptions must be exported"
  );
  return mod as BrowserAdapter;
}

function withMockedCredentials() {
  const createCalls: CredentialCall[] = [];
  const getCalls: CredentialCall[] = [];
  const previousNavigator = (
    globalThis as { navigator?: { credentials?: unknown } }
  ).navigator;
  const credentials = {
    create: async (input: CredentialCall) => {
      createCalls.push(input);
      return { id: "cred", type: "public-key" };
    },
    get: async (input: CredentialCall) => {
      getCalls.push(input);
      return { id: "cred", type: "public-key" };
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { ...(previousNavigator ?? {}), credentials },
    writable: true,
  });
  return {
    createCalls,
    getCalls,
    restore: () => {
      if (previousNavigator === undefined) {
        Reflect.deleteProperty(globalThis, "navigator");
        return;
      }
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNavigator,
        writable: true,
      });
    },
  };
}

test("T2-TREE: extracted passkey module files exist", () => {
  for (const rel of EXTRACTED) {
    assert.equal(
      existsSync(join(pkgRoot, rel)),
      true,
      `${rel} must exist after extraction`
    );
  }
  const contractSrc = readPkg("src/auth/passkey/contract.ts");
  const requestsSrc = readPkg("src/auth/passkey/requests.ts");
  for (const method of CANONICAL_PASSKEY_METHODS) {
    assert.match(
      contractSrc,
      new RegExp(`\\b${method}\\b`),
      `contract.ts must name ${method}`
    );
  }
  assert.match(requestsSrc, /\/passkey\/generate-register-options/);
  assert.match(requestsSrc, /\/\.well-known\/webauthn/);
  assert.equal(
    existsSync(passkeyRel("metadata.ts")),
    true,
    "src/auth/passkey/metadata.ts must exist"
  );
  assert.equal(
    existsSync(passkeyRel("transports.ts")),
    true,
    "src/auth/passkey/transports.ts must exist"
  );
});

test("T2-COMPOSE: createPasskeyModule({ request, capabilities, sessionController }) is composed from createAuthModule", async () => {
  const abs = passkeyRel("client-module.ts");
  assert.equal(existsSync(abs), true, "src/auth/passkey/client-module.ts");
  const mod = (await import(pathToFileURL(abs).href)) as {
    createPasskeyModule?: (deps: {
      capabilities: unknown;
      request: unknown;
      sessionController: unknown;
    }) => Record<string, unknown>;
  };
  assert.equal(typeof mod.createPasskeyModule, "function");
  const factorySrc = readFileSync(abs, "utf8");
  assert.match(factorySrc, /sessionController/);
  assert.match(factorySrc, /capabilities/);
  assert.match(factorySrc, /\brequest\b/);

  const composed = mod.createPasskeyModule?.({
    capabilities: ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
    request: async () => ({ data: {}, ok: true, status: 200 }),
    sessionController: { accept: () => undefined },
  });
  assert.ok(
    composed,
    "createPasskeyModule must return the eight-method object plus ceremony helpers"
  );
  assert.deepEqual(
    Object.keys(composed).sort(),
    [
      ...CANONICAL_PASSKEY_METHODS,
      ...CEREMONY_HELPERS,
    ].sort()
  );
  for (const helper of FORBIDDEN_HIGH_LEVEL) {
    assert.equal(
      helper in composed,
      false,
      `createPasskeyModule must not expose high-level ${helper}()`
    );
  }
  assert.equal(
    factorySrc.includes("applyAuthMutationToSessionStore"),
    true,
    "successful passkey authentication must use the shared generation-gated session mutation path"
  );

  const clientSrc = readPkg("src/auth/client.ts");
  assert.match(
    clientSrc,
    /createPasskeyModule\s*\(/,
    "createAuthModule must compose createPasskeyModule"
  );
  assert.match(clientSrc, /sessionController/);

  const authIndex = readPkg("src/auth/index.ts");
  const rootIndex = readPkg("src/index.ts");
  assertNotPublicExport(authIndex, "createPasskeyModule", "src/auth/index.ts");
  assertNotPublicExport(rootIndex, "createPasskeyModule", "src/index.ts");
});

test("T2-SURFACE: Object.keys(auth.passkey) include canonical methods and compatibility aliases", () => {
  const keys = Object.keys(createAuthModule().auth.passkey).sort();
  assert.deepEqual(
    keys,
    [
      ...CANONICAL_PASSKEY_METHODS,
      ...CEREMONY_HELPERS,
    ].sort()
  );
  for (const helper of FORBIDDEN_HIGH_LEVEL) {
    assert.equal(
      keys.includes(helper),
      false,
      `auth.passkey must not grow a high-level ${helper}()`
    );
  }

  const typesSrc = readPkg("src/auth/types/catalog.ts");
  assert.match(typesSrc, /export interface AthenaPasskeyRecord\b/);
  assert.match(
    typesSrc,
    /export type AthenaPasskeyRegistrationOptions = AthenaPasskeyOptionsResponse/
  );
  assert.match(
    typesSrc,
    /export type AthenaPasskeyAuthenticationOptions = AthenaPasskeyOptionsResponse/
  );
  const iface = extractInterface(typesSrc, "AthenaPasskeyOptionsResponse");
  assert.equal(
    /^\s*rpId\s*[?:]/m.test(iface),
    false,
    "wire DTO must not grow a top-level rpId (adapter may still read extra JSON)"
  );
});

test("T2-NO-NS: no new public namespaces; forbidden client strings stay absent", () => {
  const haystack = `${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}\n${readPkg("src/index.ts")}`;
  for (const symbol of FORBIDDEN_CLIENTS) {
    assert.equal(
      haystack.includes(symbol),
      false,
      `must not introduce ${symbol}`
    );
  }
  const rootIndex = readPkg("src/index.ts");
  for (const helper of FORBIDDEN_HIGH_LEVEL) {
    assertNotPublicExport(rootIndex, helper, "src/index.ts");
  }
});

test("T2-BROWSER: canonical adapter symbols live under src/auth/passkey/browser/", () => {
  const browserDir = join(srcRoot, "auth", "passkey", "browser");
  assert.equal(existsSync(browserDir), true, "src/auth/passkey/browser/");
  const files = [
    join(browserDir, "index.ts"),
    join(browserDir, "options.ts"),
    join(browserDir, "serialize.ts"),
    join(srcRoot, "auth", "passkey", "browser.ts"),
  ];
  const haystack = files
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.ok(haystack.length > 0, "browser adapter sources must exist");
  for (const symbol of BROWSER_ADAPTER) {
    assert.match(
      haystack,
      new RegExp(
        `export (?:async )?function ${symbol}\\b|export \\{[^}]*\\b${symbol}\\b`
      ),
      `${symbol} must be exported from the browser adapter`
    );
  }
  assert.equal(
    haystack.includes("@simplewebauthn/server"),
    false,
    "browser adapter must not import WebAuthn server deps (PASSKEY-I4)"
  );
});

test("T2-RPID-CREATE: adapter forwards server rpId → rp.id → fallback into credentials.create publicKey.rp.id", async () => {
  const adapter = await loadBrowserAdapter();
  const { createCalls, restore } = withMockedCredentials();
  try {
    const fromRpId = adapter.toPublicKeyCredentialCreationOptions(
      {
        challenge: CHALLENGE_B64,
        rp: { id: "from-rp-id.example", name: "Athena" },
        rpId: "from-rpid.example",
        user: {
          displayName: "U",
          id: USER_ID_B64,
          name: "u@example.com",
        },
      },
      { rpId: "fallback.example" }
    );
    await (
      globalThis as unknown as {
        navigator: {
          credentials: { create: (input: CredentialCall) => Promise<unknown> };
        };
      }
    ).navigator.credentials.create({ publicKey: fromRpId });
    assert.equal(createCalls.at(-1)?.publicKey?.rp.id, "from-rpid.example");

    const fromRp = adapter.toPublicKeyCredentialCreationOptions(
      {
        challenge: CHALLENGE_B64,
        rp: { id: "from-rp-id.example", name: "Athena" },
        user: {
          displayName: "U",
          id: USER_ID_B64,
          name: "u@example.com",
        },
      },
      { rpId: "fallback.example" }
    );
    await (
      globalThis as unknown as {
        navigator: {
          credentials: { create: (input: CredentialCall) => Promise<unknown> };
        };
      }
    ).navigator.credentials.create({ publicKey: fromRp });
    assert.equal(createCalls.at(-1)?.publicKey?.rp.id, "from-rp-id.example");

    const fromFallback = adapter.toPublicKeyCredentialCreationOptions(
      {
        challenge: CHALLENGE_B64,
        user: {
          displayName: "U",
          id: USER_ID_B64,
          name: "u@example.com",
        },
      },
      { rpId: "fallback.example" }
    );
    await (
      globalThis as unknown as {
        navigator: {
          credentials: { create: (input: CredentialCall) => Promise<unknown> };
        };
      }
    ).navigator.credentials.create({ publicKey: fromFallback });
    assert.equal(createCalls.at(-1)?.publicKey?.rp.id, "fallback.example");
  } finally {
    restore();
  }
});

test("T2-RPID-GET: adapter forwards server rpId → rp.id → fallback into credentials.get publicKey.rpId", async () => {
  const adapter = await loadBrowserAdapter();
  const { getCalls, restore } = withMockedCredentials();
  try {
    const nav = (
      globalThis as unknown as {
        navigator: {
          credentials: { get: (input: CredentialCall) => Promise<unknown> };
        };
      }
    ).navigator;

    await nav.credentials.get({
      publicKey: adapter.toPublicKeyCredentialRequestOptions(
        {
          challenge: CHALLENGE_B64,
          rp: { id: "from-rp-id.example" },
          rpId: "from-rpid.example",
        },
        { rpId: "fallback.example" }
      ),
    });
    assert.equal(getCalls.at(-1)?.publicKey?.rpId, "from-rpid.example");

    await nav.credentials.get({
      publicKey: adapter.toPublicKeyCredentialRequestOptions(
        { challenge: CHALLENGE_B64, rp: { id: "from-rp-id.example" } },
        { rpId: "fallback.example" }
      ),
    });
    assert.equal(getCalls.at(-1)?.publicKey?.rpId, "from-rp-id.example");

    await nav.credentials.get({
      publicKey: adapter.toPublicKeyCredentialRequestOptions(
        { challenge: CHALLENGE_B64 },
        { rpId: "fallback.example" }
      ),
    });
    assert.equal(getCalls.at(-1)?.publicKey?.rpId, "fallback.example");
  } finally {
    restore();
  }
});

test("T2-META: metadata.ts + transports.ts export BE/BS/transports helpers", async () => {
  const metadataAbs = passkeyRel("metadata.ts");
  const transportsAbs = passkeyRel("transports.ts");
  assert.equal(existsSync(metadataAbs), true);
  assert.equal(existsSync(transportsAbs), true);
  const meta = (await import(pathToFileURL(metadataAbs).href)) as Record<
    string,
    unknown
  >;
  const transports = (await import(
    pathToFileURL(transportsAbs).href
  )) as Record<string, unknown>;
  const merged = { ...transports, ...meta };
  for (const helper of META_HELPERS) {
    assert.equal(
      typeof merged[helper] === "function",
      true,
      `${helper} must be exported from metadata.ts or transports.ts`
    );
  }

  const map = merged.mapPasskeyAuthenticatorMetadata as PersistMapper;
  assert.equal(map({ flags: FLAGS_UP_AT }).deviceType, "singleDevice");
  assert.equal(map({ flags: FLAGS_UP_AT }).backedUp, false);
  assert.equal(map({ flags: FLAGS_BE_ONLY }).deviceType, "multiDevice");
  assert.equal(map({ flags: FLAGS_BE_ONLY }).backedUp, false);
  assert.equal(map({ flags: FLAGS_BE_BS }).deviceType, "multiDevice");
  assert.equal(map({ flags: FLAGS_BE_BS }).backedUp, true);
  assert.deepEqual(
    JSON.parse(
      map({
        flags: FLAGS_BE_ONLY,
        transports: ["internal", "hybrid"],
      }).transports as string
    ),
    ["internal", "hybrid"]
  );
  assert.equal((FLAGS_BE_ONLY & AUTHDATA_BE) !== 0, true);
  assert.equal((FLAGS_BE_ONLY & AUTHDATA_BS) !== 0, false);

  const parse = merged.parseStoredPasskeyTransports as (
    value: string | null
  ) => unknown;
  const serialize = merged.serializePasskeyTransports as (
    value: readonly string[] | null
  ) => unknown;
  assert.deepEqual(parse(serialize(["internal", "hybrid"]) as string), [
    "internal",
    "hybrid",
  ]);
  assert.equal(parse(serialize(null) as string | null), null);

  const normalizeType = merged.normalizePasskeyDeviceType as (
    value: unknown
  ) => string;
  assert.equal(normalizeType("multiDevice"), "multiDevice");
  assert.equal(normalizeType("singleDevice"), "singleDevice");

  const normalizeCounter = merged.normalizeCredentialCounter as (
    value: unknown
  ) => number;
  assert.equal(normalizeCounter(0), 0);
  assert.equal(normalizeCounter(7), 7);
});

test("T2-FIX: shared JSON fixtures consumed by TS tests document the Rust path", async () => {
  const abs = join(pkgRoot, TS_FIXTURE_REL);
  assert.equal(existsSync(abs), true, TS_FIXTURE_REL);
  const raw = readFileSync(abs, "utf8");
  assert.ok(
    raw.includes(RUST_FIXTURE_REL) ||
      raw.includes(
        "crates/api/src/plugins/passkey/fixtures/authenticator-metadata.json"
      ),
    `fixture file must document the Rust consumption path ${RUST_FIXTURE_REL}`
  );
  const parsed = JSON.parse(raw) as {
    cases?: Array<{
      backedUp?: boolean;
      deviceType?: string;
      flags?: number;
      transports?: readonly string[] | null;
    }>;
  };
  const cases = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.cases)
      ? parsed.cases
      : [];
  const flags = new Set(
    cases
      .map((entry) =>
        typeof entry === "object" && entry && "flags" in entry
          ? Number((entry as { flags: number }).flags)
          : undefined
      )
      .filter((value): value is number => typeof value === "number")
  );
  assert.equal(flags.has(FLAGS_UP_AT), true, "fixture must include flags 0x41");
  assert.equal(
    flags.has(FLAGS_BE_ONLY),
    true,
    "fixture must include flags 0x49"
  );
  assert.equal(flags.has(FLAGS_BE_BS), true, "fixture must include flags 0x59");

  const metadataAbs = passkeyRel("metadata.ts");
  assert.equal(
    existsSync(metadataAbs),
    true,
    "metadata.ts consumes the fixture"
  );
  const meta = (await import(pathToFileURL(metadataAbs).href)) as {
    mapPasskeyAuthenticatorMetadata?: PersistMapper;
  };
  assert.equal(typeof meta.mapPasskeyAuthenticatorMetadata, "function");
  const map = meta.mapPasskeyAuthenticatorMetadata as PersistMapper;
  for (const entry of cases) {
    if (typeof entry?.flags !== "number") {
      continue;
    }
    const got = map({
      flags: entry.flags,
      transports: entry.transports,
    });
    const expectedType =
      entry.deviceType ??
      ((entry.flags & AUTHDATA_BE) === 0 ? "singleDevice" : "multiDevice");
    const expectedBacked =
      typeof entry.backedUp === "boolean"
        ? entry.backedUp
        : (entry.flags & AUTHDATA_BS) !== 0;
    assert.equal(got.deviceType, expectedType);
    assert.equal(got.backedUp, expectedBacked);
  }
});

test("T2-FAIL-CLOSED: embedded passkeys stay false; six remaining /passkey/* routes missing; construct still throws", () => {
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
  assert.equal(
    readPkg("src/auth/capabilities.ts").includes("passkeyEnabled"),
    true
  );
  const inventoryTest = readPkg("test/auth-route-inventory.test.ts");
  for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
    assert.equal(inventoryTest.includes(`"${route}"`), false, route);
  }
  const inventory = JSON.parse(
    readPkg("contracts/auth/routes.generated.json")
  ) as { missingInLocal: string[] };
  for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
    assert.equal(
      inventory.missingInLocal.includes(route),
      false,
      `routes.generated.json missingInLocal must not list ${route}`
    );
  }
  assert.throws(
    () =>
      createClient({
        auth: { passkeys: true } as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  );
  assert.throws(
    () =>
      createClient({
        auth: { webauthn: true } as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  );
});

test("T2-REEXPORT: slice-1 mapper path still re-exports mapPasskeyAuthenticatorMetadata", async () => {
  const abs = join(pkgRoot, MAPPER_REL);
  assert.equal(existsSync(abs), true, MAPPER_REL);
  const mapperSrc = readFileSync(abs, "utf8");
  assert.match(
    mapperSrc,
    /from\s+["'][^"']*passkey\/metadata/,
    `${MAPPER_REL} must re-export from src/auth/passkey/metadata.ts`
  );
  assert.match(mapperSrc, /mapPasskeyAuthenticatorMetadata/);
  const mod = (await import(pathToFileURL(abs).href)) as {
    mapPasskeyAuthenticatorMetadata?: PersistMapper;
  };
  assert.equal(typeof mod.mapPasskeyAuthenticatorMetadata, "function");
  const map = mod.mapPasskeyAuthenticatorMetadata as PersistMapper;
  assert.equal(map({ flags: FLAGS_BE_ONLY }).deviceType, "multiDevice");
  assert.equal(map({ flags: FLAGS_BE_ONLY }).backedUp, false);
});
