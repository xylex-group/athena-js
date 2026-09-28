/**
 * Track A P4 TARGET — trusted passkey RP snapshot at Auth init (INV-PK-09 / INV-PK-10).
 * DESIRED: freeze one immutable AthenaPasskeyRelyingParty {id,name,origins,relatedOrigins}
 * at createAthenaAuthRuntime init. Precedence: explicit AthenaAuthPasskeyOptions /
 * app identity origins → unique-host security.trustedOrigins for rpId only →
 * documented localhost/dev defaults only. Trusted origins are not ceremony origins.
 * Never Host / x-forwarded-host / Origin. Production missing rpId fails closed.
 * Dual-suite T-RP-* MUST be RED on CURRENT (no factory / no config / no freeze).
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/05-passkey-relying-party.md
 * Draft ADR 0035. IDs T-RP-* only (not T-REG-* / T-AUTHN-* / T-CHAL-* / T-REPO-*).
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.relying-party.target.test.ts
 * Baseline B-RP-* retired: test/sdd/superseded/passkey-runtime-finality.relying-party.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import {
  type NormalizedAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "../../src/auth/config.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { createAthenaPasskeyServerEngine } from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";
import type { PasskeyRelyingPartyResolver } from "../../src/auth/passkey/server/relying-party.ts";
import type { AthenaPasskeyRelyingParty as DomainPasskeyRelyingParty } from "../../src/auth/passkey/server/types.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_passkey_relying_party_target";

/** Track A P6 inventory amend: POST verify-registration is no longer a stay-true gap. */
const SIX_REMAINING_PASSKEY_ROUTES = [
  "GET /passkey/list-user-passkeys",
  "POST /passkey/delete-passkey",
  "POST /passkey/generate-authenticate-options",
  "POST /passkey/update-passkey",
  "POST /passkey/verify-authentication",
] as const;

const ENGINE_PORT_FIELDS = [
  "audit",
  "challenges",
  "clock",
  "credentials",
  "sessions",
] as const;

const DEV_DEFAULT_ORIGINS = [
  "http://localhost",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
] as const;

const EMPTY_PASSKEY = {
  challengeTtlSeconds: 60,
  enabled: false,
  origins: [] as string[],
  relatedOrigins: [] as string[],
  rpId: null as string | null,
  rpName: null as string | null,
};

type NormalizedPasskey =
  NonNullable<
    NormalizedAthenaAuthConfig extends { passkey?: infer P } ? P : never
  > extends never
    ? typeof EMPTY_PASSKEY
    : NonNullable<
        NormalizedAthenaAuthConfig extends { passkey?: infer P } ? P : never
      >;

type SnapshotFactoryInput = {
  environment: "production" | "development";
  passkey: NormalizedPasskey;
  trustedOrigins: readonly string[];
};

type SnapshotFactory = (
  input: SnapshotFactoryInput
) => DomainPasskeyRelyingParty;

type RelyingPartyModule = {
  ATHENA_PASSKEY_DEV_DEFAULT_ORIGINS?: readonly string[];
  ATHENA_PASSKEY_DEV_DEFAULT_RELYING_PARTY?: DomainPasskeyRelyingParty;
  createPasskeyRelyingPartyResolver?: (
    snapshot: DomainPasskeyRelyingParty
  ) => PasskeyRelyingPartyResolver;
  createPasskeyRelyingPartySnapshot?: SnapshotFactory;
};

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
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
  assert.ok(start >= 0, `${name} must be an exported interface`);
  const openAt = src.indexOf("{", start);
  return extractBalanced(src, start, openAt);
}

function extractNamedExport(src: string, name: string): string {
  const needles = [
    `export function ${name}(`,
    `export const ${name} =`,
    `export function ${name} (`,
  ];
  let start = -1;
  for (const needle of needles) {
    start = src.indexOf(needle);
    if (start >= 0) {
      break;
    }
  }
  assert.ok(start >= 0, `${name} must be an exported factory`);
  const openAt = src.indexOf("{", start);
  assert.ok(openAt >= 0, `${name} body must exist`);
  return extractBalanced(src, start, openAt);
}

function inventoryKnownMissing(): string {
  const src = readPkg("test/auth-route-inventory.test.ts");
  const match = src.match(
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
}

async function loadRpModule(): Promise<RelyingPartyModule> {
  return (await import(
    "../../src/auth/passkey/server/relying-party.ts"
  )) as RelyingPartyModule;
}

async function snapshotFactory(): Promise<SnapshotFactory> {
  const rpMod = await loadRpModule();
  assert.equal(
    typeof rpMod.createPasskeyRelyingPartySnapshot,
    "function",
    "createPasskeyRelyingPartySnapshot must be exported from relying-party.ts"
  );
  return rpMod.createPasskeyRelyingPartySnapshot as SnapshotFactory;
}

function spoofedRequest(host = "evil.example"): Request {
  return new Request(
    "https://victim.example/auth/passkey/generate-register-options",
    {
      headers: {
        host,
        origin: `https://${host}`,
        referer: `https://${host}/login`,
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-host": host,
      },
    }
  );
}

function assertFrozenRp(
  rp: DomainPasskeyRelyingParty,
  expected: {
    id: string;
    name: string;
    origins: readonly string[];
    relatedOrigins?: readonly string[];
  }
): void {
  assert.equal(rp.id, expected.id);
  assert.equal(rp.name, expected.name);
  assert.deepEqual([...rp.origins], [...expected.origins]);
  assert.deepEqual(
    [...rp.relatedOrigins],
    [...(expected.relatedOrigins ?? [])]
  );
  assert.equal(Object.isFrozen(rp), true, "domain RP snapshot must be frozen");
  assert.equal(
    Object.isFrozen(rp.origins),
    true,
    "origins array must be a frozen copy"
  );
  assert.equal(
    Object.isFrozen(rp.relatedOrigins),
    true,
    "relatedOrigins array must be a frozen copy"
  );
  const before = rp.id;
  try {
    (rp as { id: string }).id = "mutated.example";
  } catch {
    // strict-mode throw is allowed; freeze no-op is allowed
  }
  assert.equal(rp.id, before, "snapshot.id must stay stable after assign");
}

function readRuntimeRp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>
): DomainPasskeyRelyingParty {
  const bag = runtime as ReturnType<typeof createAthenaAuthRuntime> & {
    passkeyRelyingParty?: DomainPasskeyRelyingParty;
    passkeyResolver?: PasskeyRelyingPartyResolver;
    relyingParty?: DomainPasskeyRelyingParty;
  };
  if (
    bag.passkeyRelyingParty &&
    typeof bag.passkeyRelyingParty.id === "string" &&
    Array.isArray(bag.passkeyRelyingParty.origins)
  ) {
    return bag.passkeyRelyingParty;
  }
  if (
    bag.relyingParty &&
    typeof bag.relyingParty.id === "string" &&
    Array.isArray(bag.relyingParty.origins)
  ) {
    return bag.relyingParty;
  }
  if (
    bag.passkeyResolver &&
    typeof bag.passkeyResolver.resolve === "function"
  ) {
    return bag.passkeyResolver.resolve();
  }
  assert.fail(
    "createAthenaAuthRuntime must freeze a passkey RP snapshot (passkeyRelyingParty or passkeyResolver)"
  );
}

function isConfigError(error: unknown): boolean {
  if (error instanceof AthenaConfigurationError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AthenaConfigurationError" ||
    /config|relying party|rpId/i.test(`${error.name} ${error.message}`)
  );
}

function withNodeEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.NODE_ENV;
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}

test("T-RP-SNAPSHOT: factory returns frozen domain RP; resolve() is the same reference", async () => {
  const rpSrc = readPkg("src/auth/passkey/server/relying-party.ts");
  const factorySrc = extractNamedExport(
    rpSrc,
    "createPasskeyRelyingPartySnapshot"
  );
  assert.equal(
    /\bRequest\b/.test(factorySrc),
    false,
    "createPasskeyRelyingPartySnapshot must not accept Request"
  );
  assert.match(factorySrc, /environment/);
  assert.match(factorySrc, /passkey/);
  assert.match(factorySrc, /trustedOrigins/);
  assert.match(factorySrc, /Object\.freeze/);

  const resolverIface = extractInterface(rpSrc, "PasskeyRelyingPartyResolver");
  assert.match(
    resolverIface,
    /\bresolve\s*\(\s*\)\s*:\s*AthenaPasskeyRelyingParty/
  );
  assert.equal(/\bRequest\b/.test(resolverIface), false);

  const rpMod = await loadRpModule();
  const createSnapshot = await snapshotFactory();
  assert.equal(
    typeof rpMod.createPasskeyRelyingPartyResolver,
    "function",
    "createPasskeyRelyingPartyResolver must wrap the frozen snapshot"
  );

  const snapshot = createSnapshot({
    environment: "development",
    passkey: {
      ...EMPTY_PASSKEY,
      origins: ["https://app.example.com"],
      relatedOrigins: ["https://app.example.com"],
      rpId: "app.example.com",
      rpName: "Example App",
    },
    trustedOrigins: ["https://other.example.com"],
  });
  assertFrozenRp(snapshot, {
    id: "app.example.com",
    name: "Example App",
    origins: ["https://app.example.com"],
    relatedOrigins: ["https://app.example.com"],
  });

  const resolver = rpMod.createPasskeyRelyingPartyResolver?.(snapshot);
  assert.ok(
    resolver,
    "resolver factory must return PasskeyRelyingPartyResolver"
  );
  const first = resolver.resolve();
  const second = resolver.resolve();
  assert.equal(
    first,
    snapshot,
    "resolve() returns the frozen snapshot reference"
  );
  assert.equal(second, first, "resolve() is stable across calls");

  const runtime = createAthenaAuthRuntime({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      passkey: {
        origins: ["https://app.example.com"],
        rpId: "app.example.com",
        rpName: "Example App",
      },
    } as never),
  });
  try {
    assertFrozenRp(readRuntimeRp(runtime), {
      id: "app.example.com",
      name: "Example App",
      origins: ["https://app.example.com"],
    });
  } finally {
    await runtime.close();
  }
});

test("T-RP-PRECEDENCE-EXPLICIT: AthenaAuthPasskeyOptions wins over trustedOrigins and localhost", async () => {
  const createSnapshot = await snapshotFactory();
  const snapshot = createSnapshot({
    environment: "development",
    passkey: {
      ...EMPTY_PASSKEY,
      origins: ["https://auth.example.com"],
      relatedOrigins: ["https://app.example.com"],
      rpId: "auth.example.com",
      rpName: "Auth App",
    },
    trustedOrigins: ["https://other.example.com", "http://localhost:3000"],
  });
  assertFrozenRp(snapshot, {
    id: "auth.example.com",
    name: "Auth App",
    origins: ["https://auth.example.com"],
    relatedOrigins: ["https://app.example.com"],
  });
  assert.notEqual(snapshot.id, "localhost");
  assert.notEqual(snapshot.id, "other.example.com");
});

test("T-RP-PRECEDENCE-TRUSTED: unique-host trustedOrigins does not become ceremony origins", async () => {
  const createSnapshot = await snapshotFactory();
  try {
    createSnapshot({
      environment: "production",
      passkey: { ...EMPTY_PASSKEY },
      trustedOrigins: [
        "https://app.example.com",
        "https://app.example.com:4443",
      ],
    });
    assert.fail(
      "production without identity or explicit passkey.origins must fail closed"
    );
  } catch (error) {
    assert.equal(isConfigError(error), true);
  }

  const mixed = createSnapshot({
    environment: "development",
    passkey: { ...EMPTY_PASSKEY },
    trustedOrigins: ["https://app.example.com", "https://www.example.com"],
  });
  assert.equal(
    mixed.id,
    "localhost",
    "mixed trusted hostnames must not guess rpId; fall through to documented dev defaults"
  );
});

test("T-RP-SPOOF-HOST: Host: evil.example never becomes rpId", async () => {
  const createSnapshot = await snapshotFactory();
  const request = spoofedRequest("evil.example");
  const snapshot = (
    createSnapshot as SnapshotFactory &
      ((
        input: SnapshotFactoryInput,
        request?: Request
      ) => DomainPasskeyRelyingParty)
  )(
    {
      environment: "development",
      passkey: { ...EMPTY_PASSKEY },
      trustedOrigins: [],
    },
    request
  );
  assert.notEqual(snapshot.id, "evil.example");
  assert.equal(snapshot.id, "localhost");
  assert.equal(snapshot.origins.includes("https://evil.example"), false);

  const runtime = createAthenaAuthRuntime({
    config: normalizeAthenaAuthConfig({ mode: "local" }),
    request,
  } as never);
  try {
    const rp = readRuntimeRp(runtime);
    assert.notEqual(rp.id, "evil.example");
    assert.equal(rp.id, "localhost");
  } finally {
    await runtime.close();
  }
});

test("T-RP-SPOOF-XFH: x-forwarded-host: evil.example never becomes rpId", async () => {
  const createSnapshot = await snapshotFactory();
  const request = new Request("https://victim.example/", {
    headers: {
      host: "victim.example",
      "x-forwarded-host": "evil.example",
    },
  });
  const snapshot = (
    createSnapshot as SnapshotFactory &
      ((
        input: SnapshotFactoryInput,
        request?: Request
      ) => DomainPasskeyRelyingParty)
  )(
    {
      environment: "development",
      passkey: { ...EMPTY_PASSKEY },
      trustedOrigins: ["https://app.example.com"],
    },
    request
  );
  assert.notEqual(snapshot.id, "evil.example");
  assert.equal(snapshot.id, "app.example.com");

  const rpSrc = readPkg("src/auth/passkey/server/relying-party.ts");
  const factorySrc = extractNamedExport(
    rpSrc,
    "createPasskeyRelyingPartySnapshot"
  );
  assert.equal(
    /x-forwarded-host/i.test(factorySrc),
    false,
    "snapshot factory must not read x-forwarded-host"
  );
});

test("T-RP-SPOOF-ORIGIN: Origin: https://evil.example never becomes rpId", async () => {
  const createSnapshot = await snapshotFactory();
  const request = new Request("https://victim.example/", {
    headers: {
      origin: "https://evil.example",
      referer: "https://evil.example/login",
    },
  });
  const snapshot = (
    createSnapshot as SnapshotFactory &
      ((
        input: SnapshotFactoryInput,
        request?: Request
      ) => DomainPasskeyRelyingParty)
  )(
    {
      environment: "development",
      passkey: { ...EMPTY_PASSKEY },
      trustedOrigins: [],
    },
    request
  );
  assert.notEqual(snapshot.id, "evil.example");
  assert.equal(snapshot.id, "localhost");
  assert.equal(snapshot.origins.includes("https://evil.example"), false);

  const runtimeSrc = readPkg("src/auth/local/runtime.ts");
  const freezeRegion = runtimeSrc.slice(
    runtimeSrc.indexOf("export function createAthenaAuthRuntime"),
    runtimeSrc.indexOf("export function createAthenaAuthRuntime") + 2500
  );
  assert.equal(
    /headers\.get\(\s*["']origin["']\s*\)/.test(freezeRegion),
    false,
    "runtime init must not derive rpId from Origin"
  );
});

test("T-RP-PROD-FAIL-CLOSED: production missing rpId and no unique trusted hostname throws", async () => {
  const createSnapshot = await snapshotFactory();
  assert.throws(
    () =>
      createSnapshot({
        environment: "production",
        passkey: { ...EMPTY_PASSKEY },
        trustedOrigins: [],
      }),
    (error: unknown) => isConfigError(error)
  );
  assert.throws(
    () =>
      createSnapshot({
        environment: "production",
        passkey: { ...EMPTY_PASSKEY, enabled: true },
        trustedOrigins: ["https://app.example.com", "https://www.example.com"],
      }),
    (error: unknown) => isConfigError(error)
  );

  withNodeEnv("production", () => {
    assert.throws(
      () =>
        createAthenaAuthRuntime({
          config: normalizeAthenaAuthConfig({
            mode: "local",
            passkey: { enabled: true },
          } as never),
        }),
      (error: unknown) => isConfigError(error)
    );
    const passwordOnly = createAthenaAuthRuntime({
      config: normalizeAthenaAuthConfig({ mode: "local" }),
    });
    const bag = passwordOnly as {
      passkeyRelyingParty?: DomainPasskeyRelyingParty;
    };
    assert.notEqual(
      bag.passkeyRelyingParty?.id,
      "localhost",
      "production without a passkey key must not attach localhost defaults"
    );
    void passwordOnly.close();
  });
});

test("T-RP-DEV-LOCALHOST: development without explicit/trusted identity uses localhost defaults", async () => {
  const createSnapshot = await snapshotFactory();
  const rpMod = await loadRpModule();
  const snapshot = createSnapshot({
    environment: "development",
    passkey: { ...EMPTY_PASSKEY },
    trustedOrigins: [],
  });
  assertFrozenRp(snapshot, {
    id: "localhost",
    name: "Athena",
    origins: DEV_DEFAULT_ORIGINS,
    relatedOrigins: [],
  });

  const documented =
    rpMod.ATHENA_PASSKEY_DEV_DEFAULT_ORIGINS ??
    rpMod.ATHENA_PASSKEY_DEV_DEFAULT_RELYING_PARTY?.origins;
  assert.ok(
    documented,
    "documented localhost/dev origins constant must be exported"
  );
  assert.deepEqual([...documented], [...DEV_DEFAULT_ORIGINS]);

  const runtime = createAthenaAuthRuntime({
    config: normalizeAthenaAuthConfig({ mode: "local" }),
  });
  try {
    assertFrozenRp(readRuntimeRp(runtime), {
      id: "localhost",
      name: "Athena",
      origins: DEV_DEFAULT_ORIGINS,
      relatedOrigins: [],
    });
  } finally {
    await runtime.close();
  }
});

test("T-RP-WILDCARD: wildcard and non-absolute origins are rejected (INV-PK-10)", async () => {
  const createSnapshot = await snapshotFactory();
  for (const origins of [
    ["*"],
    ["https://*.example.com"],
    ["https://app.example.com", "*"],
    ["//evil.example"],
    ["app.example.com"],
    [""],
  ] as const) {
    assert.throws(
      () =>
        createSnapshot({
          environment: "development",
          passkey: {
            ...EMPTY_PASSKEY,
            origins: [...origins],
            rpId: "app.example.com",
            rpName: "App",
          },
          trustedOrigins: [],
        }),
      (error: unknown) => isConfigError(error),
      `origins ${JSON.stringify(origins)} must be rejected`
    );
  }
});

test("T-RP-CONFIG: AthenaAuthPasskeyOptions on local config with enabled?, rpId, rpName, origins, relatedOrigins, challengeTtlSeconds", () => {
  const configSrc = readPkg("src/auth/config.ts");
  assert.match(configSrc, /export interface AthenaAuthPasskeyOptions \{/);
  const options = extractInterface(configSrc, "AthenaAuthPasskeyOptions");
  assert.match(options, /\benabled\?:\s*boolean;/);
  assert.match(options, /\brpId\?:\s*string;/);
  assert.match(options, /\brpName\?:\s*string;/);
  assert.match(options, /\borigins\?:\s*readonly\s+string\[\];/);
  assert.match(options, /\brelatedOrigins\?:\s*readonly\s+string\[\];/);
  assert.match(options, /\bchallengeTtlSeconds\?:\s*number;/);

  const local = extractInterface(configSrc, "AthenaAuthLocalConfig");
  assert.match(local, /\bpasskey\?:\s*AthenaAuthPasskeyOptions;/);
  assert.match(local, /\bmode:\s*"local"/);
  assert.match(local, /\bsecurity\?:/);

  const wireRp = extractInterface(
    readPkg("src/auth/types/catalog.ts"),
    "AthenaPasskeyRelyingParty"
  );
  assert.match(wireRp, /\bid\?:\s*string;/);
  assert.match(wireRp, /\bname\?:\s*string;/);
  assert.equal(/\borigins\b/.test(wireRp), false);
  assert.equal(/\brelatedOrigins\b/.test(wireRp), false);
});

test("T-RP-NORMALIZED: NormalizedAthenaAuthConfig.passkey always present with defaults and explicit copy", () => {
  const configSrc = readPkg("src/auth/config.ts");
  const normalized = extractInterface(configSrc, "NormalizedAthenaAuthConfig");
  assert.match(normalized, /\bpasskey:\s*\{/);
  assert.match(normalized, /\benabled:\s*boolean;/);
  assert.match(normalized, /\brpId:\s*string\s*\|\s*null;/);
  assert.match(normalized, /\brpName:\s*string\s*\|\s*null;/);
  assert.match(normalized, /\borigins:\s*string\[\];/);
  assert.match(normalized, /\brelatedOrigins:\s*string\[\];/);
  assert.match(normalized, /\bchallengeTtlSeconds:\s*number;/);

  const local = normalizeAthenaAuthConfig({
    mode: "local",
    passkey: {
      challengeTtlSeconds: 30,
      enabled: true,
      origins: ["https://app.example.com"],
      relatedOrigins: ["https://app.example.com"],
      rpId: "app.example.com",
      rpName: "Example",
    },
    security: { trustedOrigins: ["https://app.example.com"] },
  } as never);
  const passkey = (local as { passkey?: typeof EMPTY_PASSKEY }).passkey;
  assert.ok(
    passkey,
    "normalize must copy passkey onto NormalizedAthenaAuthConfig"
  );
  assert.equal(passkey.enabled, true);
  assert.equal(passkey.rpId, "app.example.com");
  assert.equal(passkey.rpName, "Example");
  assert.deepEqual(passkey.origins, ["https://app.example.com"]);
  assert.deepEqual(passkey.relatedOrigins, ["https://app.example.com"]);
  assert.equal(passkey.challengeTtlSeconds, 30);

  const defaults = normalizeAthenaAuthConfig({ mode: "local" }) as {
    passkey?: typeof EMPTY_PASSKEY;
  };
  assert.ok(defaults.passkey, "local normalize always includes passkey");
  assert.equal(defaults.passkey.enabled, false);
  assert.equal(defaults.passkey.rpId, null);
  assert.equal(defaults.passkey.rpName, null);
  assert.deepEqual(defaults.passkey.origins, []);
  assert.deepEqual(defaults.passkey.relatedOrigins, []);
  assert.equal(defaults.passkey.challengeTtlSeconds, 60);

  const disabled = normalizeAthenaAuthConfig(false) as {
    passkey?: typeof EMPTY_PASSKEY;
  };
  assert.ok(disabled.passkey, "disabled normalize always includes passkey");
  assert.equal(disabled.passkey.enabled, false);
  assert.equal(disabled.passkey.challengeTtlSeconds, 60);

  const remote = normalizeAthenaAuthConfig({ mode: "remote" }) as {
    passkey?: typeof EMPTY_PASSKEY;
  };
  assert.ok(remote.passkey, "remote normalize always includes passkey");

  const clampedLow = normalizeAthenaAuthConfig({
    mode: "local",
    passkey: { challengeTtlSeconds: 0 },
  } as never) as { passkey?: typeof EMPTY_PASSKEY };
  assert.equal(clampedLow.passkey?.challengeTtlSeconds, 1);

  const clampedHigh = normalizeAthenaAuthConfig({
    mode: "local",
    passkey: { challengeTtlSeconds: 601 },
  } as never) as { passkey?: typeof EMPTY_PASSKEY };
  assert.equal(clampedHigh.passkey?.challengeTtlSeconds, 600);

  assert.equal(
    defaults.passkey.rpId,
    null,
    "normalize must not invent rpId from Host"
  );
});

test("T-RP-ENABLED-NO-FLIP: passkey.enabled true does not set passkeys:true or clear missing routes", () => {
  const enabled = normalizeAthenaAuthConfig({
    mode: "local",
    passkey: {
      challengeTtlSeconds: 45,
      enabled: true,
      rpId: "app.example.com",
    },
  } as never);
  void enabled;
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
  assert.equal(
    readPkg("src/auth/capabilities.ts").includes("passkeyEnabled"),
    true
  );

  const listed = inventoryKnownMissing();
  for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
    assert.equal(
      listed.includes(`"${route}"`),
      false,
      `KNOWN_MISSING_IN_LOCAL must not list served ${route}`
    );
  }

  assert.throws(
    () =>
      createClient({
        auth: {
          mode: "local",
          passkey: { enabled: true, rpId: "app.example.com" },
          passkeys: true,
        } as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  );

  const challengeCreate = extractInterface(
    readPkg("src/auth/passkey/server/types.ts"),
    "AthenaPasskeyChallengeCreate"
  );
  assert.match(challengeCreate, /\bexpiresAt:\s*Date;/);
  assert.equal(
    /challengeTtlSeconds/.test(challengeCreate),
    false,
    "challenge create still uses caller expiresAt; TTL stays on config this cycle"
  );
  const localStore = readPkg("src/auth/local/passkey/challenge-store.ts");
  assert.match(localStore, /expiresAt:/);
  assert.equal(/challengeTtlSeconds/.test(localStore), false);
});

test("T-RP-FAIL-CLOSED: passkeys false; six remaining missing routes; construct throw; engine ports omit resolver", () => {
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);

  const listed = inventoryKnownMissing();
  for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
    assert.equal(
      listed.includes(`"${route}"`),
      false,
      `KNOWN_MISSING_IN_LOCAL must not list served ${route}`
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

  const ports = extractInterface(
    readPkg("src/auth/passkey/server/engine.ts"),
    "AthenaPasskeyServerEnginePorts"
  );
  for (const field of ENGINE_PORT_FIELDS) {
    assert.match(ports, new RegExp(`\\b${field}:`));
  }
  assert.equal(/\brelyingParty\b/.test(ports), false);
  assert.equal(/\bresolver\b/.test(ports), false);
  assert.equal(/\bPasskeyRelyingPartyResolver\b/.test(ports), false);
  assert.equal(
    readPkg("src/auth/passkey/server/engine.ts").includes(
      'from "./relying-party.ts"'
    ),
    false
  );

  assert.deepEqual(
    [...CANONICAL_PASSKEY_METHODS],
    [
      "generateRegisterOptions",
      "generateAuthenticateOptions",
      "verifyRegistration",
      "verifyAuthentication",
      "listUser",
      "delete",
      "update",
      "getRelatedOrigins",
    ]
  );
});

test("T-RP-NO-CEREMONY: engine unwired; createPasskeyModule does not call it; challenge-store and repository unchanged", () => {
  const moduleSrc = readPkg("src/auth/passkey/client-module.ts");
  assert.equal(
    /createAthenaPasskeyServerEngine/.test(moduleSrc),
    false,
    "createPasskeyModule must not construct the server engine this cycle"
  );
  assert.match(moduleSrc, /denyPasskeys/);
  assert.equal(/@simplewebauthn/.test(moduleSrc), false);
  assert.equal(/navigator\.credentials/.test(moduleSrc), false);

  assert.throws(
    () =>
      createAthenaPasskeyServerEngine({
        audit: {} as never,
        challenges: {} as never,
        clock: {} as never,
        credentials: {} as never,
        sessions: {} as never,
      }).finishAuthentication({} as never),
    (error: unknown) => error instanceof AthenaPasskeyServerNotWiredError
  );

  const challengeStore = readPkg("src/auth/passkey/server/challenge-store.ts");
  assert.match(challengeStore, /export interface PasskeyChallengeStore/);
  assert.equal(/createPasskeyRelyingPartySnapshot/.test(challengeStore), false);
  assert.equal(/x-forwarded-host/i.test(challengeStore), false);

  const repository = readPkg("src/auth/passkey/server/repository.ts");
  assert.match(repository, /export interface PasskeyRepository/);
  assert.equal(/createPasskeyRelyingPartySnapshot/.test(repository), false);
  assert.equal(/Host/.test(repository), false);
});
