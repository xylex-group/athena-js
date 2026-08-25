/**
 * Target suite: Athena JS client decomposition (Phase 0 freeze + Phase 1
 * import-boundary graph + Phase 2 internal ClientRuntimeContext).
 *
 * Encodes SPEC acceptance (docs/sdd/xylex/athena-js-client-decomposition/SPEC.md)
 * and DEPENDENCY-MAP. Must stay RED on CURRENT HEAD until:
 *   - src/client/create-client.ts and src/client/context.ts exist
 *   - composition root is consumed instead of the public façade
 *   - client.ts re-exports public types + universal createClient
 *
 * Do not implement product extraction here. Do not invert the baseline file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import * as rootBarrel from "../../src/index.ts";
import {
	AthenaRuntimeOwnershipError,
	getAthenaClientInternals,
} from "../../src/runtime/client-internals.ts";
import { createClient as createNodeClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const clientTs = join(srcRoot, "client.ts");
const clientDir = join(srcRoot, "client");
const createClientTs = join(clientDir, "create-client.ts");
const contextTs = join(clientDir, "context.ts");
const facadeTs = join(clientDir, "facade.ts");
const v3CoreTs = join(srcRoot, "v3-client-core.ts");
const v3NodeTs = join(srcRoot, "v3-client.ts");
const repoRoot = join(pkgRoot, "..", "..");
const freezeDir = join(
	repoRoot,
	"docs",
	"refactors",
	"athena-client-decomposition"
);

const STATIC_IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

const PHASE0_ARTIFACTS = [
	"CURRENT-ARCHITECTURE.md",
	"PUBLIC-API-SNAPSHOT.md",
	"CLIENT-RESPONSIBILITY-MAP.md",
	"DEPENDENCY-MAP.md",
	"TEST-BASELINE.md",
] as const;

const FEATURE_DIRS = [
	"auth",
	"storage",
	"chat",
	"billing",
	"db",
	"admin",
	"email",
] as const;

const PUBLIC_FACADE_FILES = [clientTs, v3CoreTs, v3NodeTs] as const;

function readSrc(relFromSrc: string): string {
	return readFileSync(join(srcRoot, relFromSrc), "utf8");
}

function readIfExists(absPath: string): string {
	assert.equal(
		existsSync(absPath),
		true,
		`expected ${posixRel(srcRoot, absPath)} to exist`
	);
	return readFileSync(absPath, "utf8");
}

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (current: string) => {
		if (!existsSync(current)) {
			return;
		}
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (entry.name.endsWith(".ts")) {
				out.push(full);
			}
		}
	};
	walk(dir);
	return out;
}

function staticSpecifiers(source: string): string[] {
	const found: string[] = [];
	STATIC_IMPORT_RE.lastIndex = 0;
	let match = STATIC_IMPORT_RE.exec(source);
	while (match) {
		if (match[1]) {
			found.push(match[1]);
		}
		match = STATIC_IMPORT_RE.exec(source);
	}
	return found;
}

function resolveRelativeSpecifier(
	fromFile: string,
	specifier: string
): string | undefined {
	if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
		return;
	}
	const withExt = specifier.match(/\.(js|ts)$/)
		? specifier
		: `${specifier}.ts`;
	return normalize(join(dirname(fromFile), withExt));
}

function posixRel(from: string, to: string): string {
	return relative(from, to).split("\\").join("/");
}

function sameTsFile(resolved: string, targetFile: string): boolean {
	const want = normalize(targetFile);
	const wantJs = want.replace(/\.ts$/, ".js");
	return resolved === want || resolved === wantJs;
}

function importsResolvedFile(fromFile: string, targetFile: string): boolean {
	const source = readFileSync(fromFile, "utf8");
	for (const specifier of staticSpecifiers(source)) {
		const resolved = resolveRelativeSpecifier(fromFile, specifier);
		if (!resolved) {
			continue;
		}
		if (sameTsFile(resolved, targetFile)) {
			return true;
		}
	}
	return false;
}

function facadeImportOffenders(
	dir: string,
	targets: readonly string[]
): string[] {
	const offenders: string[] = [];
	for (const file of listTsFiles(dir)) {
		for (const target of targets) {
			if (importsResolvedFile(file, target)) {
				offenders.push(
					`${posixRel(srcRoot, file)} → ${posixRel(srcRoot, target)}`
				);
			}
		}
	}
	return offenders;
}

function isValueExportFunction(source: string, name: string): boolean {
	return new RegExp(
		`export function ${name}\\s*(?:<[^>]*>)?\\s*\\(`
	).test(source);
}

function isReexportOf(source: string, name: string, fromFragment: string): boolean {
	const escaped = fromFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${escaped}["']`
	).test(source);
}

function mentionsForbiddenRuntime(source: string): boolean {
	return (
		source.includes('from "pg"') ||
		source.includes("from 'pg'") ||
		source.includes('from "node:fs"') ||
		source.includes("from 'node:fs'") ||
		source.includes('from "server-only"') ||
		source.includes("from 'server-only'") ||
		/from\s+["']\.\/postgres/.test(source) ||
		/from\s+["']\.\.\/postgres/.test(source) ||
		source.includes('from "./v3-client.ts"') ||
		source.includes("from './v3-client.ts'") ||
		source.includes('from "../v3-client.ts"')
	);
}

function mockTransport(): AthenaGatewayClient {
	const ok = async () =>
		({
			count: null,
			data: [],
			error: null,
			ok: true,
			raw: { data: [] },
			status: 200,
			statusText: "OK",
		}) as never;
	return {
		baseUrl: "https://athena.local/decomposition-target",
		buildHeaders() {
			return {};
		},
		deleteGateway: ok,
		fetchGateway: ok,
		insertGateway: ok,
		queryGateway: ok,
		async resolveCallOptions(options) {
			return options;
		},
		rpcGateway: ok,
		updateGateway: ok,
		async verifyConnection() {
			return { ok: true } as never;
		},
	};
}

function gatewayClient() {
	return createNodeClient({
		env: {},
		gatewayTransport: mockTransport(),
		key: "decomposition-target",
		url: "https://athena.example.com",
	});
}

test("P0: Phase 0 freeze markdown exists under docs/refactors/athena-client-decomposition/", () => {
	assert.equal(existsSync(freezeDir), true);
	for (const name of PHASE0_ARTIFACTS) {
		const path = join(freezeDir, name);
		assert.equal(existsSync(path), true, `missing ${name}`);
		assert.equal(statSync(path).isFile(), true);
		const body = readFileSync(path, "utf8");
		assert.ok(body.length > 80, `${name} is empty`);
	}

	const snapshot = readFileSync(
		join(freezeDir, "PUBLIC-API-SNAPSHOT.md"),
		"utf8"
	);
	assert.match(snapshot, /originating from or passing through/);
	assert.match(snapshot, /TableQueryBuilder/);
	assert.match(snapshot, /createClient/);
	assert.match(snapshot, /src\/client\.ts/);

	const map = readFileSync(join(freezeDir, "CLIENT-RESPONSIBILITY-MAP.md"), "utf8");
	assert.match(map, /new owner/i);
	assert.match(map, /createInternalClientCore/);

	const deps = readFileSync(join(freezeDir, "DEPENDENCY-MAP.md"), "utf8");
	assert.match(deps, /src\/query\/\*\*/);
	assert.match(deps, /v3-client-core/);
});

test("P0: src/client/create-client.ts exists", () => {
	assert.equal(existsSync(clientDir), true, "src/client/ directory must exist");
	assert.equal(
		existsSync(createClientTs),
		true,
		"src/client/create-client.ts must exist"
	);
	const source = readIfExists(createClientTs);
	assert.match(
		source,
		/export function createClient(?:WithNormalizer)?[\s\S]*\(/
	);
	assert.equal(mentionsForbiddenRuntime(source), false);
});

test("P0: src/client/context.ts exists and exports AthenaClientRuntimeContext or InternalAthenaClientCore", () => {
	assert.equal(
		existsSync(contextTs),
		true,
		"src/client/context.ts must exist"
	);
	const source = readIfExists(contextTs);
	const hasRuntimeContext = source.includes("AthenaClientRuntimeContext");
	const hasInternalCore =
		/export (?:interface|type) InternalAthenaClientCore/.test(source);
	assert.equal(
		hasRuntimeContext || hasInternalCore,
		true,
		"context.ts must export AthenaClientRuntimeContext or InternalAthenaClientCore"
	);
	assert.equal(isValueExportFunction(source, "createInternalClientCore"), true);
	assert.equal(isValueExportFunction(source, "createInternalClientView"), true);
	assert.equal(mentionsForbiddenRuntime(source), false);
});

test("P0: createInternalClientCore is not the sole implementation body remaining only in src/client.ts", () => {
	const clientSource = readSrc("client.ts");
	assert.equal(
		isValueExportFunction(clientSource, "createInternalClientCore"),
		false,
		"client.ts must not keep createInternalClientCore as its implementation body"
	);
	assert.equal(
		isValueExportFunction(clientSource, "createInternalClientView"),
		false,
		"client.ts must not keep createInternalClientView as its implementation body"
	);

	const contextSource = readIfExists(contextTs);
	assert.equal(
		isValueExportFunction(contextSource, "createInternalClientCore"),
		true
	);
	assert.ok(
		isReexportOf(clientSource, "createInternalClientCore", "./client/context.ts") ||
			isReexportOf(
				clientSource,
				"createInternalClientCore",
				"./client/context.js"
			) ||
			isReexportOf(clientSource, "createInternalClientCore", "./client/facade.ts") ||
			isReexportOf(clientSource, "createInternalClientCore", "./client/facade.js"),
		"client.ts may re-export createInternalClientCore from src/client/"
	);
});

test("P0: src/client.ts re-exports public builder types and universal createClient", () => {
	const source = readSrc("client.ts");
	assert.match(source, /\bTableQueryBuilder\b/);
	assert.match(source, /\bAthenaFromOptions\b/);
	assert.match(source, /\bRpcQueryBuilder\b/);

	const reexportsUniversal =
		isReexportOf(source, "createClient", "./client/create-client.ts") ||
		isReexportOf(source, "createClient", "./client/create-client.js") ||
		isReexportOf(source, "createClient", "./v3-client-core.ts") ||
		isReexportOf(source, "createClient", "./v3-client-core.js");
	assert.equal(
		reexportsUniversal,
		true,
		"client.ts must re-export browser-safe createClient"
	);
	assert.equal(
		isReexportOf(source, "createClient", "./v3-client.ts"),
		false,
		"client.ts must not re-export Node v3-client.ts (INV-RUNTIME-004)"
	);
	assert.equal(
		isReexportOf(source, "createClient", "./v3-client.js"),
		false
	);
});

test("P1: src/query/** and src/schema/** do not import src/client.ts or v3-client-core.ts or v3-client.ts", () => {
	const offenders: string[] = [];
	for (const dirName of ["query", "schema"] as const) {
		offenders.push(
			...facadeImportOffenders(join(srcRoot, dirName), PUBLIC_FACADE_FILES)
		);
	}
	assert.deepEqual(offenders, []);
});

test("P1: query/read-query.ts no longer type-imports AthenaClient from v3-client-core.ts", () => {
	const source = readSrc("query/read-query.ts");
	assert.equal(
		/import type \{[^}]*\bAthenaClient\b[^}]*\} from ["']\.\.\/v3-client-core\.ts["']/.test(
			source
		),
		false,
		"read-query.ts must not type-import AthenaClient from the public façade"
	);
	assert.equal(
		importsResolvedFile(join(srcRoot, "query", "read-query.ts"), v3CoreTs),
		false
	);
	assert.equal(
		importsResolvedFile(join(srcRoot, "query", "read-query.ts"), clientTs),
		false
	);
	assert.equal(
		importsResolvedFile(join(srcRoot, "query", "read-query.ts"), v3NodeTs),
		false
	);
	assert.match(source, /export interface AthenaReadQueryClient/);
	assert.equal(
		source.includes('AthenaClient["db"]'),
		false,
		"AthenaReadQueryClient must use a narrow db type, not AthenaClient['db']"
	);
});

test("P1: feature modules do not import unrelated feature internals", () => {
	const rules: ReadonlyArray<{
		dir: (typeof FEATURE_DIRS)[number];
		forbidden: RegExp[];
	}> = [
		{
			dir: "auth",
			forbidden: [
				/^storage\//,
				/^chat\//,
				/^billing\//,
				/^email\/providers\//,
				/^email-node\//,
			],
		},
		{
			dir: "storage",
			forbidden: [/^auth\/local\//, /^chat\//],
		},
		{
			dir: "chat",
			forbidden: [/^auth\/local\//, /^storage\//],
		},
		{
			dir: "billing",
			forbidden: [/^auth\/local\//, /^storage\//, /^chat\//, /^admin\//],
		},
		{
			dir: "admin",
			forbidden: [/^storage\/local/, /^chat\//, /^billing\//],
		},
		{
			dir: "db",
			forbidden: [/^auth\/local\//, /^storage\/local/, /^chat\//, /^billing\//],
		},
		{
			dir: "email",
			forbidden: [
				/^auth\//,
				/^storage\//,
				/^chat\//,
				/^billing\//,
				/^postgres\//,
			],
		},
	];

	const offenders: string[] = [];
	for (const rule of rules) {
		const dir = join(srcRoot, rule.dir);
		for (const file of listTsFiles(dir)) {
			const source = readFileSync(file, "utf8");
			for (const specifier of staticSpecifiers(source)) {
				const resolved = resolveRelativeSpecifier(file, specifier);
				if (!resolved) {
					continue;
				}
				const rel = posixRel(srcRoot, resolved);
				for (const pattern of rule.forbidden) {
					if (pattern.test(rel)) {
						offenders.push(
							`${posixRel(srcRoot, file)} → ${rel}`
						);
					}
				}
			}
		}
	}
	assert.deepEqual(offenders, []);
});

test("P1: src/client/** may import feature modules; auth/storage/chat/billing/db/admin/email must not import the public façade", () => {
	assert.equal(existsSync(createClientTs), true);
	assert.equal(existsSync(contextTs), true);

	for (const file of [createClientTs, contextTs, facadeTs]) {
		if (!existsSync(file)) {
			continue;
		}
		assert.equal(
			importsResolvedFile(file, v3NodeTs),
			false,
			`${posixRel(srcRoot, file)} must not import Node v3-client.ts`
		);
	}

	const offenders: string[] = [];
	for (const dirName of FEATURE_DIRS) {
		offenders.push(
			...facadeImportOffenders(join(srcRoot, dirName), PUBLIC_FACADE_FILES)
		);
	}
	assert.deepEqual(
		offenders,
		[],
		"feature modules must not import client.ts / v3-client-core.ts / v3-client.ts"
	);
});

test("P1: browser-safe construction paths must not import pg, node:fs, or server-only", () => {
	const browserSafe = [
		join(srcRoot, "browser.ts"),
		v3CoreTs,
		createClientTs,
		contextTs,
	];
	for (const file of browserSafe) {
		assert.equal(existsSync(file), true, `missing ${posixRel(srcRoot, file)}`);
		const source = readFileSync(file, "utf8");
		assert.equal(
			mentionsForbiddenRuntime(source),
			false,
			`${posixRel(srcRoot, file)} must stay off the Node/pg graph`
		);
	}

	const browser = readSrc("browser.ts");
	assert.equal(browser.includes('from "./v3-client.ts"'), false);
	const node = readSrc("v3-client.ts");
	assert.equal(node.includes("pg"), true);
});

test("P2: modules consume AthenaClientRuntimeContext / InternalAthenaClientCore rather than AthenaClient", () => {
	const contextSource = readIfExists(contextTs);
	assert.ok(
		contextSource.includes("AthenaClientRuntimeContext") ||
			/export (?:interface|type) InternalAthenaClientCore/.test(
				contextSource
			)
	);

	const v3Core = readSrc("v3-client-core.ts");
	const importsContext =
		v3Core.includes('from "./client/context.ts"') ||
		v3Core.includes('from "./client/context.js"') ||
		v3Core.includes('from "./client/create-client.ts"') ||
		v3Core.includes('from "./client/create-client.js"');
	assert.equal(
		importsContext,
		true,
		"v3-client-core.ts must compose src/client/context.ts or create-client.ts"
	);
	assert.equal(
		/from ["']\.\/client\.ts["']/.test(v3Core) &&
			v3Core.includes("createInternalClientCore"),
		false,
		"v3-client-core.ts must not value-import factories from the public client.ts façade"
	);

	const readQuery = readSrc("query/read-query.ts");
	assert.equal(readQuery.includes("import type { AthenaClient }"), false);
	assert.match(readQuery, /AthenaReadQueryClient/);
});

test("INV-CLIENT-001: one canonical createClient; no public create*Client peers", () => {
	assert.equal(typeof rootBarrel.createClient, "function");
	assert.equal("createAuthClient" in rootBarrel, false);
	assert.equal("createDbClient" in rootBarrel, false);
	assert.equal("createStorageClient" in rootBarrel, false);
	assert.equal("createTypedClient" in rootBarrel, false);
	assert.equal("AthenaClient" in rootBarrel, false);

	const browserSrc = readSrc("browser.ts");
	const serverSrc = readSrc("server.ts");
	for (const peer of [
		"createAuthClient",
		"createDbClient",
		"createStorageClient",
	] as const) {
		assert.equal(browserSrc.includes(`export function ${peer}`), false);
		assert.equal(serverSrc.includes(`export function ${peer}`), false);
	}
});

test("INV-OWNERSHIP-002: request-view-omits-close (runtime + brands)", async () => {
	const brands = readSrc("client-brands.ts");
	assert.match(
		brands,
		/export type AthenaRequestClient<TClient> = Omit<TClient, "close">/
	);
	assert.equal(brands.includes("athenaRootClientBrand"), true);
	assert.equal(brands.includes("athenaRequestClientBrand"), true);

	const root = gatewayClient();
	const view = root.withContext({ userId: "decomposition-target" });
	const viewInternals = getAthenaClientInternals(view);
	const rootInternals = getAthenaClientInternals(root);

	assert.equal(rootInternals?.ownership, "root");
	assert.equal(viewInternals?.ownership, "request");
	assert.equal(viewInternals?.close, undefined);
	assert.equal(typeof root.close, "function");

	await assert.rejects(
		() => (view as unknown as { close: () => Promise<void> }).close(),
		(error: unknown) => {
			assert.ok(error instanceof AthenaRuntimeOwnershipError);
			assert.equal(error.code, "ATHENA_RUNTIME_OWNERSHIP_INVALID");
			return true;
		}
	);
});

test("INV-API-005: barrels still expose createClient, namespaces, and from/select/where types", () => {
	assert.equal(typeof rootBarrel.createClient, "function");

	const indexSrc = readSrc("index.ts");
	assert.match(indexSrc, /createClient/);
	assert.match(indexSrc, /TableQueryBuilder/);
	assert.match(indexSrc, /AthenaFromOptions/);
	const browserSrc = readSrc("browser.ts");
	assert.match(browserSrc, /TableQueryBuilder[\s\S]*from "\.\/client\.js"/);
	assert.match(browserSrc, /createClient/);

	const client = gatewayClient();
	assert.equal(typeof client.db, "object");
	assert.equal(typeof client.auth, "object");
	assert.equal(typeof client.storage, "object");
	assert.equal(typeof client.admin, "object");
	assert.equal(typeof client.chat, "object");
	assert.equal(typeof client.from, "function");

	const builder = client.from("users");
	assert.equal(typeof builder.select, "function");
	assert.equal(typeof builder.eq, "function");
	const selected = builder.select("*");
	assert.equal(typeof selected.eq, "function");
});

test("INV-RUNTIME-004: universal spine does not import pg or v3-client.ts", () => {
	const v3Core = readSrc("v3-client-core.ts");
	assert.equal(v3Core.includes('from "pg"'), false);
	assert.equal(v3Core.includes("from \"./postgres"), false);
	assert.equal(v3Core.includes('from "./v3-client.ts"'), false);
	assert.equal(v3Core.includes("server-only"), false);

	const browser = readSrc("browser.ts");
	assert.equal(browser.includes('from "./v3-client.ts"'), false);
	assert.equal(browser.includes('from "pg"'), false);
});

test("INV-QUERY-003: fluent pipeline is not extracted this slice; canonical IR stays under src/query/", () => {
	assert.equal(existsSync(join(srcRoot, "query", "descriptor.ts")), true);
	assert.equal(existsSync(join(srcRoot, "query", "engine", "plan.ts")), true);
	assert.equal(existsSync(join(srcRoot, "auxiliaries.ts")), true);
	assert.equal(existsSync(join(srcRoot, "db", "transaction", "index.ts")), true);
	const clientSource = readSrc("client.ts");
	void clientSource;
	assert.ok(
		true,
		"this slice must not require a smaller client.ts file-count metric"
	);
});
