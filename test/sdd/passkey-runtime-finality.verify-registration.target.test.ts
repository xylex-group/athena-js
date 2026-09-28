/**
 * Track A P6 TARGET — local POST /passkey/verify-registration.
 * DESIRED: requireSession → parse PublicKeyCredential (string or wrapped) →
 * SHA-256(clientData challenge raw bytes) → ChallengeStore.consume
 * (registration + snapshot rpId + userId) → verifyRegistrationResponse
 * (@simplewebauthn/server, snapshot origin/RPID, UV not required) →
 * mapPasskeyAuthenticatorMetadata → PasskeyRepository.create → 200
 * AthenaPasskeyRecord / PasskeyView. passkeys stays false.
 *
 * RED on CURRENT for route/handler absent (404 / still allowlisted),
 * not because passkeys is already true.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/03-embedded-registration.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.verify-registration.target.test.ts
 *
 * Baseline characterization deleted after the POST handler landed (inverted
 * B-VREG-MISSING-ROUTE / B-VREG-NO-HANDLER / B-VREG-INVENTORY-10 / ceremony 404s).
 * Record:
 * test/sdd/superseded/passkey-runtime-finality.verify-registration.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import type { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createPasskeyRepository } from "../../src/auth/local/passkey/repository.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import { PASSKEY_REQUESTS } from "../../src/auth/passkey/requests.ts";
import { createAthenaPasskeyServerEngine } from "../../src/auth/passkey/server/engine.ts";
import { AthenaPasskeyServerNotWiredError } from "../../src/auth/passkey/server/errors.ts";
import type { AthenaAuthResult } from "../../src/auth/types.ts";
import { base64Url } from "../../src/auth/utils/base64.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const localRoot = join(pkgRoot, "src", "auth", "local");
const serverDir = join(pkgRoot, "src", "auth", "passkey", "server");
const browserDir = join(pkgRoot, "src", "auth", "passkey", "browser");
const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_passkey_verify_registration_target";

const VERIFY_REGISTRATION_ROUTE = "POST /passkey/verify-registration";
const VERIFY_REGISTRATION_PATH = "/passkey/verify-registration";
const REGISTER_OPTIONS_ROUTE = "GET /passkey/generate-register-options";
const REGISTER_OPTIONS_PATH = "/passkey/generate-register-options";

const FIVE_STAY_MISSING_PASSKEY_ROUTES = [
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

const WEBAUTHN_LIB_NEEDLES = [
  "@simplewebauthn/server",
  "@simplewebauthn/browser",
  "@simplewebauthn/types",
] as const;

const SNAPSHOT_RP_ID = "app.example.com";
const SNAPSHOT_RP_NAME = "Example App";
const SNAPSHOT_ORIGIN = "http://app.local";

const FLAGS_UP_AT = 0x41;
const FLAGS_BE_ONLY = 0x49;
const FLAGS_BE_BS = 0x59;

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

function listedMissingRoutes(): string[] {
  return [...inventoryKnownMissing().matchAll(/"([^"]+)"/g)].map(
    (item) => item[1] ?? ""
  );
}

function missingInLocalGenerated(): string[] {
  const inventory = JSON.parse(
    readPkg("contracts/auth/routes.generated.json")
  ) as {
    missingInLocal: string[];
  };
  return inventory.missingInLocal;
}

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, acc);
    } else if (entry.name.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function collectDirSrc(dir: string): string {
  return walkTs(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function hasLocalIfHandler(path: string, method: string): boolean {
  for (const file of walkTs(localRoot)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/if\s*\(([\s\S]*?)\)\s*\{/g)) {
      const cond = match[1] ?? "";
      if (
        cond.includes(`path === "${path}"`) &&
        cond.includes(`method === "${method}"`)
      ) {
        return true;
      }
    }
  }
  return false;
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

function createRuntime() {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      passkey: {
        origins: [SNAPSHOT_ORIGIN],
        rpId: SNAPSHOT_RP_ID,
        rpName: SNAPSHOT_RP_NAME,
      },
    }),
    hasher: createTestHasher(),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function signUp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string,
  name = "Ada"
): Promise<{ cookie: string; userId: string }> {
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email,
        name,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(
    signup.status,
    200,
    "sign-up/email must succeed for session setup"
  );
  const cookie = signup.headers.get("set-cookie");
  assert.ok(cookie, "sign-up must Set-Cookie a session");
  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { cookie },
    })
  );
  assert.equal(session.status, 200);
  const body = await json(session);
  const user = body.user as { id?: string };
  assert.equal(typeof user.id, "string");
  return { cookie, userId: user.id as string };
}

function verifyRegistrationRequest(
  body: unknown,
  cookie?: string,
  extraHeaders?: Record<string, string>
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    ...extraHeaders,
  });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new Request(`http://app.local/api/auth${VERIFY_REGISTRATION_PATH}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

function registerOptionsRequest(cookie: string): Request {
  return new Request(`http://app.local/api/auth${REGISTER_OPTIONS_PATH}`, {
    headers: { cookie },
    method: "GET",
  });
}

async function fetchRegisterChallenge(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  cookie: string
): Promise<string> {
  const response = await runtime.handle(registerOptionsRequest(cookie));
  assert.equal(
    response.status,
    200,
    "P5 GET generate-register-options must succeed"
  );
  const body = await json(response);
  assert.equal(typeof body.challenge, "string");
  return body.challenge as string;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBufferBytes(bytes))
  );
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function u16be(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, false);
  return buf;
}

function u32be(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, false);
  return buf;
}

async function coseEs256PublicKey(): Promise<Uint8Array> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  assert.equal(typeof jwk.x, "string");
  assert.equal(typeof jwk.y, "string");
  type CborValue = Parameters<typeof isoCBOR.encode>[0];
  const cose = new Map<string | number, CborValue>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, decodeBase64Url(jwk.x as string)],
    [-3, decodeBase64Url(jwk.y as string)],
  ]);
  return toArrayBufferBytes(Uint8Array.from(isoCBOR.encode(cose)));
}

async function buildPublicKeyCredential(input: {
  challenge: string;
  credentialId?: Uint8Array;
  flags?: number;
  origin?: string;
  rpId?: string;
  transports?: string[];
}): Promise<{
  credential: {
    clientExtensionResults: Record<string, never>;
    id: string;
    rawId: string;
    response: {
      attestationObject: string;
      clientDataJSON: string;
      transports?: string[];
    };
    type: "public-key";
  };
  credentialId: Uint8Array;
}> {
  const credentialId =
    input.credentialId ?? crypto.getRandomValues(new Uint8Array(16));
  const rpId = input.rpId ?? SNAPSHOT_RP_ID;
  const origin = input.origin ?? SNAPSHOT_ORIGIN;
  const flags = input.flags ?? FLAGS_UP_AT;
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const coseKey = await coseEs256PublicKey();
  const authData = concatBytes(
    rpIdHash,
    new Uint8Array([flags]),
    u32be(0),
    new Uint8Array(16),
    u16be(credentialId.byteLength),
    credentialId,
    coseKey
  );
  type CborValue = Parameters<typeof isoCBOR.encode>[0];
  const attestation = new Map<string | number, CborValue>([
    ["fmt", "none"],
    ["attStmt", new Map<string | number, CborValue>()],
    ["authData", toArrayBufferBytes(authData)],
  ]);
  const clientDataJSON = isoBase64URL.fromBuffer(
    toArrayBufferBytes(
      new TextEncoder().encode(
        JSON.stringify({
          challenge: input.challenge,
          origin,
          type: "webauthn.create",
        })
      )
    )
  );
  const id = isoBase64URL.fromBuffer(toArrayBufferBytes(credentialId));
  const credential = {
    clientExtensionResults: {},
    id,
    rawId: id,
    response: {
      attestationObject: isoBase64URL.fromBuffer(
        toArrayBufferBytes(Uint8Array.from(isoCBOR.encode(attestation)))
      ),
      clientDataJSON,
      ...(input.transports && input.transports.length > 0
        ? { transports: input.transports }
        : {}),
    },
    type: "public-key" as const,
  };
  return { credential, credentialId };
}

function unwiredPorts() {
  return {
    audit: {} as never,
    challenges: {} as never,
    clock: {} as never,
    credentials: {} as never,
    sessions: {} as never,
  };
}

function assertPasskeyView(
  body: Record<string, unknown>,
  expected: {
    backedUp: boolean;
    credentialId: Uint8Array;
    deviceType: "multiDevice" | "singleDevice";
    name?: string | null;
    transports?: string | null;
    userId: string;
  }
): void {
  assert.equal(typeof body.id, "string");
  assert.ok((body.id as string).length > 0);
  assert.equal(body.userId, expected.userId);
  assert.equal(body.credentialID, undefined);
  assert.equal(body.publicKey, undefined);
  assert.equal(body.counter, undefined);
  const authenticator = body.authenticator as {
    backedUp?: boolean;
    deviceType?: string;
    transports?: string[];
  };
  assert.equal(authenticator.deviceType, expected.deviceType);
  assert.equal(authenticator.backedUp, expected.backedUp);
  if (expected.name !== undefined) {
    assert.equal(body.name, expected.name);
  }
  if (expected.transports === null) {
    assert.equal((authenticator.transports ?? []).length, 0);
  } else if (expected.transports !== undefined) {
    assert.deepEqual(
      authenticator.transports,
      JSON.parse(expected.transports) as string[]
    );
  }
  assert.equal(typeof body.createdAt, "string");
  assert.ok(
    Number.isFinite(Date.parse(body.createdAt as string)),
    "createdAt must be RFC3339 / ISO-8601"
  );
}

test("T-VREG-SESSION: unauthenticated POST is 401; invalid session is 401", async () => {
  const runtime = createRuntime();
  const { credential } = await buildPublicKeyCredential({
    challenge: "dGVzdC1jaGFsbGVuZ2U",
  });
  const missing = await runtime.handle(
    verifyRegistrationRequest({ response: JSON.stringify(credential) })
  );
  assert.equal(
    missing.status,
    401,
    "found case: missing handler 404s instead of requireSession 401"
  );
  const missingBody = await json(missing);
  assert.equal(missingBody.message, "Authentication required");

  const bogus = await runtime.handle(
    verifyRegistrationRequest(
      { response: JSON.stringify(credential) },
      "athena-auth.session-token=session_deadbeef"
    )
  );
  assert.equal(bogus.status, 401);
  const bogusBody = await json(bogus);
  assert.equal(bogusBody.message, "Session not found or expired");
});

test("T-VREG-SUCCESS: valid ceremony after P5 GET returns 200 PasskeyView and one row", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-success@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential, credentialId } = await buildPublicKeyCredential({
    challenge,
  });
  const response = await runtime.handle(
    verifyRegistrationRequest(
      { name: "primary", response: JSON.stringify(credential) },
      cookie
    )
  );
  assert.equal(
    response.status,
    200,
    "found case: POST /passkey/verify-registration 404s (not served)"
  );
  const body = await json(response);
  assertPasskeyView(body, {
    backedUp: false,
    credentialId,
    deviceType: "singleDevice",
    name: "primary",
    userId,
  });

  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const rows = await createPasskeyRepository(stores).listByUser(userId);
  assert.equal(
    rows.length,
    1,
    "successful ceremony must persist exactly one passkey"
  );
  assert.equal(rows[0]?.userId, userId);
  assert.deepEqual(rows[0]?.credentialId, credentialId);

  const remaining = [...stores.verifications.values()].filter((row) =>
    row.identifier.startsWith("passkey:registration:")
  );
  assert.equal(
    remaining.length,
    0,
    "consume must DELETE the registration challenge (ADR 0033)"
  );
});

test("T-VREG-WRAP: wrapped browser payload and JSON-string response both succeed", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(runtime, "ada-vreg-wrap@example.com");

  const challengeA = await fetchRegisterChallenge(runtime, cookie);
  const { credential: stringCred, credentialId: idA } =
    await buildPublicKeyCredential({ challenge: challengeA });
  const stringRes = await runtime.handle(
    verifyRegistrationRequest(
      { name: "string", response: JSON.stringify(stringCred) },
      cookie
    )
  );
  assert.equal(
    stringRes.status,
    200,
    "found case: JSON-string response 404s because the POST is missing"
  );
  assertPasskeyView(await json(stringRes), {
    backedUp: false,
    credentialId: idA,
    deviceType: "singleDevice",
    name: "string",
    userId,
  });

  const challengeB = await fetchRegisterChallenge(runtime, cookie);
  const { credential: wrappedCred, credentialId: idB } =
    await buildPublicKeyCredential({ challenge: challengeB });
  const wrappedRes = await runtime.handle(
    verifyRegistrationRequest(
      { name: "wrapped", response: wrappedCred },
      cookie
    )
  );
  assert.equal(
    wrappedRes.status,
    200,
    "found case: object PublicKeyCredential 404s / is not unwrapped"
  );
  assertPasskeyView(await json(wrappedRes), {
    backedUp: false,
    credentialId: idB,
    deviceType: "singleDevice",
    name: "wrapped",
    userId,
  });

  const challengeC = await fetchRegisterChallenge(runtime, cookie);
  const { credential: nestedCred, credentialId: idC } =
    await buildPublicKeyCredential({ challenge: challengeC });
  const nestedRes = await runtime.handle(
    verifyRegistrationRequest(
      { name: "nested", response: { response: nestedCred } },
      cookie
    )
  );
  assert.equal(
    nestedRes.status,
    200,
    "found case: nested { response: PublicKeyCredential } is not unwrapped (Rust normalize_webauthn_response_payload)"
  );
  assertPasskeyView(await json(nestedRes), {
    backedUp: false,
    credentialId: idC,
    deviceType: "singleDevice",
    name: "nested",
    userId,
  });

  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    3
  );
});

test("T-VREG-CLIENT-DATA: invalid / missing clientDataJSON is 400 (not 404/500)", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-clientdata@example.com"
  );
  await fetchRegisterChallenge(runtime, cookie);

  const brokenJson = await runtime.handle(
    verifyRegistrationRequest({ response: "{" }, cookie)
  );
  assert.equal(
    brokenJson.status,
    400,
    "found case: invalid JSON 404s because the POST is missing"
  );
  assert.notEqual(brokenJson.status, 500);

  const missingClientData = await runtime.handle(
    verifyRegistrationRequest(
      {
        response: JSON.stringify({
          id: "credential-id",
          response: {},
          type: "public-key",
        }),
      },
      cookie
    )
  );
  assert.equal(missingClientData.status, 400);
  assert.notEqual(missingClientData.status, 500);

  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
});

test("T-VREG-ATTESTATION: malformed attestationObject is 400 (not 404/500)", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-attestation@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential } = await buildPublicKeyCredential({ challenge });
  credential.response.attestationObject = "%%%not-cbor";
  const response = await runtime.handle(
    verifyRegistrationRequest({ response: JSON.stringify(credential) }, cookie)
  );
  assert.equal(
    response.status,
    400,
    "found case: malformed attestation 404s / hand-rolled CBOR crash"
  );
  assert.notEqual(response.status, 500);
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
});

test("T-VREG-CHALLENGE: clientData challenge that does not match stored hash is 400; no persist", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-challenge@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const raw = decodeBase64Url(challenge);
  const digest = await sha256(raw);
  const expectedValue = base64Url.encode(digest, { padding: false });
  const wrongStringHash = base64Url.encode(
    await sha256(new TextEncoder().encode(challenge)),
    { padding: false }
  );
  assert.notEqual(
    expectedValue,
    wrongStringHash,
    "found case: hashing the base64url string is the wrong preimage"
  );

  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const before = [...stores.verifications.values()].filter((row) =>
    row.identifier.startsWith("passkey:registration:")
  );
  assert.ok(before.some((row) => row.value === expectedValue));

  const { credential } = await buildPublicKeyCredential({
    challenge: "d3JvbmctY2hhbGxlbmdl",
  });
  const response = await runtime.handle(
    verifyRegistrationRequest({ response: JSON.stringify(credential) }, cookie)
  );
  assert.equal(
    response.status,
    400,
    "found case: wrong challenge 404s (consume unused by HTTP)"
  );
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
  const after = [...stores.verifications.values()].filter((row) =>
    row.identifier.startsWith("passkey:registration:")
  );
  assert.ok(
    after.some((row) => row.value === expectedValue),
    "wrong challenge must miss consume and leave the P5 row"
  );

  assert.equal(
    walkTs(join(localRoot, "passkey")).some((file) => {
      if (file.endsWith("challenge-store.ts")) {
        return false;
      }
      const text = readFileSync(file, "utf8");
      return (
        /\.consume\s*\(/.test(text) &&
        /purpose:\s*["']registration["']/.test(text)
      );
    }),
    true,
    "found case: no verify HTTP path consumes purpose registration + snapshot rpId + userId"
  );
});

test("T-VREG-ORIGIN: clientData origin outside snapshot origins is 400", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-origin@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential } = await buildPublicKeyCredential({
    challenge,
    origin: "https://evil.example",
  });
  const response = await runtime.handle(
    verifyRegistrationRequest(
      { response: JSON.stringify(credential) },
      cookie,
      {
        origin: SNAPSHOT_ORIGIN,
      }
    )
  );
  assert.equal(
    response.status,
    400,
    "found case: clientData origin outside the frozen snapshot 404s or is accepted"
  );
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
});

test("T-VREG-RP: authenticator RP ID ≠ snapshot id is 400 even if Host matches it", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(runtime, "ada-vreg-rp@example.com");
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential } = await buildPublicKeyCredential({
    challenge,
    rpId: "evil.example",
  });
  const response = await runtime.handle(
    verifyRegistrationRequest(
      { response: JSON.stringify(credential) },
      cookie,
      { host: "evil.example", "x-forwarded-host": "evil.example" }
    )
  );
  assert.equal(
    response.status,
    400,
    "found case: expectedRPID from Host would accept evil.example"
  );
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
});

test("T-VREG-EXPIRED: challenge past expires_at is consume-miss 400; no persist", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-expired@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  for (const row of stores.verifications.values()) {
    if (row.identifier.startsWith("passkey:registration:")) {
      row.expires_at = new Date(Date.now() - 1000);
    }
  }
  const { credential } = await buildPublicKeyCredential({ challenge });
  const response = await runtime.handle(
    verifyRegistrationRequest({ response: JSON.stringify(credential) }, cookie)
  );
  assert.equal(
    response.status,
    400,
    "found case: expired challenge 404s (no consume miss 400)"
  );
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    0
  );
});

test("T-VREG-REPLAY: second POST of the same ceremony is 400; one row only", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-replay@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential, credentialId } = await buildPublicKeyCredential({
    challenge,
  });
  const body = { name: "replay", response: JSON.stringify(credential) };
  const first = await runtime.handle(verifyRegistrationRequest(body, cookie));
  assert.equal(
    first.status,
    200,
    "found case: first POST 404s so replay cannot be distinguished from missing handler"
  );
  const second = await runtime.handle(verifyRegistrationRequest(body, cookie));
  assert.equal(second.status, 400);
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const rows = await createPasskeyRepository(stores).listByUser(userId);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.credentialId, credentialId);
});

test("T-VREG-DUPLICATE: UNIQUE credential_id rejects a second persist (new challenge)", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(runtime, "ada-vreg-dup@example.com");
  const credentialId = crypto.getRandomValues(new Uint8Array(16));

  const challengeA = await fetchRegisterChallenge(runtime, cookie);
  const { credential: firstCred } = await buildPublicKeyCredential({
    challenge: challengeA,
    credentialId,
  });
  const first = await runtime.handle(
    verifyRegistrationRequest(
      { name: "first", response: JSON.stringify(firstCred) },
      cookie
    )
  );
  assert.equal(first.status, 200, "found case: first persist 404s");

  const challengeB = await fetchRegisterChallenge(runtime, cookie);
  const { credential: secondCred } = await buildPublicKeyCredential({
    challenge: challengeB,
    credentialId,
  });
  const second = await runtime.handle(
    verifyRegistrationRequest(
      { name: "second-challenge", response: JSON.stringify(secondCred) },
      cookie
    )
  );
  assert.equal(
    second.status,
    400,
    "found case: UNIQUE credential_id not enforced / missing handler 404"
  );
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(
    (await createPasskeyRepository(stores).listByUser(userId)).length,
    1
  );
});

test("T-VREG-BE-BS: flags 0x41/0x49/0x59 map via mapPasskeyAuthenticatorMetadata", async () => {
  const localFiles = walkTs(localRoot).filter(
    (file) => !file.endsWith("passkey-authenticator-metadata.ts")
  );
  assert.equal(
    localFiles.some((file) =>
      readFileSync(file, "utf8").includes("mapPasskeyAuthenticatorMetadata")
    ),
    true,
    "found case: persist copies SimpleWebAuthn credentialDeviceType without the ADR 0021 mapper"
  );

  const runtime = createRuntime();
  const { cookie, userId } = await signUp(runtime, "ada-vreg-bebs@example.com");
  const cases = [
    {
      backedUp: false,
      deviceType: "singleDevice" as const,
      flags: FLAGS_UP_AT,
    },
    {
      backedUp: false,
      deviceType: "multiDevice" as const,
      flags: FLAGS_BE_ONLY,
    },
    { backedUp: true, deviceType: "multiDevice" as const, flags: FLAGS_BE_BS },
  ];
  for (const item of cases) {
    const challenge = await fetchRegisterChallenge(runtime, cookie);
    const { credential, credentialId } = await buildPublicKeyCredential({
      challenge,
      flags: item.flags,
    });
    const label = `0x${item.flags.toString(16)}`;
    const response = await runtime.handle(
      verifyRegistrationRequest(
        { name: label, response: JSON.stringify(credential) },
        cookie
      )
    );
    assert.equal(
      response.status,
      200,
      `found case: flags 0x${item.flags.toString(16)} 404s / UV-required rejects 0x41`
    );
    assertPasskeyView(await json(response), {
      backedUp: item.backedUp,
      credentialId,
      deviceType: item.deviceType,
      userId,
    });
  }
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const rows = await createPasskeyRepository(stores).listByUser(userId);
  assert.equal(rows.length, 3);
  const byName = new Map(rows.map((row) => [row.name, row]));
  assert.equal(byName.get("0x41")?.deviceType, "singleDevice");
  assert.equal(byName.get("0x41")?.backedUp, false);
  assert.equal(byName.get("0x49")?.deviceType, "multiDevice");
  assert.equal(byName.get("0x49")?.backedUp, false);
  assert.equal(byName.get("0x59")?.deviceType, "multiDevice");
  assert.equal(byName.get("0x59")?.backedUp, true);
});

test("T-VREG-TRANSPORTS: client transports persist as a JSON-array string", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-transports@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential, credentialId } = await buildPublicKeyCredential({
    challenge,
    transports: ["internal", "hybrid"],
  });
  const response = await runtime.handle(
    verifyRegistrationRequest({ response: JSON.stringify(credential) }, cookie)
  );
  assert.equal(
    response.status,
    200,
    "found case: transports are ignored because the POST 404s"
  );
  const body = await json(response);
  assertPasskeyView(body, {
    backedUp: false,
    credentialId,
    deviceType: "singleDevice",
    transports: JSON.stringify(["internal", "hybrid"]),
    userId,
  });
  assert.equal(body.transports, undefined);
  assert.deepEqual(
    (body.authenticator as { transports?: string[] }).transports,
    ["internal", "hybrid"]
  );

  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const rows = await createPasskeyRepository(stores).listByUser(userId);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.transports, ["internal", "hybrid"]);
});

test("T-VREG-ROUTE: POST /passkey/verify-registration is served and removed only from missing inventory", () => {
  assert.equal(
    hasLocalIfHandler(VERIFY_REGISTRATION_PATH, "POST"),
    true,
    'found case: no if (path === "/passkey/verify-registration" && method === "POST") under src/auth/local'
  );
  assert.equal(
    hasLocalIfHandler(REGISTER_OPTIONS_PATH, "GET"),
    true,
    "P5 GET generate-register-options must remain served"
  );

  const listed = inventoryKnownMissing();
  assert.equal(
    listed.includes(`"${VERIFY_REGISTRATION_ROUTE}"`),
    false,
    "found case: POST /passkey/verify-registration still in KNOWN_MISSING_IN_LOCAL"
  );
  assert.equal(
    missingInLocalGenerated().includes(VERIFY_REGISTRATION_ROUTE),
    false,
    "found case: routes.generated.json missingInLocal still lists the POST"
  );
  assert.equal(
    listed.includes(`"${REGISTER_OPTIONS_ROUTE}"`),
    false,
    "GET /passkey/generate-register-options must stay served"
  );

  const quoted = listedMissingRoutes();
  const generated = missingInLocalGenerated();
  assert.equal(
    quoted.length,
    0,
    "live inventory must have no social gaps after embedded social HTTP"
  );
  assert.equal(generated.length, 0);
  for (const route of FOUR_SOCIAL) {
    assert.equal(quoted.includes(route), false, `served ${route}`);
    assert.equal(generated.includes(route), false, `served ${route}`);
  }

  const localBlob = collectDirSrc(localRoot);
  assert.equal(
    localBlob.includes("verifyRegistrationResponse"),
    true,
    "found case: src/auth/local does not wrap verifyRegistrationResponse"
  );
  assert.equal(
    /from\s+["']cbor["']|from\s+["']@cbor|cose-js|hand-?rolled CBOR/i.test(
      localBlob
    ),
    false,
    "must wrap a library; do not hand-roll CBOR/COSE"
  );
  const engineSrc = readPkg("src/auth/passkey/server/engine.ts");
  assert.equal(
    engineSrc.includes(VERIFY_REGISTRATION_PATH),
    false,
    "handler must live under src/auth/local, not engine.ts"
  );
  assert.equal(engineSrc.includes("verifyRegistrationResponse"), false);
});

test("T-VREG-NO-HOST: snapshot id/origins unchanged under spoofed Host / x-forwarded-host / Origin", async () => {
  const runtime = createRuntime();
  assert.equal(runtime.passkeyRelyingParty?.id, SNAPSHOT_RP_ID);
  assert.notEqual(runtime.passkeyRelyingParty?.id, "evil.example");
  const { cookie, userId } = await signUp(
    runtime,
    "ada-vreg-nohost@example.com"
  );
  const challenge = await fetchRegisterChallenge(runtime, cookie);
  const { credential, credentialId } = await buildPublicKeyCredential({
    challenge,
  });
  const response = await runtime.handle(
    verifyRegistrationRequest(
      { name: "no-host", response: JSON.stringify(credential) },
      cookie,
      {
        host: "evil.example",
        origin: SNAPSHOT_ORIGIN,
        "x-forwarded-host": "evil.example",
      }
    )
  );
  assert.equal(
    response.status,
    200,
    "found case: spoofed Host/Origin become expectedRPID/expectedOrigin and the ceremony 400s or 404s"
  );
  assertPasskeyView(await json(response), {
    backedUp: false,
    credentialId,
    deviceType: "singleDevice",
    name: "no-host",
    userId,
  });
  assert.equal(runtime.passkeyRelyingParty?.id, SNAPSHOT_RP_ID);

  const factorySrc = readPkg("src/auth/passkey/server/relying-party.ts");
  assert.match(
    factorySrc,
    /export function createPasskeyRelyingPartySnapshot\(/
  );
  assert.equal(
    /createPasskeyRelyingPartySnapshot\([\s\S]*Request/.test(factorySrc),
    false
  );
  const runtimeSrc = readPkg("src/auth/local/runtime.ts");
  assert.equal(
    runtimeSrc.includes("createPasskeyRelyingPartySnapshot({\n      request"),
    false
  );
});

test("T-VREG-FAIL-CLOSED: construct throw; denyPasskeys on disabled snapshot; engine NotWired", async () => {
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);

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

  const listed = inventoryKnownMissing();
  const generated = missingInLocalGenerated();
  for (const route of FIVE_STAY_MISSING_PASSKEY_ROUTES) {
    assert.equal(
      listed.includes(`"${route}"`),
      false,
      `KNOWN_MISSING_IN_LOCAL must not list served ${route}`
    );
    assert.equal(generated.includes(route), false);
  }
  for (const route of FOUR_SOCIAL) {
    assert.equal(listed.includes(`"${route}"`), false);
    assert.equal(generated.includes(route), false);
  }

  const factorySrc = readPkg("src/auth/passkey/client-module.ts");
  const gatesSrc = readPkg("src/auth/client/capability-gates.ts");
  assert.match(factorySrc, /denyPasskeys\(/);
  assert.match(gatesSrc, /export function denyPasskeys\b/);
  const denied = await createPasskeyModule({
    capabilities: {
      passkeys: false,
      source: "bootstrap",
      status: "known",
    },
    request: async <T>(): Promise<AthenaAuthResult<T>> => ({
      data: null,
      error: null,
      ok: true,
      raw: {},
      status: 200,
    }),
    sessionController: { accept: () => undefined },
  }).verifyRegistration({
    response: JSON.stringify({
      id: "credential-id",
      rawId: "credential-id",
      response: { attestationObject: "o2NmbXRkbm9uZQ", clientDataJSON: "e30" },
      type: "public-key",
    }),
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 501);
  assert.equal(denied.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");

  assert.throws(
    () =>
      createAthenaPasskeyServerEngine(unwiredPorts()).startRegistration(
        {} as never
      ),
    (error: unknown) => error instanceof AthenaPasskeyServerNotWiredError
  );
  assert.throws(
    () =>
      createAthenaPasskeyServerEngine(unwiredPorts()).finishRegistration(
        {} as never
      ),
    (error: unknown) => error instanceof AthenaPasskeyServerNotWiredError
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
  assert.equal(
    PASSKEY_REQUESTS.verifyRegistration.path,
    VERIFY_REGISTRATION_PATH
  );
  assert.equal(PASSKEY_REQUESTS.verifyRegistration.method, "POST");
  assert.equal(PASSKEY_REQUESTS.verifyRegistration.gated, true);
});

test("T-VREG-ISOLATION: engine.ts / passkey/server / browser stay free of WebAuthn server libraries", () => {
  const serverSrc = collectDirSrc(serverDir);
  const browserSrc = collectDirSrc(browserDir);
  const browserEntry = readPkg("src/browser.ts");
  const engineSrc = readPkg("src/auth/passkey/server/engine.ts");
  for (const needle of WEBAUTHN_LIB_NEEDLES) {
    assert.equal(
      serverSrc.includes(needle),
      false,
      `passkey/server must not import ${needle}`
    );
    assert.equal(
      browserSrc.includes(needle),
      false,
      `passkey/browser must not import ${needle}`
    );
    assert.equal(
      browserEntry.includes(needle),
      false,
      `src/browser.ts must not import ${needle}`
    );
  }
  assert.equal(engineSrc.includes("verifyRegistrationResponse"), false);
  assert.equal(/from\s+["']\.\/browser["']/.test(engineSrc), false);
  assert.equal(/navigator\.credentials/.test(serverSrc), false);
  const verifySrc = readPkg("src/auth/local/passkey/verify-registration.ts");
  assert.equal(
    /^import\s+["']server-only["']/m.test(verifySrc),
    false,
    "verify-registration must not import server-only; v3-client → src/index.ts reaches it"
  );
});
