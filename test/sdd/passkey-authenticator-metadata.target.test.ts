/**
 * Target suite — authenticator metadata fidelity (source of truth).
 * Persist must map BE→deviceType, BS→backedUp, transports→JSON TEXT.
 * Spec: docs/sdd/xylex/athena-js-embedded-auth-passkeys-finality/SPEC.md
 *
 * Baseline characterization retired (deleted): aliases + BE/BS persist
 * inverted the old hardcode pins. Historical IDs live in
 * test/sdd/superseded/passkey-authenticator-metadata.baseline.superseded.ts.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAuthModule } from "../../src/auth/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");

/** WebAuthn authenticator-data flag bits (spec). */
const AUTHDATA_BE = 0x08;
const AUTHDATA_BS = 0x10;
/** Existing plugin fixture: UP|AT — BE=0, BS=0. Cannot distinguish hardcode. */
const FLAGS_UP_AT = 0x41;
/** Distinguishing XOR case: UP|AT|BE — multiDevice and not backed up. */
const FLAGS_BE_ONLY = 0x49;
/** UP|AT|BE|BS — multiDevice and backed up. */
const FLAGS_BE_BS = 0x59;

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

const MAPPER_REL = "src/auth/local/passkey-authenticator-metadata.ts";

type PersistMapped = {
  backedUp: boolean;
  deviceType: "multiDevice" | "singleDevice";
  transports: string | null;
};

type PersistMapper = (input: {
  flags: number;
  transports?: readonly string[] | null;
}) => PersistMapped;

function readUtf8(relFromRepo: string): string {
  return readFileSync(join(repoRoot, relFromRepo), "utf8");
}

function extractRustCreatePasskey(handlersSrc: string): string {
  const start = handlersSrc.indexOf("async fn create_passkey(");
  assert.ok(start >= 0, "PasskeyStoreAdapter::create_passkey must exist");
  const rest = handlersSrc.slice(start);
  const next = rest.search(/\n {4}async fn /);
  return next === -1 ? rest : rest.slice(0, next);
}

function rustCreateHardcodesMetadata(createFn: string): boolean {
  const hardcodedTriple =
    /device_type:\s*"singleDevice"/.test(createFn) &&
    /backed_up:\s*false/.test(createFn) &&
    /transports:\s*None/.test(createFn);
  const readsAuthenticator =
    /\bflags\b/.test(createFn) ||
    /backup_eligible|backup_state|0x08|0x10/.test(createFn) ||
    /multiDevice/.test(createFn);
  return hardcodedTriple && !readsAuthenticator;
}

async function loadPersistMapper(): Promise<PersistMapper> {
  const abs = join(pkgRoot, MAPPER_REL);
  assert.equal(
    existsSync(abs),
    true,
    `${MAPPER_REL} must export the persist mapper (BE/BS/transports); registration still ignores authenticator metadata`
  );
  const mod = (await import(pathToFileURL(abs).href)) as {
    mapPasskeyAuthenticatorMetadata?: PersistMapper;
  };
  assert.equal(
    typeof mod.mapPasskeyAuthenticatorMetadata,
    "function",
    `${MAPPER_REL} must export mapPasskeyAuthenticatorMetadata({ flags, transports })`
  );
  return mod.mapPasskeyAuthenticatorMetadata as PersistMapper;
}

test("T-MAP-BE: BE=0 persists singleDevice; BE=1 persists multiDevice", async () => {
  const map = await loadPersistMapper();
  assert.equal(map({ flags: FLAGS_UP_AT }).deviceType, "singleDevice");
  assert.equal(map({ flags: FLAGS_BE_ONLY }).deviceType, "multiDevice");
  assert.equal(map({ flags: FLAGS_BE_BS }).deviceType, "multiDevice");
  assert.equal((FLAGS_BE_ONLY & AUTHDATA_BE) !== 0, true);
  assert.equal((FLAGS_UP_AT & AUTHDATA_BE) !== 0, false);

  const createFn = extractRustCreatePasskey(
    readUtf8("services/athena-auth/crates/api/src/plugins/passkey/handlers.rs")
  );
  assert.equal(
    rustCreateHardcodesMetadata(createFn),
    false,
    "Rust create_passkey must map BE (0x08) instead of hardcoding device_type=singleDevice"
  );
});

test("T-MAP-BS: BS=0 persists backedUp=false; BS=1 persists backedUp=true", async () => {
  const map = await loadPersistMapper();
  assert.equal(map({ flags: FLAGS_UP_AT }).backedUp, false);
  assert.equal(map({ flags: FLAGS_BE_ONLY }).backedUp, false);
  assert.equal(map({ flags: FLAGS_BE_BS }).backedUp, true);
  assert.equal((FLAGS_BE_BS & AUTHDATA_BS) !== 0, true);
  assert.equal((FLAGS_BE_ONLY & AUTHDATA_BS) !== 0, false);

  const createFn = extractRustCreatePasskey(
    readUtf8("services/athena-auth/crates/api/src/plugins/passkey/handlers.rs")
  );
  assert.equal(
    rustCreateHardcodesMetadata(createFn),
    false,
    "Rust create_passkey must map BS (0x10) instead of hardcoding backed_up=false"
  );
});

test("T-MAP-XOR: multiDevice is not the same flag as backedUp (BE=1, BS=0)", async () => {
  const map = await loadPersistMapper();
  const xor = map({ flags: FLAGS_BE_ONLY });
  assert.equal(xor.deviceType, "multiDevice");
  assert.equal(xor.backedUp, false);

  const both = map({ flags: FLAGS_BE_BS });
  assert.equal(both.deviceType, "multiDevice");
  assert.equal(both.backedUp, true);

  const neither = map({ flags: FLAGS_UP_AT });
  assert.equal(neither.deviceType, "singleDevice");
  assert.equal(neither.backedUp, false);
});

test("T-MAP-TR: transports persist as a JSON array string (or NULL if missing)", async () => {
  const map = await loadPersistMapper();
  const stored = map({
    flags: FLAGS_BE_ONLY,
    transports: ["internal", "hybrid"],
  }).transports;
  assert.equal(typeof stored, "string");
  assert.notEqual(stored, null);
  assert.deepEqual(JSON.parse(stored as string), ["internal", "hybrid"]);

  assert.equal(map({ flags: FLAGS_UP_AT }).transports, null);
  assert.equal(map({ flags: FLAGS_UP_AT, transports: null }).transports, null);
  assert.equal(map({ flags: FLAGS_UP_AT, transports: [] }).transports, null);

  const createFn = extractRustCreatePasskey(
    readUtf8("services/athena-auth/crates/api/src/plugins/passkey/handlers.rs")
  );
  assert.equal(
    rustCreateHardcodesMetadata(createFn),
    false,
    "Rust create_passkey must persist client/authenticator transports, not always None"
  );
});

test("T-RS-REG: Rust registration persist + plugin tests must use BE/BS-set flags", () => {
  const handlersSrc = readUtf8(
    "services/athena-auth/crates/api/src/plugins/passkey/handlers.rs"
  );
  const pluginTests = readUtf8(
    "services/athena-auth/crates/api/src/plugins/passkey/tests.rs"
  );
  const createFn = extractRustCreatePasskey(handlersSrc);

  assert.equal(
    rustCreateHardcodesMetadata(createFn),
    false,
    "verify-registration persist must write mapped columns; adapter still ignores authenticator metadata"
  );
  assert.match(
    `${createFn}\n${handlersSrc}`,
    /multiDevice/,
    "Rust persist path must be able to write multiDevice when BE is set"
  );
  assert.match(
    pluginTests,
    /make_auth_data\(\s*rp_id,\s*0x41,/,
    "existing 0x41 plugin tests must still create a row"
  );
  assert.match(
    pluginTests,
    /0x49|0x59/,
    "new Rust persist tests must not rely on 0x41 alone (use BE/BS-set flags)"
  );
});

test("T-JS-ALIAS: frozen type aliases exist without changing transports wire type", () => {
  const typesSrc = readFileSync(
    join(pkgRoot, "src/auth/types/catalog.ts"),
    "utf8"
  );
  assert.match(typesSrc, /export type AthenaPasskeyRegistrationOptions\b/);
  assert.match(typesSrc, /export type AthenaPasskeyAuthenticationOptions\b/);
  assert.match(
    typesSrc,
    /export (?:type|interface) AthenaPasskeyCredential(?:\s|=|\{)/
  );
  assert.match(typesSrc, /export type AthenaPasskeyDeviceType\b/);
  assert.match(
    typesSrc,
    /export interface AthenaPasskeyCredential \{[\s\S]*?transports\?: string;/
  );
  assert.match(
    typesSrc,
    /export interface AthenaPasskeyRecord \{[\s\S]*?authenticator:/
  );
});

test("T-EMB-WRITE: no embedded /passkey/* ceremony required; mapper shares Rust semantics", async () => {
  const inventory = JSON.parse(
    readFileSync(join(pkgRoot, "contracts/auth/routes.generated.json"), "utf8")
  ) as { missingInLocal: string[] };
  assert.equal(
    inventory.missingInLocal.includes("POST /passkey/verify-registration"),
    false,
    "Track A P6 inventory: POST /passkey/verify-registration is served locally"
  );

  const map = await loadPersistMapper();
  const xor = map({ flags: FLAGS_BE_ONLY, transports: ["internal", "hybrid"] });
  assert.equal(xor.deviceType, "multiDevice");
  assert.equal(xor.backedUp, false);
  assert.deepEqual(JSON.parse(xor.transports as string), [
    "internal",
    "hybrid",
  ]);
});

test("T-SURFACE: keep athena.auth.passkey.*; no new client; no server WebAuthn on root", () => {
  const auth = createAuthModule().auth;
  assert.deepEqual(
    Object.keys(auth.passkey).sort(),
    [
      ...CANONICAL_PASSKEY_METHODS,
      "register",
      "signIn",
    ].sort()
  );

  const pkgJson = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(
    typeof pkgJson.dependencies?.["@simplewebauthn/server"],
    "string",
    "@simplewebauthn/server is a server-only runtime dep for local register-options"
  );
  assert.equal(pkgJson.devDependencies?.["@simplewebauthn/server"], undefined);

  const clientSrc = readFileSync(join(pkgRoot, "src/auth/client.ts"), "utf8");
  const v3Src = readFileSync(join(pkgRoot, "src/v3-client.ts"), "utf8");
  const haystack = `${clientSrc}\n${v3Src}`;
  for (const symbol of FORBIDDEN_CLIENTS) {
    assert.equal(
      haystack.includes(symbol),
      false,
      `must not introduce ${symbol}`
    );
  }
});
