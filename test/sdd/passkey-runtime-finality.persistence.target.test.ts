/**
 * Slice 03 TARGET — passkey persistence contract (desired additive schema).
 *
 * RED on CURRENT: requires JS 022 ALTER updated_at, generation 22, manifest [22]
 * column+indexes; Rust EXPECTED_COLUMNS_PASSKEYS / AuthPasskeyMeta / Passkey /
 * provision ALTER / migrations/021_*.sql. Stay-true cells (005 unchanged, UNIQUE
 * + indexes, domain updatedAt is not schema proof) are GREEN on CURRENT.
 *
 * Spec: docs/sdd/xylex/athena-passkey-runtime-finality/specs/03-passkey-persistence-contract.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/passkey-runtime-finality.persistence.target.test.ts
 *
 * Baseline retired: test/sdd/superseded/passkey-runtime-finality.persistence.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import committedManifest from "../../contracts/auth/schema-migrations.manifest.json" with {
  type: "json",
};
import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "../../src/auth/capabilities.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../src/auth/contract/index.ts";
import {
  getAthenaAuthExpectedLedger,
  getAthenaAuthSchemaManifest,
} from "../../src/auth/local/schema.ts";
import {
  ATHENA_AUTH_MIGRATION_EXPECTATIONS,
  column,
  index,
} from "../../src/auth/local/schema-manifest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");

const JS_005_CHECKSUM =
  "15819ba7636e29b718acc94fe9cf9ad5959202e18de6193f8fea2962718cfa17";
const ADD_UPDATED_AT_SQL =
  "ALTER TABLE athena.passkeys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()";

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

function extractBraceBlock(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `missing block starting ${header}`);
  const open = src.indexOf("{", start);
  assert.ok(open >= 0, `missing '{' after ${header}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
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
  assert.fail(`unclosed block ${header}`);
}

function extractNamedSqlBlock(src: string, name: string): string {
  const needle = `name: "${name}"`;
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing schema statement ${name}`);
  const sqlKey = src.indexOf("sql:", start);
  assert.ok(sqlKey >= 0, `missing sql for ${name}`);
  const tick = src.indexOf("`", sqlKey);
  assert.ok(tick >= 0, `missing sql template for ${name}`);
  const tickEnd = src.indexOf("`", tick + 1);
  assert.ok(tickEnd > tick, `unclosed sql template for ${name}`);
  return src.slice(tick + 1, tickEnd);
}

function extractRustStrArray(src: string, constName: string): string[] {
  const re = new RegExp(
    `const ${constName}: &[\\s\\S]*?= &\\[([\\s\\S]*?)\\];`
  );
  const match = src.match(re);
  assert.ok(match?.[1], `missing const ${constName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1] ?? "");
}

function collapseSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function extractProvisionPasskeys(sql: string): string {
  const start = sql.search(
    /CREATE TABLE[\s\S]{0,40}IF NOT EXISTS athena\.passkeys/
  );
  assert.ok(start >= 0, "provision.sql must CREATE athena.passkeys");
  const nextSection = sql.indexOf(
    "-- Athena Auth: persistent email send failure log",
    start
  );
  assert.ok(
    nextSection > start,
    "passkey CREATE must be followed by email failures"
  );
  return sql.slice(start, nextSection);
}

const jsSchemaSrc = readPkg("src/auth/schema/migrations.ts");
const jsPasskeySql = extractNamedSqlBlock(
  jsSchemaSrc,
  "005_create_passkey_table"
);

test("T-PERS-JS-022: ledger 22 022_add_updated_at_to_passkeys is additive ALTER updated_at", () => {
  const ledger = getAthenaAuthExpectedLedger();
  const entry = ledger.find((item) => item.version === 22);
  assert.ok(entry, "ledger must include version 22");
  assert.equal(entry.name, "022_add_updated_at_to_passkeys");
  const sql = extractNamedSqlBlock(
    jsSchemaSrc,
    "022_add_updated_at_to_passkeys"
  );
  assert.ok(
    collapseSql(sql).includes(ADD_UPDATED_AT_SQL),
    "022 SQL must ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
  );
  assert.equal(
    /CHECK\s*\(\s*counter/i.test(sql),
    false,
    "022 must omit CHECK (counter >= 0)"
  );
  assert.equal(
    committedManifest["022"] !== undefined &&
    typeof committedManifest["022"] === "string" &&
    committedManifest["022"].length === 64,
    true,
    'committed schema-migrations.manifest.json must gain key "022"'
  );
});

test("T-PERS-JS-005-UNCHANGED: version 5 SQL still has no updated_at; checksum 005 unchanged", () => {
  assert.equal(/updated_at/i.test(jsPasskeySql), false);
  assert.equal(
    (committedManifest as Record<string, string>)["005"],
    JS_005_CHECKSUM
  );
  assert.equal(getAthenaAuthSchemaManifest()["005"], JS_005_CHECKSUM);
});

test("T-PERS-JS-GEN-22: ATHENA_AUTH_SCHEMA_GENERATION includes passkey 022 and later observability", () => {
  assert.ok(ATHENA_AUTH_SCHEMA_GENERATION >= 22);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
});

test("T-PERS-JS-EXPECT-COL: expectations [22] include column athena.passkeys.updated_at", () => {
  const v22 = ATHENA_AUTH_MIGRATION_EXPECTATIONS[22];
  assert.ok(v22, "ATHENA_AUTH_MIGRATION_EXPECTATIONS[22] must exist");
  const expected = column("athena", "passkeys", "updated_at");
  assert.ok(
    v22.some(
      (item) =>
        item.kind === "column" &&
        item.object === expected.object &&
        item.column === "updated_at" &&
        item.table === "passkeys"
    ),
    "expectations[22] must include column athena.passkeys.updated_at"
  );
});

test("T-PERS-JS-EXPECT-IDX: expectations [22] include both idx_passkeys_* indexes", () => {
  const v22 = ATHENA_AUTH_MIGRATION_EXPECTATIONS[22];
  assert.ok(v22, "ATHENA_AUTH_MIGRATION_EXPECTATIONS[22] must exist");
  const userIdx = index("athena", "idx_passkeys_user_id");
  const credIdx = index("athena", "idx_passkeys_credential_id");
  assert.ok(
    v22.some((item) => item.kind === "index" && item.object === userIdx.object)
  );
  assert.ok(
    v22.some((item) => item.kind === "index" && item.object === credIdx.object)
  );
});

test("T-PERS-JS-005-UNIQUE: 005 still UNIQUE credential_id + both indexes", () => {
  assert.match(jsPasskeySql, /credential_id TEXT NOT NULL UNIQUE/);
  assert.match(jsPasskeySql, /idx_passkeys_user_id/);
  assert.match(jsPasskeySql, /idx_passkeys_credential_id/);
  const rust005 = readRepo(
    "services/athena-auth/migrations/005_create_passkey_table.sql"
  );
  assert.match(rust005, /credential_id TEXT NOT NULL UNIQUE/);
  assert.match(rust005, /idx_passkeys_user_id/);
  assert.match(rust005, /idx_passkeys_credential_id/);
});

test("T-PERS-RS-EXPECTED: EXPECTED_COLUMNS_PASSKEYS includes updated_at", () => {
  const cols = extractRustStrArray(
    readRepo("services/athena-auth/src/bin/server.rs"),
    "EXPECTED_COLUMNS_PASSKEYS"
  );
  assert.ok(
    cols.includes("updated_at"),
    "EXPECTED_COLUMNS_PASSKEYS must include updated_at"
  );
});

test("T-PERS-RS-META: AuthPasskeyMeta default col_updated_at() -> updated_at", () => {
  const trait = extractBraceBlock(
    readRepo("services/athena-auth/crates/core/src/entity.rs"),
    "pub trait AuthPasskeyMeta"
  );
  assert.match(
    trait,
    /fn col_updated_at\(\)\s*->\s*&'static str\s*\{\s*"updated_at"\s*\}/
  );
});

test("T-PERS-RS-TYPE: Passkey has updated_at (struct + FromRow)", () => {
  const passkey = extractBraceBlock(
    readRepo("services/athena-auth/crates/core/src/types.rs"),
    "pub struct Passkey"
  );
  assert.match(passkey, /pub updated_at:/);
  const authPasskey = extractBraceBlock(
    readRepo("services/athena-auth/crates/core/src/entity.rs"),
    "pub trait AuthPasskey:"
  );
  assert.match(authPasskey, /fn updated_at\(/);
  const impls = readRepo("services/athena-auth/crates/core/src/types_impls.rs");
  const fromRowStart = impls.indexOf("impl FromRow<'_, PgRow> for Passkey");
  assert.ok(fromRowStart >= 0, "FromRow for Passkey must exist");
  const fromRow = extractBraceBlock(
    impls.slice(fromRowStart),
    "impl FromRow<'_, PgRow> for Passkey"
  );
  assert.match(fromRow, /updated_at:\s*row\.try_get\("updated_at"\)/);
  const implAuth = extractBraceBlock(impls, "impl AuthPasskey for Passkey");
  assert.match(implAuth, /fn updated_at\(/);
});

test("T-PERS-RS-021: migrations/021_*updated_at*passkey* is additive ALTER; 005 still no updated_at", () => {
  const rust005 = readRepo(
    "services/athena-auth/migrations/005_create_passkey_table.sql"
  );
  assert.equal(/updated_at/i.test(rust005), false);
  const migDir = join(repoRoot, "services", "athena-auth", "migrations");
  const files = readdirSync(migDir).filter(
    (name) =>
      /^021_.*updated_at.*passkey.*\.sql$/i.test(name) ||
      name === "021_add_updated_at_to_passkeys.sql"
  );
  assert.ok(
    files.length >= 1,
    "Rust incremental 021_*updated_at*passkey*.sql must exist"
  );
  const sql = readFileSync(join(migDir, files[0] ?? ""), "utf8");
  assert.ok(
    collapseSql(sql).includes(ADD_UPDATED_AT_SQL),
    "Rust 021 must be additive ALTER updated_at"
  );
});

test("T-PERS-RS-PROVISION-ALTER: provision.sql ALTER-adds updated_at; CREATE body still omits it", () => {
  const provision = readRepo("services/athena-auth/sql/provision.sql");
  const create = extractProvisionPasskeys(provision);
  assert.equal(
    /updated_at/i.test(create),
    false,
    "provision CREATE athena.passkeys must still omit updated_at"
  );
  assert.ok(
    /ALTER TABLE\s+athena\.passkeys[\s\S]*ADD COLUMN IF NOT EXISTS\s+updated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+NOW\s*\(\)/i.test(
      provision
    ),
    "provision.sql must ALTER TABLE athena.passkeys ADD COLUMN IF NOT EXISTS updated_at"
  );
});

test("T-PERS-DOMAIN-NOT-SCHEMA: domain updatedAt remains and is not proof of the SQL column", () => {
  const typesSrc = readPkg("src/auth/passkey/server/types.ts");
  const iface = extractBraceBlock(
    typesSrc,
    "export interface AthenaStoredPasskey"
  );
  assert.match(iface, /updatedAt:\s*Date\s*\|\s*null/);
  assert.equal(existsSync(join(pkgRoot, "src/auth/local/schema.ts")), true);
  assert.equal(
    /updated_at/i.test(jsPasskeySql),
    false,
    "AthenaStoredPasskey.updatedAt must not be treated as 005 SQL column proof"
  );
});

test("T-PERS-JS-INSPECT-UNCHANGED: schema-inspect.ts kinds already cover column/index/constraint", () => {
  const inspect = readPkg("src/auth/local/schema-inspect.ts");
  assert.match(inspect, /"missing-column"/);
  assert.match(inspect, /"missing-index"/);
  assert.match(inspect, /"missing-constraint"/);
  assert.match(inspect, /case "column":/);
  assert.match(inspect, /case "index":/);
  assert.match(inspect, /case "constraint":/);
  assert.equal(
    /passkeys\.updated_at/.test(inspect),
    false,
    "schema-inspect.ts must not special-case passkeys.updated_at"
  );
});

test("T-PERS-NO-COUNTER-CHECK: CHECK counter >= 0 is not a T-PERS requirement", () => {
  assert.equal(/CHECK\s*\(\s*counter/i.test(jsPasskeySql), false);
  const rust005 = readRepo(
    "services/athena-auth/migrations/005_create_passkey_table.sql"
  );
  assert.equal(/CHECK\s*\(\s*counter/i.test(rust005), false);
});

test("T-PERS-NO-ADAPTER-REWRITE: PasskeyStoreAdapter is not the persistence mutator this slice", () => {
  const handlers = readRepo(
    "services/athena-auth/crates/api/src/plugins/passkey/handlers.rs"
  );
  assert.match(handlers, /struct PasskeyStoreAdapter/);
  const createStart = handlers.indexOf("async fn create_passkey(");
  assert.ok(createStart >= 0, "PasskeyStoreAdapter::create_passkey must exist");
  const rest = handlers.slice(createStart);
  const next = rest.search(/\n {4}async fn /);
  const createFn = next === -1 ? rest : rest.slice(0, next);
  assert.equal(
    /updated_at/.test(createFn),
    false,
    "this slice must not rewrite PasskeyStoreAdapter INSERT/UPDATE for updated_at"
  );
});

test("T-PERS-SCOPE-CLOSED: capability flip stays fail-closed (passkeys false)", () => {
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
});
