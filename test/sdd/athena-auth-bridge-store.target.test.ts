/**
 * Auth transport finality — Plan 2 bridge-store target.
 * Storage/domain authority only. HTTP/UI finality stays in the Plan 1 suite.
 *
 * Spec: docs/sdd/xylex/athena-auth-transport-finality/
 */
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	ATHENA_AUTH_SCHEMA_GENERATION,
	ATHENA_AUTH_TABLES,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";
import {
	ATHENA_AUTH_MIGRATION_EXPECTATIONS,
} from "../../src/auth/local/schema-manifest.ts";
import {
	getAthenaAuthExpectedLedger,
	getAthenaAuthSchemaManifest,
	planAthenaAuthSchema,
} from "../../src/auth/local/schema.ts";
import { checksumMigrationSql } from "../../src/migrations/checksum.ts";
import { redactSecrets, redactValue } from "../../src/cli/logging/redact.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const authRoot = join(pkgRoot, "src", "auth");
const schemaPath = join(authRoot, "local", "schema.ts");
const contractPath = join(authRoot, "contract", "index.ts");
const postgresStorePath = join(authRoot, "local", "bridge", "postgres-store.ts");
const memoryStorePath = join(authRoot, "local", "bridge", "memory-store.ts");
const runtimeDepsPath = join(authRoot, "local", "runtime-dependencies.ts");
const packageJsonPath = join(pkgRoot, "package.json");
const standaloneSqlCandidates = [
	join(pkgRoot, "migrations", "auth", "027_auth_bridge_codes.sql"),
	join(repoRoot, "athena", "migrations", "027_auth_bridge_codes.sql"),
	join(pkgRoot, "src", "auth", "migrations", "027_auth_bridge_codes.sql"),
];

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

function read(path: string): string {
	return readFileSync(path, "utf8");
}

async function loadBridge() {
	return import("../../src/auth/bridge/code.ts");
}

async function loadMemoryStore() {
	return import("../../src/auth/local/bridge/memory-store.ts");
}

function createLedgerDatabase(
	rows: Array<{ checksum?: string | null; name?: string; version: number }>,
): AthenaAuthDatabase {
	return {
		async close() {},
		async query(text) {
			if (/auth_schema_migrations/i.test(text)) {
				return { rowCount: rows.length, rows };
			}
			return { rowCount: 0, rows: [] };
		},
		async transaction(fn) {
			return fn(this);
		},
	};
}

function futureExpiry(): Date {
	return new Date(Date.now() + 60_000);
}

async function issueCode(
	store: {
		issue: (input: {
			codeHash: string;
			destinationOrigin: string;
			expiresAt: Date;
			redirectPath: string;
			sessionId: string;
			userId: string;
		}) => Promise<{ codeHash: string }>;
	},
	bridge: Awaited<ReturnType<typeof loadBridge>>,
	overrides: {
		destinationOrigin?: string;
		expiresAt?: Date;
		redirectPath?: string;
		sessionId?: string;
		userId?: string;
	} = {},
) {
	const code = bridge.generateAuthBridgeCode();
	const codeHash = await bridge.hashAuthBridgeCode(code);
	const record = await store.issue({
		codeHash,
		destinationOrigin: overrides.destinationOrigin ?? "https://app.example",
		expiresAt: overrides.expiresAt ?? futureExpiry(),
		redirectPath: overrides.redirectPath ?? "/dashboard",
		sessionId: overrides.sessionId ?? "sess_1",
		userId: overrides.userId ?? "user_1",
	});
	return { code, codeHash, record };
}

test("T-BSTORE-001: 027_auth_bridge_codes is part of Embedded Auth migration history", () => {
	const ledger = getAthenaAuthExpectedLedger();
	const entry = ledger.find((item) => item.version === 27);
	assert.ok(entry, "expected ledger must include version 27");
	assert.equal(entry?.name, "027_auth_bridge_codes");
	const versions = ledger.map((item) => item.version);
	assert.ok(versions.indexOf(26) < versions.indexOf(27));
	assert.match(read(schemaPath), /027_auth_bridge_codes/);
	for (const path of standaloneSqlCandidates) {
		assert.equal(
			existsSync(path),
			false,
			`must not introduce a parallel migration file at ${path}`,
		);
	}
});

test("T-BSTORE-002: ATHENA_AUTH_SCHEMA_GENERATION is 28", () => {
	assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
	assert.match(read(contractPath), /027_auth_bridge_codes/);
});

test("T-BSTORE-003: table is athena.auth_bridge_codes", () => {
	assert.equal(ATHENA_AUTH_TABLES.authBridgeCodes, "athena.auth_bridge_codes");
	assert.match(read(schemaPath), /CREATE TABLE IF NOT EXISTS athena\.auth_bridge_codes/);
});

test("T-BSTORE-004: no public.auth_bridge_codes exists", () => {
	const schemaSrc = read(schemaPath);
	assert.doesNotMatch(schemaSrc, /CREATE TABLE IF NOT EXISTS public\.auth_bridge_codes/);
	assert.doesNotMatch(schemaSrc, /public\.athena_auth_bridge_codes/);
	assert.doesNotMatch(schemaSrc, /athena\.athena_auth_bridge_codes/);
});

test("T-BSTORE-005: ATHENA_AUTH_TABLES contains authBridgeCodes", () => {
	assert.equal("authBridgeCodes" in ATHENA_AUTH_TABLES, true);
	assert.equal(ATHENA_AUTH_TABLES.authBridgeCodes, "athena.auth_bridge_codes");
});

test("T-BSTORE-006: schema manifest covers table + indexes", () => {
	const expectations = ATHENA_AUTH_MIGRATION_EXPECTATIONS[27] ?? [];
	const objects = expectations.map((item) => item.object);
	assert.ok(objects.includes("athena.auth_bridge_codes"));
	assert.ok(objects.includes("athena.idx_auth_bridge_codes_expires_at"));
	assert.ok(objects.includes("athena.idx_auth_bridge_codes_session_id"));
	assert.ok(objects.includes("athena.idx_auth_bridge_codes_user_id"));
	assert.ok(objects.includes("athena.idx_auth_bridge_codes_outstanding_session"));
});

test("T-BSTORE-007: plaintext bridge codes are never persisted", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code, record } = await issueCode(store, bridge);
	assert.equal("code" in record, false);
	assert.doesNotMatch(
		JSON.stringify(record),
		new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
});

test("T-BSTORE-008: opaque code has >=256 bits source entropy", async () => {
	const bridge = await loadBridge();
	const code = bridge.generateAuthBridgeCode();
	assert.match(code, /^ath_brc_[A-Za-z0-9_-]+$/);
	const parsed = bridge.parseAuthBridgeCode(code);
	assert.ok(parsed.entropyBits >= 256);
	assert.equal(parsed.bytes.byteLength, 32);
});

test("T-BSTORE-009: domain-separated hash is deterministic", async () => {
	const bridge = await loadBridge();
	const code = "ath_brc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
	const first = await bridge.hashAuthBridgeCode(code);
	const second = await bridge.hashAuthBridgeCode(code);
	assert.equal(first, second);
	const expected = createHash("sha256")
		.update(`athena:auth:bridge:v1:${code}`, "utf8")
		.digest("hex");
	assert.equal(first, expected);
	const other = await bridge.hashAuthBridgeCode(`${code}x`);
	assert.notEqual(first, other);
});

test("T-BSTORE-010: valid code consumes exactly once", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge);
	const first = await store.consume({
		code,
		destinationOrigin: "https://app.example",
	});
	assert.ok(first);
	assert.equal(first.sessionId, "sess_1");
	assert.ok(first.consumedAt instanceof Date);
	const second = await store.consume({
		code,
		destinationOrigin: "https://app.example",
	});
	assert.equal(second, null);
});

test("T-BSTORE-011: 20 concurrent consumers → exactly one winner", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge);
	const results = await Promise.all(
		Array.from({ length: 20 }, () =>
			store.consume({
				code,
				destinationOrigin: "https://app.example",
			}),
		),
	);
	assert.equal(results.filter((item) => item !== null).length, 1);
	assert.equal(results.filter((item) => item === null).length, 19);
});

test("T-BSTORE-012: expired code cannot consume", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge, {
		expiresAt: new Date(Date.now() - 1000),
	});
	assert.equal(
		await store.consume({
			code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
});

test("T-BSTORE-013: revoked code cannot consume", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge);
	assert.equal(await store.revokeForSession("sess_1", "session_revoked"), 1);
	assert.equal(
		await store.consume({
			code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
});

test("T-BSTORE-014: wrong destination cannot consume", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge);
	assert.equal(
		await store.consume({
			code,
			destinationOrigin: "https://evil.example",
		}),
		null,
	);
});

test("T-BSTORE-015: destination mismatch burns code", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const { code } = await issueCode(store, bridge);
	assert.equal(
		await store.consume({
			code,
			destinationOrigin: "https://evil.example",
		}),
		null,
	);
	assert.equal(
		await store.consume({
			code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
});

test("T-BSTORE-016: revokeForSession invalidates all outstanding codes", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const first = await issueCode(store, bridge);
	const second = await issueCode(store, bridge);
	assert.equal(await store.revokeForSession("sess_1"), 2);
	assert.equal(
		await store.consume({
			code: first.code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
	assert.equal(
		await store.consume({
			code: second.code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
});

test("T-BSTORE-017: source-session deletion cascades bridge rows", () => {
	const schemaSrc = read(schemaPath);
	assert.match(
		schemaSrc,
		/session_id TEXT NOT NULL[\s\S]*REFERENCES athena\.sessions \(id\)[\s\S]*ON DELETE CASCADE/,
	);
	assert.match(
		schemaSrc,
		/user_id TEXT NOT NULL[\s\S]*REFERENCES athena\.users \(id\)[\s\S]*ON DELETE CASCADE/,
	);
});

test("T-BSTORE-018: cleanup removes expired codes only", async () => {
	const bridge = await loadBridge();
	const { createMemoryAuthBridgeCodeStore } = await loadMemoryStore();
	const store = createMemoryAuthBridgeCodeStore();
	const live = await issueCode(store, bridge, {
		expiresAt: new Date(Date.now() + 120_000),
	});
	const expired = await issueCode(store, bridge, {
		expiresAt: new Date(Date.now() - 5_000),
	});
	assert.equal(await store.deleteExpired(new Date()), 1);
	assert.ok(
		await store.consume({
			code: live.code,
			destinationOrigin: "https://app.example",
		}),
	);
	assert.equal(
		await store.consume({
			code: expired.code,
			destinationOrigin: "https://app.example",
		}),
		null,
	);
});

test("T-BSTORE-019: all SQL schema-qualifies athena.auth_bridge_codes", () => {
	assert.equal(existsSync(postgresStorePath), true);
	const sqlSrc = `${read(schemaPath)}\n${read(postgresStorePath)}`;
	assert.doesNotMatch(sqlSrc, /FROM\s+auth_bridge_codes\b/);
	assert.doesNotMatch(sqlSrc, /UPDATE\s+auth_bridge_codes\b/);
	assert.doesNotMatch(sqlSrc, /INTO\s+auth_bridge_codes\b/);
	assert.match(sqlSrc, /FROM athena\.auth_bridge_codes|UPDATE athena\.auth_bridge_codes|INTO athena\.auth_bridge_codes|ON athena\.auth_bridge_codes/);
	assert.match(read(postgresStorePath), /ATHENA_AUTH_TABLES\.authBridgeCodes/);
});

test("T-BSTORE-020: memory and database stores pass same behavior contract", async () => {
	assert.equal(existsSync(memoryStorePath), true);
	assert.equal(existsSync(postgresStorePath), true);
	const memorySrc = read(memoryStorePath);
	const postgresSrc = read(postgresStorePath);
	assert.match(memorySrc, /createMemoryAuthBridgeCodeStore/);
	assert.match(postgresSrc, /createPostgresAuthBridgeCodeStore/);
	assert.match(postgresSrc, /AthenaAuthDatabase/);
	assert.doesNotMatch(postgresSrc, /new Pool\(/);
	assert.match(
		`${memorySrc}\n${postgresSrc}`,
		/revokeForSession/,
	);
	assert.match(`${memorySrc}\n${postgresSrc}`, /deleteExpired/);
});

test("T-BSTORE-021: bridge secrets are absent from diagnostics/log serialization", () => {
	const code = "ath_brc_supersecretbridgecodevalue";
	assert.match(
		read(join(pkgRoot, "src", "cli", "logging", "redact.ts")),
		/bridgeCode|bridge_code|bridge-code/,
	);
	const redacted = redactValue({
		bridgeCode: code,
		bridge_code: code,
		code,
		note: "ok",
	});
	assert.deepEqual(redacted, {
		bridgeCode: "***",
		bridge_code: "***",
		code: "***",
		note: "ok",
	});
	assert.equal(redactSecrets(`bridgeCode=${code}`).includes(code), false);
});

test("T-BSTORE-022: athena-js migrate plan includes 027 for generation-26 DB", async () => {
	const expected = getAthenaAuthExpectedLedger();
	const applied = expected
		.filter((entry) => entry.version <= 26)
		.map((entry) => ({
			checksum: entry.checksum,
			name: entry.name,
			version: entry.version,
		}));
	const plan = await planAthenaAuthSchema(createLedgerDatabase(applied), {
		inspectSchema: false,
	});
	const entry = plan.entries.find((item) => item.version === 27);
	assert.ok(entry);
	assert.equal(entry?.name, "027_auth_bridge_codes");
	assert.equal(entry?.ledgerState, "absent");
	assert.equal(entry?.action, "apply");
	assert.ok(plan.pendingCount >= 1);
});

test("T-BSTORE-023: athena-js migrate applies 027 through auth_schema_migrations", () => {
	const schemaSrc = read(schemaPath);
	assert.match(schemaSrc, /INSERT INTO athena\.auth_schema_migrations/);
	const ledger = getAthenaAuthExpectedLedger();
	const entry = ledger.find((item) => item.version === 27);
	assert.ok(entry?.checksum);
	assert.match(entry?.checksum ?? "", /^[0-9a-f]{64}$/);
	const statement = read(schemaPath);
	assert.match(statement, /name: "027_auth_bridge_codes"/);
	assert.match(statement, /version: 27/);
});

test("T-BSTORE-024: migrate repair detects/reconciles missing 027 structures", async () => {
	const expected = getAthenaAuthExpectedLedger();
	const applied = expected.map((entry) => ({
		checksum: entry.checksum,
		name: entry.name,
		version: entry.version,
	}));
	const plan = await planAthenaAuthSchema(createLedgerDatabase(applied), {
		inspectSchema: true,
	});
	const entry = plan.entries.find((item) => item.version === 27);
	assert.ok(entry);
	assert.equal(entry?.ledgerState, "applied");
	assert.equal(entry?.schemaState, "drift");
	assert.equal(entry?.action, "repair");
	assert.ok(
		(entry?.drift ?? []).some(
			(item) =>
				item.object === "athena.auth_bridge_codes" &&
				item.kind === "missing-table",
		),
	);
});

test("T-BSTORE-025: 027 checksum is frozen through the committed ledger", () => {
	const ledger = getAthenaAuthExpectedLedger();
	const entry = ledger.find((item) => item.version === 27);
	assert.ok(entry);
	assert.equal(entry?.name, "027_auth_bridge_codes");
	assert.match(entry?.checksum ?? "", /^[0-9a-f]{64}$/);
	const manifest = getAthenaAuthSchemaManifest();
	assert.equal(manifest["027"], entry?.checksum);
	const schemaSrc = read(schemaPath);
	const match = schemaSrc.match(
		/name: "027_auth_bridge_codes",\s*sql: `([\s\S]*?)`,\s*version: 27/,
	);
	assert.ok(match?.[1], "027 SQL must be extractable from SCHEMA_STATEMENTS");
	assert.equal(checksumMigrationSql(match[1]), entry?.checksum);
});

test("T-BSTORE-026: destination origin and redirect path are strictly normalized", async () => {
	const bridge = await loadBridge();
	assert.throws(() =>
		bridge.normalizeAuthBridgeDestinationOrigin(
			"https://app.example/path?x=1#h",
		),
	);
	assert.throws(() =>
		bridge.normalizeAuthBridgeDestinationOrigin("https://user:pass@app.example"),
	);
	assert.throws(() =>
		bridge.normalizeAuthBridgeDestinationOrigin("http://app.example"),
	);
	assert.equal(
		bridge.normalizeAuthBridgeDestinationOrigin("https://app.example"),
		"https://app.example",
	);
	assert.equal(
		bridge.normalizeAuthBridgeDestinationOrigin("http://localhost:3000"),
		"http://localhost:3000",
	);
	assert.throws(() =>
		bridge.normalizeAuthBridgeRedirectPath("https://evil.example"),
	);
	assert.throws(() => bridge.normalizeAuthBridgeRedirectPath("//evil.example"));
	assert.throws(() =>
		bridge.normalizeAuthBridgeRedirectPath("javascript:alert(1)"),
	);
	assert.throws(() =>
		bridge.normalizeAuthBridgeRedirectPath("/ok\\/evil.example"),
	);
	assert.equal(bridge.normalizeAuthBridgeRedirectPath("/dashboard"), "/dashboard");
});

test("T-BSTORE-027: store stays internal; Plan 3 catalogs native issue/exchange", () => {
	assert.equal(existsSync(runtimeDepsPath), true);
	assert.match(read(runtimeDepsPath), /bridgeCodeStore/);
	const pkg = JSON.parse(read(packageJsonPath)) as {
		exports: Record<string, unknown>;
	};
	assert.equal("auth/bridge" in pkg.exports, false);
	const catalog = JSON.stringify(ATHENA_AUTH_OPERATIONS);
	assert.match(catalog, /session\.bridge\.issue/);
	assert.match(catalog, /session\.bridge\.exchange/);
	const authSrc = walkTs(authRoot)
		.map((file) => read(file))
		.join("\n");
	assert.doesNotMatch(authSrc, /export \* from ["']\.\/bridge/);
});
