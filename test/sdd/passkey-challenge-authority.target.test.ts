/**
 * Slice 4 / spec 02 Track B TARGET — durable challenge authority (source of truth).
 * GREEN after adapter + atomic identifier+value consume + `passkey:%` expire.
 *
 * Baseline characterization retired (deleted): B-CHAL-NO-ADAPTER and the
 * identifier+value-absent cell of B-CHAL-NO-ID-VALUE inverted. Historical IDs
 * live in test/sdd/superseded/passkey-challenge-authority.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/02-embedded-challenge-authority.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-challenge-authority.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { createAuthModule } from "../../src/auth/client.ts";
import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import type { AuthVerificationRow } from "../../src/auth/local/models.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import { CANONICAL_PASSKEY_METHODS } from "../../src/auth/passkey/contract.ts";
import type { PasskeyChallengeStore } from "../../src/auth/passkey/server/challenge-store.ts";
import type { AthenaPasskeyChallenge } from "../../src/auth/passkey/server/types.ts";
import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const localPasskeyDir = join(srcRoot, "auth", "local", "passkey");
const challengeStorePath = join(localPasskeyDir, "challenge-store.ts");
const indexPath = join(localPasskeyDir, "index.ts");

const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_passkey_challenge_authority_target";

/** Track A P6 inventory amend: POST verify-registration is no longer a stay-true gap. */
const SIX_REMAINING_PASSKEY_ROUTES = [
  "GET /passkey/list-user-passkeys",
  "POST /passkey/delete-passkey",
  "POST /passkey/generate-authenticate-options",
  "POST /passkey/update-passkey",
  "POST /passkey/verify-authentication",
] as const;

const ATOMIC_CONSUME_SQL =
  /DELETE FROM[\s\S]*verifications[\s\S]*WHERE identifier = \$1[\s\S]*AND value = \$2[\s\S]*AND expires_at > NOW\(\)[\s\S]*RETURNING \*/;
const EXPIRE_SQL =
  /DELETE FROM[\s\S]*verifications[\s\S]*WHERE identifier LIKE ['"]passkey:%['"][\s\S]*AND expires_at <= /;
const ID_VALUE_METHOD =
  /consumeVerificationByIdentifier|consumeByIdentifierAndValue/;

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

function extractAsyncMethod(src: string, name: string): string {
  const re = new RegExp(`async ${name}\\s*\\(`);
  const start = src.search(re);
  assert.ok(start >= 0, `missing async method ${name}`);
  const paramOpen = src.indexOf("(", start);
  let depth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        paramClose = i;
        break;
      }
    }
  }
  assert.ok(paramClose >= 0, `unclosed params for ${name}`);
  const openAt = src.indexOf("{", paramClose);
  assert.ok(openAt >= 0, `missing body for ${name}`);
  return extractBalanced(src, start, openAt);
}

function extractVerificationsDdl(schemaSrc: string): string {
  const start = schemaSrc.indexOf(
    "CREATE TABLE IF NOT EXISTS athena.verifications"
  );
  assert.ok(start >= 0, "schema v1 must declare athena.verifications");
  const openAt = schemaSrc.indexOf("(", start);
  return extractBalanced(schemaSrc, start, openAt);
}

function inventoryKnownMissing(): string {
  const src = readPkg("test/auth-route-inventory.test.ts");
  const match = src.match(
    /const KNOWN_MISSING_IN_LOCAL = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, "KNOWN_MISSING_IN_LOCAL set must exist");
  return match[1] ?? "";
}

function readIfPresent(abs: string): string {
  assert.equal(
    existsSync(abs),
    true,
    `found case: ${abs} is absent (no local PasskeyChallengeStore adapter)`
  );
  return readFileSync(abs, "utf8");
}

function requireAdapterSources(): { indexSrc: string; storeSrc: string } {
  return {
    indexSrc: readIfPresent(indexPath),
    storeSrc: readIfPresent(challengeStorePath),
  };
}

function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return crypto.subtle
    .digest("SHA-256", data)
    .then((buf) => new Uint8Array(buf));
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return Buffer.from(bin, "binary")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function rpIdHashToken(rpId: string): Promise<string> {
  return base64url(await sha256Bytes(new TextEncoder().encode(rpId)));
}

function digest32(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

async function assertConsumeMiss(
  action: () => Promise<AthenaPasskeyChallenge | null | undefined>,
  message: string
): Promise<void> {
  try {
    const result = await action();
    assert.equal(
      result == null,
      true,
      `${message} (consume must miss, not return a row)`
    );
  } catch (error) {
    assert.ok(error instanceof Error, message);
  }
}

function isConsumeWinner(
  result: PromiseSettledResult<AthenaPasskeyChallenge | null | undefined>
): boolean {
  return result.status === "fulfilled" && result.value != null;
}

function asStore(value: unknown): PasskeyChallengeStore {
  const store = value as PasskeyChallengeStore;
  assert.equal(typeof store.create, "function");
  assert.equal(typeof store.consume, "function");
  assert.equal(typeof store.expire, "function");
  return store;
}

async function constructFromExport(
  factory: unknown,
  arg: unknown
): Promise<PasskeyChallengeStore | null> {
  if (typeof factory !== "function") {
    return null;
  }
  try {
    const maybe = (factory as (input: unknown) => unknown)(arg);
    const resolved =
      typeof (maybe as Promise<unknown>)?.then === "function"
        ? await (maybe as Promise<unknown>)
        : maybe;
    if (
      resolved &&
      typeof (resolved as { create?: unknown }).create === "function"
    ) {
      return asStore(resolved);
    }
  } catch {
    /* try construct */
  }
  try {
    return asStore(
      new (factory as new (input: unknown) => PasskeyChallengeStore)(arg)
    );
  } catch {
    return null;
  }
}

async function loadLocalPasskeyModule(): Promise<Record<string, unknown>> {
  requireAdapterSources();
  return (await import(pathToFileURL(indexPath).href)) as Record<
    string,
    unknown
  >;
}

async function instantiateMemoryStore(): Promise<{
  store: PasskeyChallengeStore;
  stores: MemoryAuthStores;
}> {
  const mod = await loadLocalPasskeyModule();
  const stores = new MemoryAuthStores();
  const candidates = [
    mod.createMemoryPasskeyChallengeStore,
    mod.createPasskeyChallengeStore,
    mod.MemoryPasskeyChallengeStore,
  ];
  for (const candidate of candidates) {
    const store = await constructFromExport(candidate, stores);
    if (store) {
      return { store, stores };
    }
  }
  assert.fail(
    "local/passkey must export a Memory PasskeyChallengeStore factory or class"
  );
}

class YieldingVerificationDb implements AthenaAuthDatabase {
  readonly inTransaction = false;
  readonly rows: AuthVerificationRow[] = [];

  async query<T = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rowCount: number; rows: T[] }> {
    await Promise.resolve();
    const result = this.execute(text, values);
    return result as { rowCount: number; rows: T[] };
  }

  async transaction<T>(fn: (db: AthenaAuthDatabase) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private execute(
    text: string,
    values: unknown[]
  ): { rowCount: number; rows: AuthVerificationRow[] } {
    const sql = text.replace(/\s+/g, " ").trim();
    const now = Date.now();
    if (/INSERT INTO\s+athena\.verifications/i.test(sql)) {
      const id = String(values[0]);
      const identifier = String(values[1]);
      const value = String(values[2]);
      const expiresAt = new Date(values[3] as string | Date);
      const stamp = new Date();
      const row: AuthVerificationRow = {
        created_at: stamp,
        expires_at: expiresAt,
        id,
        identifier,
        updated_at: stamp,
        value,
      };
      this.rows.push(row);
      return { rowCount: 1, rows: [{ ...row }] };
    }
    if (
      /DELETE FROM\s+athena\.verifications/i.test(sql) &&
      /identifier\s*=\s*\$1/i.test(sql) &&
      /value\s*=\s*\$2/i.test(sql)
    ) {
      const identifier = String(values[0]);
      const value = String(values[1]);
      const idx = this.rows.findIndex(
        (row) =>
          row.identifier === identifier &&
          row.value === value &&
          new Date(row.expires_at).getTime() > now
      );
      if (idx < 0) {
        return { rowCount: 0, rows: [] };
      }
      const [row] = this.rows.splice(idx, 1);
      assert.ok(row);
      return { rowCount: 1, rows: [row] };
    }
    if (
      /DELETE FROM\s+athena\.verifications/i.test(sql) &&
      /identifier LIKE ['"]passkey:%['"]/i.test(sql)
    ) {
      const cutoff = values[0]
        ? new Date(values[0] as string | Date).getTime()
        : now;
      const kept: AuthVerificationRow[] = [];
      const deleted: AuthVerificationRow[] = [];
      for (const row of this.rows) {
        const expired = new Date(row.expires_at).getTime() <= cutoff;
        if (String(row.identifier).startsWith("passkey:") && expired) {
          deleted.push(row);
        } else {
          kept.push(row);
        }
      }
      this.rows.length = 0;
      this.rows.push(...kept);
      return { rowCount: deleted.length, rows: deleted };
    }
    if (
      /DELETE FROM\s+athena\.verifications/i.test(sql) &&
      /value\s*=\s*\$1/i.test(sql)
    ) {
      const value = String(values[0]);
      const idx = this.rows.findIndex(
        (row) => row.value === value && new Date(row.expires_at).getTime() > now
      );
      if (idx < 0) {
        return { rowCount: 0, rows: [] };
      }
      const [row] = this.rows.splice(idx, 1);
      assert.ok(row);
      return { rowCount: 1, rows: [row] };
    }
    if (/SELECT \* FROM\s+athena\.verifications/i.test(sql)) {
      const matched = this.rows.filter((row) => {
        if (/value\s*=\s*\$1/i.test(sql) && row.value !== String(values[0])) {
          return false;
        }
        if (
          /identifier\s*=\s*\$1/i.test(sql) &&
          row.identifier !== String(values[0])
        ) {
          return false;
        }
        if (/expires_at > NOW\(\)/i.test(sql)) {
          return new Date(row.expires_at).getTime() > now;
        }
        return true;
      });
      return {
        rowCount: matched.length,
        rows: matched.map((row) => ({ ...row })),
      };
    }
    throw new Error(`yielding verification db does not execute: ${sql}`);
  }
}

async function instantiatePostgresStore(): Promise<{
  db: YieldingVerificationDb;
  store: PasskeyChallengeStore;
  stores: PostgresAuthStores;
}> {
  const mod = await loadLocalPasskeyModule();
  const db = new YieldingVerificationDb();
  const stores = new PostgresAuthStores(db);
  const candidates = [
    mod.createPostgresPasskeyChallengeStore,
    mod.PostgresPasskeyChallengeStore,
    mod.createPasskeyChallengeStore,
  ];
  for (const candidate of candidates) {
    const store =
      (await constructFromExport(candidate, stores)) ??
      (await constructFromExport(candidate, db));
    if (store) {
      return { db, store, stores };
    }
  }
  assert.fail(
    "local/passkey must export a Postgres PasskeyChallengeStore factory or class"
  );
}

test("T-CHAL-ADAPTER: src/auth/local/passkey/{challenge-store.ts,index.ts} exist and implement PasskeyChallengeStore", () => {
  const { storeSrc, indexSrc } = requireAdapterSources();
  assert.match(storeSrc, /PasskeyChallengeStore/);
  assert.match(storeSrc, /\bcreate\s*\(/);
  assert.match(storeSrc, /\bconsume\s*\(/);
  assert.match(storeSrc, /\bexpire\s*\(/);
  assert.match(indexSrc, /challenge-store/);
  assert.equal(
    /\bconsumed_at\b/.test(storeSrc),
    false,
    "adapter must not add a consumed_at SQL column"
  );
});

test("T-CHAL-ATOMIC-SQL: consume is one DELETE … WHERE identifier = $1 AND value = $2 AND expires_at > NOW() RETURNING *", () => {
  const postgres = readPkg("src/auth/local/stores.ts");
  const memory = readPkg("src/auth/local/memory-stores.ts");
  assert.match(
    postgres,
    ID_VALUE_METHOD,
    "found case: PostgresAuthStores has no identifier+value consume (generic path is value-only)"
  );
  assert.match(
    memory,
    ID_VALUE_METHOD,
    "found case: MemoryAuthStores has no identifier+value consume"
  );
  assert.match(
    postgres,
    ATOMIC_CONSUME_SQL,
    "Postgres identifier+value consume must be one DELETE … identifier=$1 AND value=$2 AND expires_at>NOW() RETURNING *"
  );

  const pgGeneric = extractAsyncMethod(postgres, "consumeVerification");
  assert.match(pgGeneric, /WHERE value = \$1 AND expires_at > NOW\(\)/);
  assert.equal(
    /identifier\s*=\s*\$1/.test(pgGeneric),
    false,
    "generic consumeVerification must remain value-only for email/reset/TOTP"
  );

  const { storeSrc } = requireAdapterSources();
  const adapterAndStores = `${storeSrc}\n${postgres}`;
  assert.match(adapterAndStores, ATOMIC_CONSUME_SQL);
  assert.equal(
    /getVerificationByValue/.test(storeSrc),
    false,
    "passkey consume must not SELECT-then-DELETE via getVerificationByValue"
  );
  assert.equal(
    /\.consumeVerification\s*\(/.test(storeSrc),
    false,
    "passkey consume must not call generic value-only consumeVerification"
  );
  assert.equal(
    /UPDATE[\s\S]*consumed_at/.test(adapterAndStores),
    false,
    "passkey consume must not UPDATE consumed_at"
  );
});

test("T-CHAL-EXPIRE: expire() deletes only identifier LIKE 'passkey:%' AND expires_at <= now", () => {
  const postgres = readPkg("src/auth/local/stores.ts");
  const adapterSrc = existsSync(challengeStorePath)
    ? readFileSync(challengeStorePath, "utf8")
    : "";
  assert.match(
    `${adapterSrc}\n${postgres}`,
    EXPIRE_SQL,
    "found case: no expire scoped to identifier LIKE 'passkey:%' AND expires_at <= now"
  );
  requireAdapterSources();
});

test("T-CHAL-EMPTY-HASH: create rejects empty / non-32-byte hashes", async () => {
  const { store } = await instantiateMemoryStore();
  const expiresAt = new Date(Date.now() + 60_000);
  await assert.rejects(() =>
    store.create({
      challengeHash: new Uint8Array(0),
      expiresAt,
      purpose: "registration",
      rpId: "example.com",
      userId: "user-1",
    })
  );
  await assert.rejects(() =>
    store.create({
      challengeHash: new Uint8Array(16),
      expiresAt,
      purpose: "registration",
      rpId: "example.com",
      userId: "user-1",
    })
  );
  await assert.rejects(() =>
    store.create({
      challengeHash: digest32(1),
      expiresAt,
      purpose: "registration",
      rpId: "",
      userId: "user-1",
    })
  );
  await assert.rejects(() =>
    store.create({
      challengeHash: digest32(1),
      expiresAt,
      purpose: "registration",
      rpId: "bad:rp",
      userId: "user-1",
    })
  );
  await assert.rejects(() =>
    store.create({
      challengeHash: digest32(1),
      expiresAt,
      purpose: "registration",
      rpId: "example.com",
      userId: null,
    })
  );
});

test("T-CHAL-NO-RAW: no raw nonce written to identifier or value", async () => {
  const { store, stores } = await instantiateMemoryStore();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const challengeHash = await sha256Bytes(raw);
  const created = await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.equal(created.consumedAt, null);
  const rawB64 = base64url(raw);
  const rawHex = Buffer.from(raw).toString("hex");
  assert.ok(stores.verifications.size >= 1);
  for (const row of stores.verifications.values()) {
    assert.equal(row.value.includes(rawB64), false);
    assert.equal(row.identifier.includes(rawB64), false);
    assert.equal(row.value.includes(rawHex), false);
    assert.equal(row.identifier.includes(rawHex), false);
    assert.equal(row.value, base64url(challengeHash));
    assert.match(row.identifier, /^passkey:registration:/);
    assert.equal(row.identifier.includes(":user-1"), true);
  }
});

test("T-CHAL-CREATE (CH-01): create then consume-equivalent read of the live row", async () => {
  const { store, stores } = await instantiateMemoryStore();
  const challengeHash = digest32(9);
  const expiresAt = new Date(Date.now() + 120_000);
  const created = await store.create({
    challengeHash,
    expiresAt,
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.equal(created.consumedAt, null);
  assert.equal(created.purpose, "registration");
  assert.equal(created.rpId, "example.com");
  assert.equal(created.userId, "user-1");
  assert.deepEqual([...created.challengeHash], [...challengeHash]);
  assert.equal(created.expiresAt.getTime(), expiresAt.getTime());
  assert.ok(created.id.length > 0);

  const rpHash = await rpIdHashToken("example.com");
  const expectedId = `passkey:registration:${rpHash}:user-1`;
  const row = [...stores.verifications.values()].find(
    (item) => item.id === created.id
  );
  assert.ok(row, "created challenge must persist a verifications row");
  assert.equal(row.identifier, expectedId);
  assert.equal(row.value, base64url(challengeHash));
  assert.equal(row.identifier.startsWith("passkey:"), true);

  const consumed = await store.consume({
    challengeHash,
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.ok(consumed.consumedAt instanceof Date);
});

test("T-CHAL-EXPIRED (CH-02): consume after expires_at misses", async () => {
  const { store } = await instantiateMemoryStore();
  const challengeHash = digest32(2);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() - 1000),
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash,
        purpose: "authentication",
        rpId: "example.com",
        userId: "user-1",
      }),
    "expired challenge must not be a consume winner"
  );
});

test("T-CHAL-RP (CH-03): wrong rpId does not consume", async () => {
  const { store } = await instantiateMemoryStore();
  const challengeHash = digest32(3);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash,
        purpose: "authentication",
        rpId: "other.example",
        userId: "user-1",
      }),
    "wrong rpId must not consume"
  );
  const winner = await store.consume({
    challengeHash,
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.ok(winner.consumedAt instanceof Date);
});

test("T-CHAL-PURPOSE (CH-04): wrong purpose does not consume", async () => {
  const { store } = await instantiateMemoryStore();
  const challengeHash = digest32(4);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash,
        purpose: "authentication",
        rpId: "example.com",
        userId: "user-1",
      }),
    "wrong purpose must not consume"
  );
  const winner = await store.consume({
    challengeHash,
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.ok(winner.consumedAt instanceof Date);
});

test("T-CHAL-USER (CH-05): wrong userId / discoverable null mismatch does not consume", async () => {
  const { store, stores } = await instantiateMemoryStore();
  const boundHash = digest32(5);
  const anonHash = digest32(6);
  await store.create({
    challengeHash: boundHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  await store.create({
    challengeHash: anonHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "authentication",
    rpId: "example.com",
    userId: null,
  });
  const rpHash = await rpIdHashToken("example.com");
  const identifiers = [...stores.verifications.values()].map(
    (row) => row.identifier
  );
  assert.ok(identifiers.includes(`passkey:authentication:${rpHash}:user-1`));
  assert.ok(identifiers.includes(`passkey:authentication:${rpHash}:anonymous`));

  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash: boundHash,
        purpose: "authentication",
        rpId: "example.com",
        userId: "user-2",
      }),
    "wrong userId must not consume"
  );
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash: boundHash,
        purpose: "authentication",
        rpId: "example.com",
        userId: null,
      }),
    "discoverable null must not match a bound user"
  );
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash: anonHash,
        purpose: "authentication",
        rpId: "example.com",
        userId: "user-1",
      }),
    "bound userId must not match a discoverable row"
  );
  const boundWinner = await store.consume({
    challengeHash: boundHash,
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.ok(boundWinner.consumedAt instanceof Date);
  const anonWinner = await store.consume({
    challengeHash: anonHash,
    purpose: "authentication",
    rpId: "example.com",
    userId: null,
  });
  assert.ok(anonWinner.consumedAt instanceof Date);
});

test("T-CHAL-REPLAY (CH-06): second consume of the same bind misses", async () => {
  const { store } = await instantiateMemoryStore();
  const challengeHash = digest32(7);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  const first = await store.consume({
    challengeHash,
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  assert.ok(first.consumedAt instanceof Date);
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash,
        purpose: "registration",
        rpId: "example.com",
        userId: "user-1",
      }),
    "second consume of the same bind must miss"
  );
});

test("T-CHAL-RACE (CH-07): two concurrent consume() calls yield exactly one winner (Memory)", async () => {
  const { store } = await instantiateMemoryStore();
  const challengeHash = digest32(8);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  const bind = {
    challengeHash,
    purpose: "authentication" as const,
    rpId: "example.com",
    userId: "user-1",
  };
  const results = await Promise.allSettled([
    store.consume(bind),
    store.consume(bind),
  ]);
  const winners = results.filter((item) => isConsumeWinner(item));
  assert.equal(winners.length, 1, "exactly one concurrent consume must win");
});

test("T-CHAL-RACE (CH-07): two concurrent consume() calls yield exactly one winner (Postgres / in-process SQL)", async () => {
  const { store } = await instantiatePostgresStore();
  const challengeHash = digest32(11);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() + 60_000),
    purpose: "authentication",
    rpId: "example.com",
    userId: "user-1",
  });
  const bind = {
    challengeHash,
    purpose: "authentication" as const,
    rpId: "example.com",
    userId: "user-1",
  };
  const results = await Promise.allSettled([
    store.consume(bind),
    store.consume(bind),
  ]);
  const winners = results.filter((item) => isConsumeWinner(item));
  assert.equal(
    winners.length,
    1,
    "exactly one concurrent Postgres consume must win"
  );
});

test("T-CHAL-UNRELATED (CH-08): email/reset/TOTP rows are untouched by consume and expire", async () => {
  const { store, stores } = await instantiateMemoryStore();
  const emailRow = await stores.createVerification({
    expiresAt: new Date(Date.now() - 1000),
    id: "email-expired",
    identifier: "user-1@example.com",
    value: "email-token",
  });
  const resetRow = await stores.createVerification({
    expiresAt: new Date(Date.now() - 1000),
    id: "reset-expired",
    identifier: "reset:user-1@example.com",
    value: "reset-token",
  });
  const totpRow = await stores.createVerification({
    expiresAt: new Date(Date.now() - 500),
    id: "totp-expired",
    identifier: "2fa_otp:user-1",
    value: "totp-token",
  });
  const liveEmail = await stores.createVerification({
    expiresAt: new Date(Date.now() + 60_000),
    id: "email-live",
    identifier: "email:user-2@example.com",
    value: "email-live-token",
  });
  const challengeHash = digest32(1);
  await store.create({
    challengeHash,
    expiresAt: new Date(Date.now() - 1000),
    purpose: "registration",
    rpId: "example.com",
    userId: "user-1",
  });
  const expired = await store.expire(new Date());
  assert.ok(expired >= 1, "expire must delete the expired passkey row");
  assert.ok(stores.verifications.get(emailRow.value), "email row must remain");
  assert.ok(stores.verifications.get(resetRow.value), "reset row must remain");
  assert.ok(stores.verifications.get(totpRow.value), "TOTP row must remain");
  assert.ok(
    stores.verifications.get(liveEmail.value),
    "live email must remain"
  );
  await assertConsumeMiss(
    () =>
      store.consume({
        challengeHash,
        purpose: "registration",
        rpId: "example.com",
        userId: "user-1",
      }),
    "expired passkey consume after expire must miss"
  );
  assert.ok(stores.verifications.get(emailRow.value));
  assert.ok(stores.verifications.get(resetRow.value));
  assert.ok(stores.verifications.get(totpRow.value));
  assert.ok(stores.verifications.get(liveEmail.value));
});

test("T-CHAL-NO-CONSUMED-AT: schema v1 still has no consumed_at; domain consumedAt is return-time only", () => {
  const schemaSrc = readPkg("src/auth/schema/migrations.ts");
  const ddl = extractVerificationsDdl(schemaSrc);
  assert.equal(/\bconsumed_at\b/.test(ddl), false);
  assert.equal(/UNIQUE\s*\(\s*identifier\s*\)/.test(ddl), false);
});

test("T-CHAL-FAIL-CLOSED: passkeys:false; six remaining missing routes; construct throw; public passkey surface unchanged", () => {
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
  assert.equal(
    readPkg("src/auth/capabilities.ts").includes("passkeyEnabled"),
    true
  );
  const listed = inventoryKnownMissing();
  for (const route of SIX_REMAINING_PASSKEY_ROUTES) {
    assert.equal(listed.includes(`"${route}"`), false);
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
  assert.equal(CANONICAL_PASSKEY_METHODS.length, 8);
  const auth = createAuthModule({
    capabilities: ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  }).auth;
  assert.deepEqual(
    Object.keys(auth.passkey).sort(),
    [
      ...CANONICAL_PASSKEY_METHODS,
      "register",
      "signIn",
    ].sort()
  );
});
