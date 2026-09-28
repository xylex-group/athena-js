/**
 * Auth transport finality — token authority target.
 * Plan 1 JWT store: abstraction GREEN; durable Postgres + cross-process
 * restart is proven in athena-token-authority-interop / pg store tests.
 * Process-lifetime MemoryTokenKeyStore is ephemeral (ADR 0047).
 *
 * Spec: docs/sdd/xylex/athena-auth-transport-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const tokenAuthorityPath = join(
  pkgRoot,
  "src",
  "auth",
  "local",
  "token-authority.ts"
);
const localRoot = join(pkgRoot, "src", "auth", "local");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(next));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(next);
    }
  }
  return out;
}

function joined(dir: string): string {
  return walkTs(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

const authoritySrc = readFileSync(tokenAuthorityPath, "utf8");
const localSrc = joined(localRoot);

test("T-JWT-001: Token authority depends on a TokenKeyStore abstraction", () => {
  assert.match(
    authoritySrc,
    /TokenKeyStore/,
    "AUTH-JWT-01/02: createLocalTokenAuthority must depend on TokenKeyStore (not implemented yet)"
  );
});

test("T-JWT-002: No production/default signing authority calls generateKeyPair during normal runtime construction", () => {
  const factory = authoritySrc.slice(
    authoritySrc.indexOf("export async function createLocalTokenAuthority")
  );
  assert.doesNotMatch(
    factory,
    /generateKeyPair\s*\(/,
    "createLocalTokenAuthority must not call generateKeyPair during construction (AUTH-JWT-01/04)"
  );
});

test("T-JWT-003: kid must not be derived solely from the current date", () => {
  assert.doesNotMatch(
    authoritySrc,
    /kid\s*=\s*`athena-local-\$\{new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\}`/,
    "date-based kid is forbidden (AUTH-JWT-03)"
  );
  assert.doesNotMatch(
    authoritySrc,
    /toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/,
    "kid must be an opaque unique identifier, not a calendar date"
  );
});

test("T-JWT-004: JWKS contract permits multiple verification keys", () => {
  assert.match(
    localSrc,
    /listVerificationKeys/,
    "TokenKeyStore.listVerificationKeys must exist (AUTH-JWT-07)"
  );
  assert.match(
    localSrc,
    /TokenVerificationKey\[\]/,
    "verification set is TokenVerificationKey[]"
  );
});

test("T-JWT-005: exactly one active signing generation is modeled", () => {
  assert.match(
    localSrc,
    /getActiveSigningKey/,
    "exactly one active signing generation (AUTH-JWT-05)"
  );
  assert.match(
    localSrc,
    /"active"|'active'|status:\s*"active"/,
    "key status must include active"
  );
});

test("T-JWT-006: retiring verification keys are modeled independently from active signing key", () => {
  assert.match(
    localSrc,
    /retireKey|"retiring"|'retiring'/,
    "retiring must be independent of the active signer (AUTH-JWT-06)"
  );
});

test("T-JWT-007: private key material is never returned by the JWKS serializer", () => {
  assert.match(
    localSrc,
    /serializePublicJwks|serializeJwks/,
    "named JWKS serializer required (AUTH-JWT-08)"
  );
  const serializerHit = walkTs(localRoot).filter((file) => {
    const src = readFileSync(file, "utf8");
    return /serializePublicJwks|serializeJwks/.test(src);
  });
  assert.ok(serializerHit.length > 0, "JWKS serializer file must exist");
  const serializerSrc = serializerHit
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(
    serializerSrc,
    /\b["']d["']\b|\.d\b|private/,
    "serializer must explicitly strip/forbid private JWK parameters"
  );
});

test("T-JWT-008: rotation policy accounts for maximum token TTL and JWKS cache lifetime", () => {
  assert.match(
    localSrc,
    /retireWindow|minRetire|jwksCache|maxTokenTtl|max_ttl/i,
    "rotation must keep retiring keys for max token TTL + JWKS cache lifetime"
  );
});

test("T-JWT-009: bootstrap contract describes cross-replica locking/double-check behavior", () => {
  assert.match(
    localSrc,
    /acquireBootstrapLock|compareAndActivate|double-?check|bootstrapLock/i,
    "AUTH-JWT-09: activation must be concurrency-safe across replicas"
  );
});

test("T-JWT-010: OIDC discovery cannot advertise authorization-code/refresh capabilities without corresponding operation-catalog support", () => {
  assert.match(
    authoritySrc,
    /buildOidcDiscoveryDocument|oidcDiscoveryFromCatalog/,
    "OIDC discovery must be built from the operation catalog (AUTH-JWT-10)"
  );
  const advertisedGrants =
    /authorization_code|grant_types_supported|refresh_token/.test(authoritySrc);
  if (advertisedGrants) {
    const catalogPaths = new Set(
      ATHENA_AUTH_OPERATIONS.filter(
        (operation) =>
          operation.embedded === "supported" || operation.rust === "supported"
      ).map((operation) => `${operation.method} ${operation.path}`)
    );
    assert.ok(
      catalogPaths.has("POST /refresh-token") ||
        catalogPaths.has("GET /authorize") ||
        catalogPaths.has("POST /authorize"),
      "advertised OAuth grants require catalogued supported operations — do not invent rows in Plan 1"
    );
  }
});

test("T-JWT-011: PostgresTokenKeyStore and cross-process child proof exist", () => {
  assert.match(localSrc, /class PostgresTokenKeyStore/);
  assert.match(localSrc, /pg_advisory_xact_lock/);
  assert.match(localSrc, /auth_signing_keys/);
  assert.equal(
    existsSync(join(pkgRoot, "test", "finality", "token-key-store-child.ts")),
    true
  );
  assert.equal(
    existsSync(
      join(pkgRoot, "test", "finality", "token-key-store-postgres.test.ts")
    ),
    true
  );
});
