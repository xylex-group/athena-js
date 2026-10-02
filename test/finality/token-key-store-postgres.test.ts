/**
 * Durable JWT/JWKS: Postgres store, replica activate, retire window,
 * child-process restart (not in-process close+reconstruct).
 */
import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { PostgresTokenKeyStore } from "../../src/auth/local/postgres-token-key-store.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import {
  ensureActiveSigningKey,
  rotateSigningKey,
  serializePublicJwks,
} from "../../src/auth/local/token-key-store.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const childPath = join(pkgRoot, "test", "finality", "token-key-store-child.ts");

function databaseUrl(): string | undefined {
  const url = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  return /^postgres(ql)?:\/\//i.test(url) ? url : undefined;
}

const url = databaseUrl();
const maybe = url ? test : test.skip;

maybe("Postgres TokenKeyStore: child-process mint then verify", async () => {
  assert.ok(url);
  const issuer = `http://jwt-child.${crypto.randomUUID()}.test`;
  const secret = "finality-jwt-secret-32-chars!!";
  const database = await createPostgresAuthDatabase(url);
  try {
    await migrateAthenaAuthSchema(database);
    const store = new PostgresTokenKeyStore({
      database,
      encryptionSecret: secret,
      issuer,
    });
    await ensureActiveSigningKey(store);
  } finally {
    await database.close?.();
  }

  const mint = spawnSync(
    process.execPath,
    [
      "--import",
      "./test/register-server-only.mjs",
      "--import",
      "tsx",
      childPath,
    ],
    {
      cwd: pkgRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ATHENA_TOKEN_CHILD: "mint",
        ATHENA_TOKEN_ISSUER: issuer,
        ATHENA_TOKEN_SECRET: secret,
        DATABASE_URL: url,
      },
    }
  );
  assert.equal(mint.status, 0, mint.stderr || mint.stdout);
  const minted = JSON.parse(mint.stdout.trim()) as {
    kid: string;
    token: string;
  };
  assert.ok(minted.token);
  assert.ok(minted.kid);

  const verify = spawnSync(
    process.execPath,
    [
      "--import",
      "./test/register-server-only.mjs",
      "--import",
      "tsx",
      childPath,
    ],
    {
      cwd: pkgRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ATHENA_TOKEN_CHILD: "verify",
        ATHENA_TOKEN_ISSUER: issuer,
        ATHENA_TOKEN_JWT: minted.token,
        ATHENA_TOKEN_SECRET: secret,
        DATABASE_URL: url,
      },
    }
  );
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  const verified = JSON.parse(verify.stdout.trim()) as {
    kid?: string;
    ok?: boolean;
  };
  assert.equal(verified.ok, true);
  assert.equal(verified.kid, minted.kid);
});

maybe("Postgres TokenKeyStore: two runtimes one active kid", async () => {
  assert.ok(url);
  const issuer = `http://jwt-replica.${crypto.randomUUID()}.test`;
  const secret = "finality-jwt-secret-32-chars!!";
  const left = await createPostgresAuthDatabase(url);
  const right = await createPostgresAuthDatabase(url);
  try {
    await migrateAthenaAuthSchema(left);
    const leftStore = new PostgresTokenKeyStore({
      database: left,
      encryptionSecret: secret,
      issuer,
    });
    const rightStore = new PostgresTokenKeyStore({
      database: right,
      encryptionSecret: secret,
      issuer,
    });
    const [a, b] = await Promise.all([
      ensureActiveSigningKey(leftStore),
      ensureActiveSigningKey(rightStore),
    ]);
    assert.equal(a.kid, b.kid);
    const [rsaLeft, rsaRight] = await Promise.all([
      ensureActiveSigningKey(leftStore, "RS256"),
      ensureActiveSigningKey(rightStore, "RS256"),
    ]);
    assert.equal(rsaLeft.kid, rsaRight.kid);
    assert.notEqual(rsaLeft.kid, a.kid);
    assert.deepEqual(
      (await leftStore.listVerificationKeys()).map((key) => key.algorithm).sort(),
      ["ES256", "RS256"]
    );
  } finally {
    await left.close?.();
    await right.close?.();
  }
});

maybe("Postgres TokenKeyStore: retire window then drop from JWKS", async () => {
  assert.ok(url);
  const issuer = `http://jwt-retire.${crypto.randomUUID()}.test`;
  const secret = "finality-jwt-secret-32-chars!!";
  const database = await createPostgresAuthDatabase(url);
  try {
    await migrateAthenaAuthSchema(database);
    const store = new PostgresTokenKeyStore({
      database,
      encryptionSecret: secret,
      issuer,
      retireWindowMs: 60_000,
    });
    const first = await ensureActiveSigningKey(store);
    const rotated = await rotateSigningKey(store);
    assert.notEqual(rotated.kid, first.kid);
    const stillListed = await store.listVerificationKeys(new Date());
    assert.ok(stillListed.some((key) => key.kid === first.kid));
    const afterWindow = await store.listVerificationKeys(
      new Date(Date.now() + 60_001)
    );
    assert.equal(
      afterWindow.some((key) => key.kid === first.kid),
      false
    );
    const jwks = serializePublicJwks(afterWindow);
    for (const key of jwks.keys) {
      assert.equal("d" in key, false);
    }
    const set = createLocalJWKSet(jwks);
    await assert.rejects(() =>
      jwtVerify("not-a-jwt", set, { audience: "athena", issuer })
    );
  } finally {
    await database.close?.();
  }
});
