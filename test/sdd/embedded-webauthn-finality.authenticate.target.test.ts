/**
 * TARGET — Embedded WebAuthn authentication, management, related origins.
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/embedded-webauthn-finality.authenticate.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createPasskeyModule } from "../../src/auth/passkey/client-module.ts";
import type { AthenaAuthResult } from "../../src/auth/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

const AUTHENTICATE_OPTIONS_PATH = "/passkey/generate-authenticate-options";
const VERIFY_AUTHENTICATION_PATH = "/passkey/verify-authentication";
const REGISTER_OPTIONS_PATH = "/passkey/generate-register-options";
const VERIFY_REGISTRATION_PATH = "/passkey/verify-registration";
const LIST_PATH = "/passkey/list-user-passkeys";
const DELETE_PATH = "/passkey/delete-passkey";
const UPDATE_PATH = "/passkey/update-passkey";
const RELATED_ORIGINS_PATH = "/.well-known/webauthn";

const SNAPSHOT_RP_ID = "app.example.com";
const SNAPSHOT_RP_NAME = "Example App";
const SNAPSHOT_ORIGIN = "http://app.local";
const RELATED_ORIGIN = "https://app.example.com";
const FLAGS_UP = 0x01;

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
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
        relatedOrigins: [RELATED_ORIGIN],
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
  email: string
): Promise<{ cookie: string; userId: string }> {
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email,
        name: "Ada",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie");
  assert.ok(cookie);
  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { cookie },
    })
  );
  const body = await json(session);
  const user = body.user as { id?: string };
  assert.equal(typeof user.id, "string");
  return { cookie, userId: user.id as string };
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

function trimInteger(bytes: Uint8Array): Uint8Array {
  let index = 0;
  while (index < bytes.length - 1 && bytes[index] === 0) {
    index += 1;
  }
  const trimmed = bytes.slice(index);
  if ((trimmed[0] ?? 0) & 0x80) {
    const prefixed = new Uint8Array(trimmed.length + 1);
    prefixed.set(trimmed, 1);
    return prefixed;
  }
  return trimmed;
}

function ieeeP1363ToDer(raw: Uint8Array): Uint8Array {
  const half = raw.byteLength / 2;
  const r = trimInteger(raw.slice(0, half));
  const s = trimInteger(raw.slice(half));
  const sequence = new Uint8Array(6 + r.length + s.length);
  sequence[0] = 0x30;
  sequence[1] = 4 + r.length + s.length;
  sequence[2] = 0x02;
  sequence[3] = r.length;
  sequence.set(r, 4);
  sequence[4 + r.length] = 0x02;
  sequence[5 + r.length] = s.length;
  sequence.set(s, 6 + r.length);
  return sequence;
}

async function coseEs256PublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
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

async function generatePasskeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
}

async function buildRegistrationCredential(input: {
  challenge: string;
  credentialId: Uint8Array;
  publicKey: CryptoKey;
}): Promise<{
  id: string;
  rawId: string;
  response: { attestationObject: string; clientDataJSON: string };
  type: "public-key";
  clientExtensionResults: Record<string, never>;
}> {
  const rpIdHash = await sha256(new TextEncoder().encode(SNAPSHOT_RP_ID));
  const coseKey = await coseEs256PublicKey(input.publicKey);
  const authData = concatBytes(
    rpIdHash,
    new Uint8Array([0x41]),
    u32be(0),
    new Uint8Array(16),
    u16be(input.credentialId.byteLength),
    input.credentialId,
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
          origin: SNAPSHOT_ORIGIN,
          type: "webauthn.create",
        })
      )
    )
  );
  const id = isoBase64URL.fromBuffer(toArrayBufferBytes(input.credentialId));
  return {
    clientExtensionResults: {},
    id,
    rawId: id,
    response: {
      attestationObject: isoBase64URL.fromBuffer(
        toArrayBufferBytes(Uint8Array.from(isoCBOR.encode(attestation)))
      ),
      clientDataJSON,
    },
    type: "public-key",
  };
}

async function buildAssertion(input: {
  challenge: string;
  counter: number;
  credentialId: Uint8Array;
  privateKey: CryptoKey;
}): Promise<Record<string, unknown>> {
  const rpIdHash = await sha256(new TextEncoder().encode(SNAPSHOT_RP_ID));
  const authenticatorData = concatBytes(
    rpIdHash,
    new Uint8Array([FLAGS_UP]),
    u32be(input.counter)
  );
  const clientData = JSON.stringify({
    challenge: input.challenge,
    origin: SNAPSHOT_ORIGIN,
    type: "webauthn.get",
  });
  const clientDataBytes = new TextEncoder().encode(clientData);
  const clientDataHash = await sha256(clientDataBytes);
  const signed = concatBytes(authenticatorData, clientDataHash);
  const ieee = new Uint8Array(
    await crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      input.privateKey,
      toArrayBufferBytes(signed)
    )
  );
  const der = ieeeP1363ToDer(ieee);
  const id = isoBase64URL.fromBuffer(toArrayBufferBytes(input.credentialId));
  return {
    clientExtensionResults: {},
    id,
    rawId: id,
    response: {
      authenticatorData: isoBase64URL.fromBuffer(
        toArrayBufferBytes(authenticatorData)
      ),
      clientDataJSON: isoBase64URL.fromBuffer(
        toArrayBufferBytes(clientDataBytes)
      ),
      signature: isoBase64URL.fromBuffer(toArrayBufferBytes(der)),
    },
    type: "public-key",
  };
}

async function registerPasskey(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  cookie: string,
  pair: CryptoKeyPair,
  credentialId = crypto.getRandomValues(new Uint8Array(16))
): Promise<Uint8Array> {
  const options = await runtime.handle(
    new Request(`http://app.local/api/auth${REGISTER_OPTIONS_PATH}`, {
      headers: { cookie },
      method: "GET",
    })
  );
  assert.equal(options.status, 200);
  const challenge = (await json(options)).challenge as string;
  const credential = await buildRegistrationCredential({
    challenge,
    credentialId,
    publicKey: pair.publicKey,
  });
  const verify = await runtime.handle(
    new Request(`http://app.local/api/auth${VERIFY_REGISTRATION_PATH}`, {
      body: JSON.stringify({ name: "laptop", response: credential }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(verify.status, 200, await verify.clone().text());
  return credentialId;
}

test("T-AUTHN-OPTIONS: unauthenticated POST returns empty allowCredentials", async () => {
  const runtime = createRuntime();
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${AUTHENTICATE_OPTIONS_PATH}`, {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(typeof body.challenge, "string");
  assert.deepEqual(body.allowCredentials, []);
  assert.equal(body.rpId, SNAPSHOT_RP_ID);
});

test("T-AUTHN-OPTIONS: authenticated POST lists the user's credentials", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "ada-authn-options@example.com");
  const pair = await generatePasskeyPair();
  const credentialId = await registerPasskey(runtime, cookie, pair);
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${AUTHENTICATE_OPTIONS_PATH}`, {
      body: "{}",
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  const allow = body.allowCredentials as { id?: string }[];
  assert.equal(Array.isArray(allow), true);
  assert.equal(allow.length, 1);
  assert.equal(
    allow[0]?.id,
    isoBase64URL.fromBuffer(toArrayBufferBytes(credentialId))
  );
});

test("T-AUTHN-VERIFY: assertion issues a session cookie", async () => {
  const runtime = createRuntime();
  const { cookie, userId } = await signUp(
    runtime,
    "ada-authn-verify@example.com"
  );
  const pair = await generatePasskeyPair();
  const credentialId = await registerPasskey(runtime, cookie, pair);
  const options = await runtime.handle(
    new Request(`http://app.local/api/auth${AUTHENTICATE_OPTIONS_PATH}`, {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const challenge = (await json(options)).challenge as string;
  const assertion = await buildAssertion({
    challenge,
    counter: 1,
    credentialId,
    privateKey: pair.privateKey,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${VERIFY_AUTHENTICATION_PATH}`, {
      body: JSON.stringify({ response: assertion }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(response.headers.get("set-cookie"));
  const body = await json(response);
  assert.equal((body.user as { id?: string }).id, userId);
  assert.equal(typeof (body.session as { token?: string }).token, "string");
});

test("T-PKM: list requires session; delete/update 404 non-owner; update name only", async () => {
  const runtime = createRuntime();
  const unauth = await runtime.handle(
    new Request(`http://app.local/api/auth${LIST_PATH}`)
  );
  assert.equal(unauth.status, 401);

  const ada = await signUp(runtime, "ada-pkm@example.com");
  const bob = await signUp(runtime, "bob-pkm@example.com");
  const pair = await generatePasskeyPair();
  await registerPasskey(runtime, ada.cookie, pair);

  const listed = await runtime.handle(
    new Request(`http://app.local/api/auth${LIST_PATH}`, {
      headers: { cookie: ada.cookie },
    })
  );
  assert.equal(listed.status, 200);
  const rows = (await listed.json()) as { id: string; name?: string }[];
  assert.equal(rows.length, 1);
  const passkeyId = rows[0]?.id as string;

  const stolen = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: passkeyId }),
      headers: {
        "content-type": "application/json",
        cookie: bob.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(stolen.status, 404);

  const renamed = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: passkeyId, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(renamed.status, 200);
  const renamedBody = await json(renamed);
  assert.equal((renamedBody.passkey as { name?: string }).name, "office key");

  const deleted = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: passkeyId }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(deleted.status, 200);
  const deletedBody = await json(deleted);
  assert.equal(deletedBody.status, true);
});

test("T-ROR: GET /.well-known/webauthn returns snapshot related origins", async () => {
  const runtime = createRuntime();
  const response = await runtime.handle(
    new Request(`http://app.local${RELATED_ORIGINS_PATH}`)
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(body.origins, [RELATED_ORIGIN]);
});

test("T-AUTHN-ROUTE: handlers are served and inventory no longer lists passkey gaps", () => {
  const runtime = readPkg("src/auth/local/router.ts");
  assert.equal(
    runtime.includes("handleGenerateAuthenticateOptionsRoute"),
    true
  );
  assert.equal(runtime.includes("handleVerifyAuthenticationRoute"), true);
  assert.equal(runtime.includes("handleListUserPasskeysRoute"), true);
  const listed = readPkg("test/auth-route-inventory.test.ts");
  assert.equal(listed.includes('"POST /passkey/verify-authentication"'), false);
  assert.equal(listed.includes('"GET /.well-known/webauthn"'), false);
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
});

test("T-SESS: verifyAuthentication success accepts the canonical session; failure does not", async () => {
  const accepted: unknown[] = [];
  const module = createPasskeyModule({
    capabilities: {
      passkeys: true,
      source: "bootstrap",
      status: "known",
    },
    request: async <T>(input: {
      endpoint?: string;
    }): Promise<AthenaAuthResult<T>> => {
      if (input.endpoint === "/passkey/verify-authentication") {
        return {
          data: {
            session: { id: "sess-1", token: "tok", userId: "user-1" },
            user: { email: "ada@example.com", id: "user-1" },
          },
          error: null,
          ok: true,
          raw: {},
          status: 200,
        } as AthenaAuthResult<T>;
      }
      return {
        data: null,
        error: "fail",
        ok: false,
        raw: {},
        status: 400,
      } as AthenaAuthResult<T>;
    },
    sessionController: {
      accept: (session) => {
        accepted.push(session);
      },
    },
  });

  const ok = await module.verifyAuthentication({
    response: "{}",
  });
  assert.equal(ok.ok, true);
  assert.equal(accepted.length, 1);
  assert.equal((accepted[0] as { user?: { id?: string } }).user?.id, "user-1");

  const failModule = createPasskeyModule({
    capabilities: {
      passkeys: true,
      source: "bootstrap",
      status: "known",
    },
    request: async <T>(): Promise<AthenaAuthResult<T>> =>
      ({
        data: null,
        error: "bad",
        ok: false,
        raw: {},
        status: 400,
      }) as AthenaAuthResult<T>,
    sessionController: {
      accept: (session) => {
        accepted.push(session);
      },
    },
  });
  const failed = await failModule.verifyAuthentication({
    response: "{}",
  });
  assert.equal(failed.ok, false);
  assert.equal(accepted.length, 1);
});
