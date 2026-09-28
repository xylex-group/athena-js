/**
 * Wave 1 TARGET — Athena native passkey finality (slices 01–02).
 * Encodes DESIRED coupling: passkey.update / passkey.delete implemented
 * and routed through executeAuthMutation like passkey.register.
 *
 * MUST be RED on CURRENT pin acb0f21c (found case: reserved + ctx.stores
 * mutate, routes already exist). GREEN after slices 01–02.
 *
 * Spec: docs/sdd/xylex/athena-native-passkey-finality/SPEC.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-native-passkey-lifecycle.target.test.ts
 *
 * Baseline characterization retired to
 * test/sdd/superseded/athena-native-passkey-lifecycle.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import {
  ATHENA_AUTH_DEFAULT_ARGON2,
  ATHENA_AUTH_SCHEMA_GENERATION,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_EVENT_DEFINITIONS } from "../../src/auth/domain/catalog.ts";
import {
  ATHENA_AUTH_DOMAIN_EVENTS,
  ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
} from "../../src/auth/hooks/events.ts";
import type { AuthDomainMutate } from "../../src/auth/hooks/execute.ts";
import { executeAuthMutation } from "../../src/auth/hooks/execute.ts";
import type { AthenaAuthHooks } from "../../src/auth/hooks/types.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import type { AuthPasskeyRow } from "../../src/auth/local/models.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import {
  handleDeletePasskeyRoute,
  handleUpdatePasskeyRoute,
  type ManagePasskeysContext,
} from "../../src/auth/local/passkey/manage-passkeys.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createMemoryAuthAuditWriter } from "../../src/auth/observability/audit.ts";
import type { AthenaAuthAuditEntry } from "../../src/auth/observability/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

const SNAPSHOT_RP_ID = "app.example.com";
const SNAPSHOT_RP_NAME = "Example App";
const SNAPSHOT_ORIGIN = "http://app.local";
const REGISTER_OPTIONS_PATH = "/passkey/generate-register-options";
const VERIFY_REGISTRATION_PATH = "/passkey/verify-registration";
const UPDATE_PATH = "/passkey/update-passkey";
const DELETE_PATH = "/passkey/delete-passkey";
const LIST_PATH = "/passkey/list-user-passkeys";

const SECRET_FIELD_RE =
  /publicKey|public_key|credentialID|credentialId|credential_id|authenticatorData|authenticator_data|attestationObject|attestation_object|clientDataJSON|clientData|challengeHash|challenge_hash|"challenge"/i;

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

function passkeyConfig() {
  return normalizeAthenaAuthConfig({
    mode: "local",
    passkey: {
      origins: [SNAPSHOT_ORIGIN],
      rpId: SNAPSHOT_RP_ID,
      rpName: SNAPSHOT_RP_NAME,
    },
  });
}

function createRuntime(hooks?: AthenaAuthHooks) {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: passkeyConfig(),
    hasher: createTestHasher(),
    hooks,
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

function seedPasskeyRow(
  stores: MemoryAuthStores,
  input: { id: string; name: string; userId: string }
): AuthPasskeyRow {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const row: AuthPasskeyRow = {
    aaguid: null,
    backed_up: false,
    counter: 0n,
    created_at: now,
    credential_id: "dGVzdC1jcmVkZW50aWFsLWlk",
    device_type: "singleDevice",
    id: input.id,
    name: input.name,
    public_key: "dGVzdC1wdWJsaWMta2V5LXZhbHVl",
    resident_key: null,
    transports: "usb",
    updated_at: now,
    user_id: input.userId,
  };
  stores.passkeys.set(row.id, row);
  return row;
}

function assertNoSecrets(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  assert.equal(
    SECRET_FIELD_RE.test(serialized),
    false,
    `${label} must not contain passkey secrets/raw ceremony fields: ${serialized}`
  );
}

function asIdentifyingPasskey(value: unknown): {
  id: string;
  name: string | null;
  userId: string;
} {
  assert.equal(value && typeof value === "object", true);
  const record = value as Record<string, unknown>;
  assert.equal(typeof record.id, "string");
  assert.ok(record.name === null || typeof record.name === "string");
  assert.equal(typeof record.userId, "string");
  return {
    id: record.id as string,
    name: (record.name ?? null) as string | null,
    userId: record.userId as string,
  };
}

type HookCapture = {
  after: Array<Record<string, unknown>>;
  before: Array<Record<string, unknown>>;
};

function capturePasskeyHooks(): {
  capture: HookCapture;
  hooks: AthenaAuthHooks;
} {
  const capture: HookCapture = { after: [], before: [] };
  const hooks = {
    after: {
      "passkey.delete": (payload: Record<string, unknown>) => {
        capture.after.push({ ...payload });
      },
      "passkey.register": (payload: Record<string, unknown>) => {
        capture.after.push({ ...payload });
      },
      "passkey.update": (payload: Record<string, unknown>) => {
        capture.after.push({ ...payload });
      },
    },
    before: {
      "passkey.delete": (payload: Record<string, unknown>) => {
        capture.before.push({ ...payload });
      },
      "passkey.register": (payload: Record<string, unknown>) => {
        capture.before.push({ ...payload });
      },
      "passkey.update": (payload: Record<string, unknown>) => {
        capture.before.push({ ...payload });
      },
    },
  } as unknown as AthenaAuthHooks;
  return { capture, hooks };
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

async function buildRegistrationCredential(input: {
  challenge: string;
  credentialId: Uint8Array;
  publicKey: CryptoKey;
}): Promise<Record<string, unknown>> {
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

async function seedOwnerSession(stores: MemoryAuthStores): Promise<{
  row: AuthPasskeyRow;
  session: Awaited<ReturnType<MemoryAuthStores["createSession"]>>;
  user: Awaited<ReturnType<MemoryAuthStores["createUser"]>>;
}> {
  const user = await stores.createUser({
    email: "ada-pkm@example.com",
    id: "user_ada",
    name: "Ada",
  });
  const session = await stores.createSession({
    expiresAt: new Date(Date.now() + 60_000),
    id: "sess_ada",
    token: "tok_ada",
    userId: user.id,
  });
  await stores.createAccount({
    accountId: user.id,
    id: "acc_ada",
    providerId: "credential",
    userId: user.id,
  });
  const row = seedPasskeyRow(stores, {
    id: "pk_ada",
    name: "laptop",
    userId: user.id,
  });
  return { row, session, user };
}

function manageContext(
  stores: MemoryAuthStores,
  user: Awaited<ReturnType<MemoryAuthStores["createUser"]>>,
  session: Awaited<ReturnType<MemoryAuthStores["createSession"]>>,
  wired: Pick<ManagePasskeysContext, "hookRequest" | "mutate" | "traceId">
): ManagePasskeysContext {
  return {
    config: passkeyConfig(),
    headers: new Headers(),
    requireSession: async () => ({ session, token: session.token, user }),
    stores,
    ...wired,
  };
}

test("T-NPK-CATALOG: passkey.update and passkey.delete are implemented with audit", () => {
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["passkey.update"].status,
    "implemented",
    "found case: passkey.update is reserved while HTTP update already mutates"
  );
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["passkey.delete"].status,
    "implemented",
    "found case: passkey.delete is reserved while HTTP delete already mutates"
  );
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("passkey.update"),
    true
  );
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("passkey.delete"),
    true
  );
  assert.equal(ATHENA_AUTH_EVENT_DEFINITIONS["passkey.update"].audit, true);
  assert.equal(
    ATHENA_AUTH_EVENT_DEFINITIONS["passkey.update"].subjectType,
    "passkey"
  );
  assert.equal(ATHENA_AUTH_EVENT_DEFINITIONS["passkey.delete"].audit, true);
  assert.equal(
    ATHENA_AUTH_EVENT_DEFINITIONS["passkey.delete"].subjectType,
    "passkey"
  );
});

test("T-NPK-PAYLOADS: typed update/delete payloads and AthenaAuthHookPasskey", () => {
  const types = readPkg("src/auth/hooks/types.ts");
  assert.match(
    types,
    /"passkey.update":\s*\{[\s\S]*input:\s*\{\s*id:\s*string;\s*name:\s*string/,
    "found case: AthenaAuthHookEventPayloads has passkey.register only"
  );
  assert.match(
    types,
    /"passkey.delete":\s*\{[\s\S]*input:\s*\{\s*id:\s*string/
  );
  assert.match(
    types,
    /"passkey.update":[\s\S]*previous:\s*\{\s*passkey:\s*AthenaAuthHookPasskey/
  );
  assert.match(
    types,
    /"passkey.delete":[\s\S]*result:\s*\{[\s\S]*id:\s*string;[\s\S]*userId:\s*string/
  );
  assert.match(types, /import type \{[\s\S]*AthenaAuthHookPasskey/);
  const sanitize = readPkg("src/auth/hooks/sanitize.ts");
  assert.match(
    sanitize,
    /export type AthenaAuthHookPasskey/,
    "found case: sanitizeHookPasskey exists but AthenaAuthHookPasskey is not exported"
  );
});

test("T-NPK-SCOPE-STORES: manage-passkeys execute uses scope.stores via mutate", () => {
  const source = readPkg("src/auth/local/passkey/manage-passkeys.ts");
  assert.match(
    source,
    /event:\s*"passkey.update"/,
    "found case: handleUpdatePasskeyRoute calls createPasskeyRepository(ctx.stores)"
  );
  assert.match(source, /event:\s*"passkey.delete"/);
  assert.match(source, /createPasskeyRepository\(scope\.stores\)/);
  assert.equal(
    source.includes("createPasskeyRepository(ctx.stores).updateName"),
    false
  );
  assert.equal(
    source.includes("createPasskeyRepository(ctx.stores).delete"),
    false
  );
  assert.match(source, /mutate:\s*AuthDomainMutate/);
  assert.match(source, /hookRequest:/);
  assert.match(source, /traceId:/);
  const router = readPkg("src/auth/local/router.ts");
  const updateStart = router.indexOf(
    "const updatePasskey = await handleUpdatePasskeyRoute"
  );
  const deleteStart = router.indexOf(
    "const deletePasskey = await handleDeletePasskeyRoute"
  );
  const mailStart = router.indexOf(
    "const userMail = await handleUserMailRoutes"
  );
  const deleteDispatch = router.slice(deleteStart, updateStart);
  const updateDispatch = router.slice(updateStart, mailStart);
  assert.match(deleteDispatch, /mutate,/);
  assert.match(deleteDispatch, /hookRequest,/);
  assert.match(deleteDispatch, /traceId,/);
  assert.match(updateDispatch, /mutate,/);
  assert.match(updateDispatch, /hookRequest,/);
  assert.match(updateDispatch, /traceId,/);
});

test("T-NPK-COMPANION: implemented-event scan includes manage-passkeys.ts", () => {
  const source = readPkg("test/auth-domain-hooks.test.ts");
  assert.match(
    source,
    /"local\/passkey\/manage-passkeys\.ts"/,
    "found case: companion scan lists verify-registration only"
  );
});

test("T-NPK-NO-CLIENT: createClient remains the only composition root", () => {
  const blob = `${readPkg("src/index.ts")}\n${readPkg("src/auth/client.ts")}\n${readPkg("src/v3-client.ts")}`;
  assert.equal(blob.includes("createPasskeyClient"), false);
  assert.equal(blob.includes("createWebAuthnClient"), false);
  assert.match(readPkg("src/v3-client.ts"), /export function createClient/);
});

test("T-NPK-SCHEMA-24: Wave 1 adds no embedded-auth ledger generation", () => {
  assert.ok(ATHENA_AUTH_SCHEMA_GENERATION >= 24);
});

test("P?: passkey.register → hook + audit + trace", async () => {
  const { capture, hooks } = capturePasskeyHooks();
  const runtime = createRuntime(hooks);
  const { cookie, userId } = await signUp(
    runtime,
    "ada-register-nucleus@example.com"
  );
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
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
    credentialId: crypto.getRandomValues(new Uint8Array(16)),
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
  const registerHooks = capture.after.filter(
    (row) => row.event === "passkey.register"
  );
  assert.equal(registerHooks.length, 1);
  const after = registerHooks[0] as {
    eventId?: string;
    result?: { passkey?: unknown };
    traceId?: string;
  };
  const passkey = asIdentifyingPasskey(after.result?.passkey);
  assert.equal(passkey.userId, userId);
  assert.equal(typeof after.eventId, "string");
  assert.equal(after.traceId, verify.headers.get("x-athena-trace-id"));
  assertNoSecrets(after, "passkey.register hook envelope");
  assert.match(
    readPkg("src/auth/local/passkey/verify-registration.ts"),
    /event:\s*"passkey.register"/
  );
  assert.equal(ATHENA_AUTH_EVENT_DEFINITIONS["passkey.register"].audit, true);
});

test("P?: passkey.update → hook + audit + trace", async () => {
  const { capture, hooks } = capturePasskeyHooks();
  const runtime = createRuntime(hooks);
  const ada = await signUp(runtime, "ada-update-nucleus@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_update",
    name: "laptop",
    userId: ada.userId,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await json(response);
  const httpPasskey = body.passkey as { id?: string; name?: string };
  assert.equal(httpPasskey.id, row.id);
  assert.equal(httpPasskey.name, "office key");
  const before = capture.before.find((row) => row.event === "passkey.update");
  const after = capture.after.find((row) => row.event === "passkey.update");
  assert.ok(
    before,
    "found case: update bypasses executeAuthMutation (no hooks)"
  );
  assert.ok(
    after,
    "found case: update bypasses executeAuthMutation (no hooks)"
  );
  const previous = asIdentifyingPasskey(
    (before.previous as { passkey?: unknown })?.passkey
  );
  const result = asIdentifyingPasskey(
    (after.result as { passkey?: unknown })?.passkey
  );
  assert.equal(previous.id, row.id);
  assert.equal(previous.name, "laptop");
  assert.equal(previous.userId, ada.userId);
  assert.equal(result.name, "office key");
  assert.equal(typeof after.eventId, "string");
  assert.equal(after.traceId, response.headers.get("x-athena-trace-id"));
  assert.equal(before.eventId, after.eventId);
  assertNoSecrets(before, "passkey.update before");
  assertNoSecrets(after, "passkey.update after");
});

test("P?: passkey.delete → hook + audit + trace", async () => {
  const { capture, hooks } = capturePasskeyHooks();
  const runtime = createRuntime(hooks);
  const ada = await signUp(runtime, "ada-delete-nucleus@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_delete",
    name: "laptop",
    userId: ada.userId,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: row.id }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await json(response), { status: true });
  const before = capture.before.find((row) => row.event === "passkey.delete");
  const after = capture.after.find((row) => row.event === "passkey.delete");
  assert.ok(
    before,
    "found case: delete bypasses executeAuthMutation (no hooks)"
  );
  assert.ok(
    after,
    "found case: delete bypasses executeAuthMutation (no hooks)"
  );
  const previous = asIdentifyingPasskey(
    (before.previous as { passkey?: unknown })?.passkey
  );
  assert.equal(previous.id, row.id);
  assert.equal(previous.name, "laptop");
  assert.equal(previous.userId, ada.userId);
  const result = after.result as { id?: string; userId?: string };
  assert.equal(result.id, row.id);
  assert.equal(result.userId, ada.userId);
  assert.equal(typeof after.eventId, "string");
  assert.equal(after.traceId, response.headers.get("x-athena-trace-id"));
  assertNoSecrets(before, "passkey.delete before");
  assertNoSecrets(after, "passkey.delete after");
  assert.equal(stores.passkeys.has(row.id), false);
});

test("P?: before hook throws → passkey unchanged, no audit row", async () => {
  const runtime = createRuntime({
    before: {
      "passkey.update": () => {
        throw new Error("veto rename");
      },
    },
  } as unknown as AthenaAuthHooks);
  const ada = await signUp(runtime, "ada-before-veto@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_veto",
    name: "laptop",
    userId: ada.userId,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, "ATHENA_AUTH_HOOK_REJECTED");
  assert.equal(stores.passkeys.get(row.id)?.name, "laptop");
});

test("P?: database mutation fails → no audit row", async () => {
  const { capture, hooks } = capturePasskeyHooks();
  const runtime = createRuntime(hooks);
  const ada = await signUp(runtime, "ada-mutate-fail@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_mutate_fail",
    name: "laptop",
    userId: ada.userId,
  });
  Object.freeze(stores.passkeys.get(row.id));
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.notEqual(response.status, 200);
  const before = capture.before.find((row) => row.event === "passkey.update");
  assert.ok(
    before,
    "found case: mutation is outside executeAuthMutation so before never runs"
  );
  assert.equal(
    capture.after.some((row) => row.event === "passkey.update"),
    false
  );
  assert.equal(stores.passkeys.get(row.id)?.name, "laptop");
});

test("P?: audit insertion fails → passkey mutation rolls back", async () => {
  const stores = new MemoryAuthStores();
  const { row, session, user } = await seedOwnerSession(stores);
  const sink: { entries: AthenaAuthAuditEntry[] } = { entries: [] };
  const transaction = createMemoryAuthMutationTransaction(
    stores,
    undefined,
    sink
  );
  const mutateCalls: Array<{ event?: string }> = [];
  const mutate = (async (input: Parameters<AuthDomainMutate>[0]) => {
    mutateCalls.push({ event: input.event });
    return executeAuthMutation({
      ...input,
      auditWriter: {
        async write(scope, entry) {
          await createMemoryAuthAuditWriter(sink).write(scope, entry);
          throw new Error("audit boom");
        },
      },
      transaction,
    });
  }) as AuthDomainMutate;
  const ctx = manageContext(stores, user, session, {
    hookRequest: () => ({ method: "POST", path: UPDATE_PATH }),
    mutate,
    traceId: "tr_audit_fail",
  });
  const outcome = await handleUpdatePasskeyRoute(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    UPDATE_PATH,
    "POST",
    ctx
  ).then(
    (response) => ({ response, thrown: undefined as unknown }),
    (thrown: unknown) => ({ response: undefined, thrown })
  );
  assert.equal(
    mutateCalls.some((call) => call.event === "passkey.update"),
    true,
    "found case: handleUpdatePasskeyRoute never calls mutate"
  );
  assert.equal(
    outcome.response?.status === 200,
    false,
    "audit insert failure must not commit HTTP success"
  );
  assert.equal(stores.passkeys.get(row.id)?.name, "laptop");
  assert.equal(sink.entries.length, 0);
});

test("P?: after hook throws → committed mutation remains committed", async () => {
  let afterRan = false;
  const runtime = createRuntime({
    after: {
      "passkey.update": () => {
        afterRan = true;
        throw new Error("after boom");
      },
    },
  } as unknown as AthenaAuthHooks);
  const ada = await signUp(runtime, "ada-after-throw@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_after",
    name: "laptop",
    userId: ada.userId,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  assert.equal(afterRan, true, "found case: after hook never runs");
  assert.equal(stores.passkeys.get(row.id)?.name, "office key");
  const listed = await runtime.handle(
    new Request(`http://app.local/api/auth${LIST_PATH}`, {
      headers: { cookie: ada.cookie },
    })
  );
  assert.equal(listed.status, 200);
  const rows = (await listed.json()) as { id: string; name?: string }[];
  assert.equal(rows[0]?.name, "office key");
});

test("T-NPK-HTTP: non-owner update/delete remain 404 before mutate", async () => {
  const { capture, hooks } = capturePasskeyHooks();
  const runtime = createRuntime(hooks);
  const ada = await signUp(runtime, "ada-owner@example.com");
  const bob = await signUp(runtime, "bob-thief@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const row = seedPasskeyRow(stores, {
    id: "pk_owned",
    name: "laptop",
    userId: ada.userId,
  });
  const stolenUpdate = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "stolen" }),
      headers: {
        "content-type": "application/json",
        cookie: bob.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(stolenUpdate.status, 404);
  assert.equal((await json(stolenUpdate)).message, "Passkey not found");
  const stolenDelete = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: row.id }),
      headers: {
        "content-type": "application/json",
        cookie: bob.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(stolenDelete.status, 404);
  assert.equal(stores.passkeys.get(row.id)?.name, "laptop");
  assert.equal(
    capture.before.some(
      (row) => row.event === "passkey.update" || row.event === "passkey.delete"
    ),
    false
  );
  const ownerUpdate = await runtime.handle(
    new Request(`http://app.local/api/auth${UPDATE_PATH}`, {
      body: JSON.stringify({ id: row.id, name: "office key" }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(ownerUpdate.status, 200);
  assert.ok(
    capture.after.some((row) => row.event === "passkey.update"),
    "owner update must enter the domain nucleus after 404 short-circuit"
  );
});

test("T-NPK-AUDIT-SHAPE: handler mutate writes sanitized identifying audit", async () => {
  const stores = new MemoryAuthStores();
  const { row, session, user } = await seedOwnerSession(stores);
  const sink: { entries: AthenaAuthAuditEntry[] } = { entries: [] };
  const transaction = createMemoryAuthMutationTransaction(
    stores,
    undefined,
    sink
  );
  const mutateCalls: Array<{ event?: string }> = [];
  const mutate = (async (input: Parameters<AuthDomainMutate>[0]) => {
    mutateCalls.push({ event: input.event });
    return executeAuthMutation({
      ...input,
      auditWriter: createMemoryAuthAuditWriter(sink),
      transaction,
    });
  }) as AuthDomainMutate;
  const ctx = manageContext(stores, user, session, {
    hookRequest: () => ({ method: "POST", path: DELETE_PATH }),
    mutate,
    traceId: "tr_delete_audit",
  });
  const response = await handleDeletePasskeyRoute(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: row.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    DELETE_PATH,
    "POST",
    ctx
  );
  assert.equal(response?.status, 200);
  assert.equal(
    mutateCalls.some((call) => call.event === "passkey.delete"),
    true,
    "found case: handleDeletePasskeyRoute never calls mutate"
  );
  assert.equal(sink.entries.length, 1);
  assert.equal(sink.entries[0]?.event, "passkey.delete");
  assert.equal(sink.entries[0]?.subject?.type, "passkey");
  assert.equal(sink.entries[0]?.subject?.id, row.id);
  assert.equal(sink.entries[0]?.traceId, "tr_delete_audit");
  const previous = asIdentifyingPasskey(
    (sink.entries[0]?.previous as { passkey?: unknown })?.passkey
  );
  assert.equal(previous.id, row.id);
  assert.equal(previous.name, "laptop");
  assert.equal(previous.userId, user.id);
  assertNoSecrets(sink.entries[0]?.previous, "delete audit previous");
  assertNoSecrets(sink.entries[0]?.result, "delete audit result");
});

test("T-PK-LM-001: last passkey without another method is 409", async () => {
  const runtime = createRuntime();
  const ada = await signUp(runtime, "ada-last-method@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  for (const [id, account] of [...stores.accounts.entries()]) {
    if (account.user_id === ada.userId) {
      stores.accounts.delete(id);
    }
  }
  const row = seedPasskeyRow(stores, {
    id: "pk_last",
    name: "only key",
    userId: ada.userId,
  });
  const response = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: row.id }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 409);
  assert.equal(
    (await json(response)).code,
    "ATHENA_AUTH_LAST_AUTHENTICATION_METHOD"
  );
  assert.equal(stores.passkeys.has(row.id), true);
});

test("T-PK-LM-002: leftover passkey or credential still deletes", async () => {
  const runtime = createRuntime();
  const ada = await signUp(runtime, "ada-keep-method@example.com");
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  const first = seedPasskeyRow(stores, {
    id: "pk_keep_a",
    name: "first",
    userId: ada.userId,
  });
  seedPasskeyRow(stores, {
    id: "pk_keep_b",
    name: "second",
    userId: ada.userId,
  });
  const withSibling = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: first.id }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(withSibling.status, 200);
  assert.equal(stores.passkeys.has(first.id), false);

  const leftover = seedPasskeyRow(stores, {
    id: "pk_keep_c",
    name: "with password",
    userId: ada.userId,
  });
  const withPassword = await runtime.handle(
    new Request(`http://app.local/api/auth${DELETE_PATH}`, {
      body: JSON.stringify({ id: leftover.id }),
      headers: {
        "content-type": "application/json",
        cookie: ada.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(withPassword.status, 200);
  assert.equal(stores.passkeys.has(leftover.id), false);
});
