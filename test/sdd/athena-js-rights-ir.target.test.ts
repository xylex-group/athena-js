/**
 * Target: Athena JS Rights IR first milestone DESIRED behavior.
 * GREEN after branded AthenaRightKey kernel + ./rights + principal brand.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-rights-ir.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-rights-ir/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseApiKey } from "../../src/cli/commands/api-key/index.ts";
import { parse as parseRightsCli } from "../../src/cli/commands/rights/index.ts";
import { createGatewayApiKey } from "../../src/cli/gateway-admin.ts";
import * as rootBarrel from "../../src/index.ts";
import { matchPolicyPrincipal } from "../../src/policy/match-principal.ts";
import {
	ATHENA_MALFORMED_RIGHTS_KIND,
	anonymousAthenaPrincipal,
	normalizeAthenaPrincipal,
	subscribeAthenaMalformedRightsDiagnostics,
} from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");
const rightsSrcDir = join(srcRoot, "rights");
const fixturesRightsDir = join(pkgRoot, "test", "fixtures", "rights");
const rustRightsSrc = join(repoRoot, "crates", "athena-rights", "src");

const RIGHTS_LAYOUT = [
	"key.ts",
	"errors.ts",
	"descriptor.ts",
	"matching.ts",
	"catalog.ts",
	"index.ts",
] as const;

const PUBLIC_RIGHTS_RUNTIME = [
	"parseAthenaRightKey",
	"tryParseAthenaRightKey",
	"athenaRightKeyString",
	"rightMatches",
	"missingRequiredRights",
	"AthenaRightKeyError",
] as const;

const PUBLIC_RIGHTS_TYPES = [
	"AthenaRightKey",
	"AthenaRightKeyErrorCode",
	"AthenaRightDescriptor",
] as const;

const FORBIDDEN_PUBLIC_NAMES = [
	"AthenaRightsClient",
	"RightsRuntime",
	"PermissionClient",
	"AthenaRightsService",
	"AthenaGrant",
	"AthenaRightsIr",
	"AthenaRightRequirement",
	"nativeRightsCatalog",
	"createRightsClient",
	"NATIVE_RIGHTS",
] as const;

const REQUIRED_PARSE_CASES = [
	{ canonical: "gateway.query", input: "gateway.query", ok: true },
	{ canonical: "payment-link.paid", input: "  payment-link.paid  ", ok: true },
	{ canonical: "{resource}.read", input: "{resource}.read", ok: true },
	{ canonical: "*", input: "*", ok: true },
	{ error: "RIGHT_KEY_EMPTY", input: "   ", ok: false },
	{
		error: "RIGHT_KEY_INVALID_CHARACTERS",
		input: "gateway .query",
		ok: false,
	},
	{ error: "RIGHT_KEY_EMPTY_SEGMENT", input: "gateway..query", ok: false },
	{ error: "RIGHT_KEY_MALFORMED_PATTERN", input: "{}.read", ok: false },
	{ error: "RIGHT_KEY_INVALID_CHARACTERS", input: "admin:read", ok: false },
] as const;

const REQUIRED_MATCH_CASES = [
	{ granted: "users.read", matches: true, required: "users.read" },
	{ granted: "users.*", matches: true, required: "users.read" },
	{ granted: "*.read", matches: true, required: "users.read" },
	{ granted: "gateway.read", matches: true, required: "users.read" },
	{ granted: "gateway.*", matches: true, required: "users.delete" },
	{ granted: "*", matches: true, required: "users.read" },
	{ granted: "users.write", matches: false, required: "users.read" },
	{ granted: "tickets.read", matches: false, required: "users.read" },
] as const;

type PackageJsonShape = {
	exports?: Record<string, unknown>;
	typesVersions?: Record<string, Record<string, unknown>>;
};

type RightsModule = {
	AthenaRightKeyError?: new (
		...args: never[]
	) => Error & { code?: string };
	athenaRightKeyString?: (key: unknown) => string;
	missingRequiredRights?: (
		granted: readonly unknown[],
		required: readonly unknown[],
	) => unknown[];
	parseAthenaRightKey?: (raw: string) => unknown;
	rightMatches?: (granted: unknown, required: unknown) => boolean;
	tryParseAthenaRightKey?: (raw: string) => unknown;
};

type KeyParseFixtureCase = {
	canonical?: string;
	error?: string;
	input: string;
	isPattern?: boolean;
	ok: boolean;
};

type MatchingFixtureCase = {
	granted: string;
	matches: boolean;
	required: string;
};

function readPkgRel(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
			continue;
		}
		if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

function joinedSources(dir: string): string {
	return collectTsFiles(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
}

function loadPackageJson(): PackageJsonShape {
	return JSON.parse(readPkgRel("package.json")) as PackageJsonShape;
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return "";
}

function assertFunction(
	mod: RightsModule,
	name: keyof RightsModule,
): (...args: never[]) => unknown {
	const value = mod[name];
	assert.equal(typeof value, "function", `${String(name)} must be a function`);
	return value as (...args: never[]) => unknown;
}

async function importRights(): Promise<RightsModule> {
	const barrelPath = join(rightsSrcDir, "index.ts");
	assert.equal(existsSync(barrelPath), true, "src/rights/index.ts must exist");
	return (await import(pathToFileURL(barrelPath).href)) as RightsModule;
}

function loadJson(relFromPkg: string): unknown {
	const path = join(pkgRoot, relFromPkg);
	assert.equal(existsSync(path), true, `${relFromPkg} must exist`);
	return JSON.parse(readFileSync(path, "utf8"));
}

function rightsImportSpecifiers(): string[] {
	const specifiers: string[] = [];
	const importRe =
		/(?:from|import)\s+["']([^"']+)["']/g;
	for (const file of collectTsFiles(rightsSrcDir)) {
		const src = readFileSync(file, "utf8");
		let match = importRe.exec(src);
		while (match) {
			const specifier = match[1];
			if (specifier) {
				specifiers.push(specifier);
			}
			match = importRe.exec(src);
		}
	}
	return specifiers;
}

test("T-RIR-LAYOUT: P?: src/rights/{key,errors,descriptor,matching,catalog,index}.ts exist", () => {
	assert.equal(existsSync(rightsSrcDir), true, "src/rights/ must exist");
	for (const file of RIGHTS_LAYOUT) {
		assert.equal(
			existsSync(join(rightsSrcDir, file)),
			true,
			`src/rights/${file} must exist`,
		);
	}
});

test("T-RIR-KEY: P?: AthenaRightKey exists", () => {
	const keyPath = join(rightsSrcDir, "key.ts");
	assert.equal(existsSync(keyPath), true, "src/rights/key.ts must exist");
	const keySrc = readFileSync(keyPath, "utf8");
	assert.match(keySrc, /athenaRightKeyBrand:\s*unique symbol/);
	assert.match(
		keySrc,
		/export type AthenaRightKey\s*=\s*string\s*&\s*\{/,
	);
	assert.match(keySrc, /readonly \[athenaRightKeyBrand\]:\s*true/);
	assert.equal(
		/export type AthenaRightKey\s*=\s*string\s*;/.test(keySrc),
		false,
		"AthenaRightKey must not be an unbranded string alias",
	);
	assert.equal(
		/type AthenaRight\s*=\s*string/.test(keySrc),
		false,
		"Do not type AthenaRight = string",
	);
});

test("T-RIR-PARSE-FIXTURE: P?: parser matches Rust (fixture)", async () => {
	const fixturePath = "test/fixtures/rights/key-parsing-v1.json";
	const raw = loadJson(fixturePath) as {
		authority?: string;
		cases?: KeyParseFixtureCase[];
		version?: number;
	};
	assert.equal(raw.authority, "crates/athena-rights");
	assert.equal(raw.version, 1);
	assert.ok(Array.isArray(raw.cases), "key-parsing-v1.json must have cases");
	const cases = raw.cases ?? [];
	for (const required of REQUIRED_PARSE_CASES) {
		const hit = cases.find((item) => item.input === required.input);
		assert.ok(hit, `fixture must include input ${JSON.stringify(required.input)}`);
		assert.equal(hit.ok, required.ok, required.input);
		if (required.ok) {
			assert.equal(hit.canonical, required.canonical, required.input);
		} else {
			assert.equal(hit.error, required.error, required.input);
		}
	}
	const colon = cases.find((item) => item.input === "admin:read");
	assert.ok(colon, "fixture must include admin:read");
	assert.equal(colon.ok, false);
	assert.equal(colon.error, "RIGHT_KEY_INVALID_CHARACTERS");
	assert.notEqual(colon.canonical, "admin.read");

	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const tryParse = assertFunction(rights, "tryParseAthenaRightKey");
	const toStringFn = assertFunction(rights, "athenaRightKeyString");

	for (const item of cases) {
		if (item.ok) {
			const parsed = parse(item.input as never);
			assert.equal(String(parsed), item.canonical ?? item.input.trim());
			assert.equal(toStringFn(parsed as never), item.canonical ?? item.input.trim());
			assert.equal(String(tryParse(item.input as never)), String(parsed));
		} else {
			let thrown: unknown;
			try {
				parse(item.input as never);
			} catch (error) {
				thrown = error;
			}
			assert.ok(thrown, `parseAthenaRightKey(${JSON.stringify(item.input)}) must throw`);
			assert.equal(errorCode(thrown), item.error);
			assert.equal(tryParse(item.input as never), undefined);
			assert.notEqual(errorCode(thrown), "missing_right");
			assert.notEqual(errorCode(thrown), "policy_deny");
			assert.notEqual(errorCode(thrown), "deny");
		}
	}
});

test("T-RIR-MATCH-FIXTURE: P?: matcher matches Rust (fixture)", async () => {
	const raw = loadJson("test/fixtures/rights/matching-v1.json") as {
		authority?: string;
		cases?: MatchingFixtureCase[];
		version?: number;
	};
	assert.equal(raw.authority, "crates/athena-rights");
	assert.equal(raw.version, 1);
	assert.ok(Array.isArray(raw.cases), "matching-v1.json must have cases");
	const cases = raw.cases ?? [];
	for (const required of REQUIRED_MATCH_CASES) {
		const hit = cases.find(
			(item) =>
				item.granted === required.granted && item.required === required.required,
		);
		assert.ok(
			hit,
			`fixture must include ${required.granted} → ${required.required}`,
		);
		assert.equal(hit.matches, required.matches);
	}

	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const matches = assertFunction(rights, "rightMatches");

	for (const item of cases) {
		const granted = parse(item.granted as never);
		const required = parse(item.required as never);
		assert.equal(
			matches(granted as never, required as never),
			item.matches,
			`${item.granted} → ${item.required}`,
		);
	}

	const matchingSrc = readFileSync(join(rightsSrcDir, "matching.ts"), "utf8");
	assert.equal(
		/rightMatches\s*\(\s*granted:\s*string/.test(matchingSrc),
		false,
		"rightMatches must not accept unparsed string at the domain boundary",
	);
	assert.match(
		matchingSrc,
		/rightMatches\s*\(\s*granted:\s*AthenaRightKey/,
	);
});

test("T-RIR-DESCRIPTOR: P?: AthenaRightDescriptor exists", () => {
	const descriptorPath = join(rightsSrcDir, "descriptor.ts");
	assert.equal(
		existsSync(descriptorPath),
		true,
		"src/rights/descriptor.ts must exist",
	);
	const src = readFileSync(descriptorPath, "utf8");
	assert.match(src, /export type AthenaRightDescriptor/);
	assert.match(src, /\bkey:\s*AthenaRightKey/);
	assert.match(src, /\bresource:\s*string/);
	assert.match(src, /\baction:\s*string/);
	assert.match(src, /\bdescription:\s*string/);
	assert.match(src, /\bsource:\s*string/);
	assert.match(src, /\bkind:\s*string/);
	assert.match(src, /\bisPattern:\s*boolean/);
	assert.equal(
		/resource\s*=\s*key\.split\(/.test(src),
		false,
		"Do not reconstruct descriptor.resource purely from string syntax",
	);
});

test("T-RIR-NO-NATIVE-CATALOG: P?: no TS-native catalog", () => {
	assert.equal(existsSync(rightsSrcDir), true, "src/rights/ must exist");
	const blob = `${joinedSources(rightsSrcDir)}\n${readPkgRel("src/index.ts")}`;
	assert.equal(/\bNATIVE_RIGHTS\b/.test(blob), false);
	assert.equal(/\bnativeRightsCatalog\b/.test(blob), false);
	assert.equal(
		/const\s+NATIVE_RIGHTS\s*=\s*\[/.test(blob),
		false,
	);
	const catalogPath = join(rightsSrcDir, "catalog.ts");
	assert.equal(existsSync(catalogPath), true);
	const catalogSrc = readFileSync(catalogPath, "utf8");
	assert.equal(/\bgateway_right_catalog\b/.test(catalogSrc), false);
	assert.equal(/\bbilling_right_catalog\b/.test(catalogSrc), false);
	assert.equal(
		/key:\s*"gateway\.query"[\s\S]*resource:\s*"gateway"/.test(catalogSrc),
		false,
		"catalog.ts must not hard-code native descriptor tables",
	);
});

test("T-RIR-BROWSER-SAFE: P?: /rights browser-safe", async () => {
	assert.equal(existsSync(rightsSrcDir), true, "src/rights/ must exist");
	const blob = joinedSources(rightsSrcDir);
	assert.equal(/\bnode:fs\b/.test(blob), false);
	assert.equal(/\bnode:crypto\b/.test(blob), false);
	assert.equal(/\bprocess\.env\b/.test(blob), false);
	assert.equal(/\bsecret/i.test(blob), false);
	assert.equal(/\bATHENA_ADMIN_KEY\b/.test(blob), false);
	const rights = await importRights();
	assert.equal(typeof rights.parseAthenaRightKey, "function");
	const parse = assertFunction(rights, "parseAthenaRightKey");
	assert.equal(String(parse("gateway.query" as never)), "gateway.query");
});

test("T-RIR-PRINCIPAL-KEYS: P?: Principal.rights is AthenaRightKey[]", () => {
	const principalSrc = readPkgRel("src/runtime/data/principal.ts");
	assert.match(principalSrc, /rights:\s*readonly AthenaRightKey\[\]/);
	assert.equal(
		/rights:\s*readonly string\[\]/.test(principalSrc),
		false,
		"canonical AthenaPrincipal.rights must not remain string[]",
	);
	assert.match(principalSrc, /from ["'].*rights/);
});

test("T-RIR-WIRE-STRINGS: P?: Principal wire/session still accepts string JSON", async () => {
	const principalSrc = readPkgRel("src/runtime/data/principal.ts");
	assert.match(principalSrc, /export type AthenaPrincipalInput/);
	assert.match(
		principalSrc,
		/rights\?:\s*readonly string\[\]/,
	);
	assert.match(
		principalSrc,
		/user:\s*\{[\s\S]*rights\?:\s*readonly string\[\]/,
	);
	assert.match(principalSrc, /parseAthenaRightKey|tryParseAthenaRightKey/);

	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const normalized = normalizeAthenaPrincipal({
		authenticated: true,
		grants: ["legacy-grant"],
		rights: ["users.read"],
	} as never);
	assert.equal(normalized.rights.length, 1);
	assert.equal(String(normalized.rights[0]), "users.read");
	assert.equal(
		String(normalized.rights[0]),
		String(parse("users.read" as never)),
	);
	assert.deepEqual([...normalized.grants], ["legacy-grant"]);
});

test("T-RIR-GRANTS-SEPARATE: P?: grants semantically separate, never satisfy right checks", async () => {
	const principalSrc = readPkgRel("src/runtime/data/principal.ts");
	assert.match(principalSrc, /grants:\s*readonly string\[\]/);
	assert.match(principalSrc, /legacy provenance/i);
	assert.match(principalSrc, /never used to satisfy/i);

	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const matches = assertFunction(rights, "rightMatches");
	const principal = normalizeAthenaPrincipal({
		authenticated: true,
		grants: ["users.read"],
		rights: [],
	} as never);
	assert.deepEqual([...principal.grants], ["users.read"]);
	assert.deepEqual([...principal.rights], []);
	const required = parse("users.read" as never);
	const grantedHits = principal.rights.some((key) =>
		Boolean(matches(key as never, required as never)),
	);
	assert.equal(
		grantedHits,
		false,
		"grants must never be unioned into Right checks",
	);
	assert.equal(
		matchPolicyPrincipal({ kind: "permission", name: "users.read" }, principal),
		false,
	);
});

test("T-RIR-INVALID-DROP: P?: invalid Rights never confer authority", () => {
	const originalWarn = console.warn;
	console.warn = () => undefined;
	try {
		const normalized = normalizeAthenaPrincipal({
			authenticated: true,
			grants: ["users.delete"],
			rights: ["admin:read", "users.read", "gateway .query"],
		} as never);
	assert.deepEqual(
		[...normalized.rights].map((key) => String(key)),
		["users.read"],
	);
	assert.equal(
		[...normalized.rights].some((key) => String(key) === "admin:read"),
		false,
	);
	assert.equal(
		[...normalized.rights].some((key) => String(key) === "admin.read"),
		false,
		"invalid colon keys must not be rewritten into dotted authority",
	);
	assert.equal(
		[...normalized.rights].some((key) => String(key).includes(" ")),
		false,
	);
	assert.deepEqual([...normalized.grants], ["users.delete"]);
	assert.equal(
		matchPolicyPrincipal(
			{ kind: "permission", name: "admin:read" },
			normalized,
		),
		false,
		"dropped invalid keys must not confer Policy permission matches",
	);
	assert.equal(
		matchPolicyPrincipal({ kind: "permission", name: "users.read" }, normalized),
		true,
	);
	} finally {
		console.warn = originalWarn;
	}
});

test("T-RIR-MALFORMED-DIAGNOSTIC: P?: dropped Rights emit a safe source+count diagnostic", () => {
	const seen: Array<Record<string, unknown>> = [];
	const unsubscribe = subscribeAthenaMalformedRightsDiagnostics((diagnostic) => {
		seen.push({ ...diagnostic });
	});
	const originalWarn = console.warn;
	const warnings: unknown[] = [];
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};
	try {
		const valid = normalizeAthenaPrincipal({
			authenticated: true,
			rights: ["users.read"],
		});
		assert.deepEqual(
			[...valid.rights].map((key) => String(key)),
			["users.read"],
		);
		assert.equal(seen.length, 0);

		const normalized = normalizeAthenaPrincipal(
			{
				authenticated: true,
				rights: ["admin:read", "users.read", "gateway .query"],
			},
			{ source: "athena-session" },
		);
		assert.deepEqual(
			[...normalized.rights].map((key) => String(key)),
			["users.read"],
		);
		assert.equal(seen.length, 1);
		assert.deepEqual(seen[0], {
			kind: ATHENA_MALFORMED_RIGHTS_KIND,
			malformedKeyCount: 2,
			source: "athena-session",
		});
		const serialized = JSON.stringify(seen[0]);
		assert.equal(serialized.includes("admin:read"), false);
		assert.equal(serialized.includes("gateway .query"), false);
		assert.equal(serialized.includes("users.read"), false);
		assert.equal(Object.hasOwn(seen[0] as object, "keys"), false);
		assert.equal(warnings.length, 1);
	} finally {
		console.warn = originalWarn;
		unsubscribe();
	}
});

test("T-RIR-GATEWAY-CONSUMER: P?: Gateway/API-key one canonical consumer", async () => {
	const apiKeySrc = readPkgRel("src/cli/commands/api-key/index.ts");
	const rightsCliSrc = readPkgRel("src/cli/commands/rights/index.ts");
	const gatewayAdminSrc = readPkgRel("src/cli/gateway-admin.ts");
	assert.match(apiKeySrc, /\bparseAthenaRightKey\b/);
	assert.match(rightsCliSrc, /\bparseAthenaRightKey\b/);
	assert.match(gatewayAdminSrc, /\bparseAthenaRightKey\b/);

	let apiKeyError: unknown;
	try {
		parseApiKey(["create", "--name", "app", "--rights", "admin:read"]);
	} catch (error) {
		apiKeyError = error;
	}
	assert.ok(
		apiKeyError,
		"api-key create --rights admin:read must fail closed (found case: unparsed CSV)",
	);
	assert.equal(errorCode(apiKeyError), "RIGHT_KEY_INVALID_CHARACTERS");
	assert.notEqual(errorCode(apiKeyError), "missing_right");
	assert.notEqual(errorCode(apiKeyError), "policy_deny");

	const validApiKey = parseApiKey([
		"create",
		"--name",
		"app",
		"--rights",
		"gateway.query",
	]);
	assert.equal(validApiKey.command, "api-key-create");
	if (validApiKey.command === "api-key-create") {
		assert.deepEqual(
			[...(validApiKey.rights ?? [])].map((key) => String(key)),
			["gateway.query"],
		);
	}

	let rightsError: unknown;
	try {
		parseRightsCli(["create", "--name", "admin:read"]);
	} catch (error) {
		rightsError = error;
	}
	assert.ok(
		rightsError,
		"rights create --name admin:read must fail closed (found case: raw name string)",
	);
	assert.equal(errorCode(rightsError), "RIGHT_KEY_INVALID_CHARACTERS");

	let fetchCalled = false;
	let gatewayError: unknown;
	try {
		await createGatewayApiKey({
			adminKey: "test-admin-key",
			baseUrl: "https://gateway.test",
			fetchImpl: async () => {
				fetchCalled = true;
				return new Response(JSON.stringify({ data: {} }), { status: 200 });
			},
			input: { name: "app", rights: ["admin:read"] },
		});
	} catch (error) {
		gatewayError = error;
	}
	assert.ok(
		gatewayError,
		"createGatewayApiKey must not send unparsed admin:read",
	);
	assert.equal(fetchCalled, false);
	assert.equal(errorCode(gatewayError), "RIGHT_KEY_INVALID_CHARACTERS");
});

test("T-RIR-ACT: P?: ACT prevents catalog duplication and stringly matcher at domain boundary", () => {
	assert.equal(existsSync(join(rightsSrcDir, "matching.ts")), true);
	const matchingSrc = readFileSync(join(rightsSrcDir, "matching.ts"), "utf8");
	assert.match(
		matchingSrc,
		/export function rightMatches\(\s*granted:\s*AthenaRightKey/,
	);
	assert.match(
		matchingSrc,
		/missingRequiredRights\(\s*granted:\s*readonly AthenaRightKey\[\]/,
	);
	assert.equal(
		/rightMatches\s*\(\s*granted:\s*(?:string|AthenaRightKey\s*\|\s*string)/.test(
			matchingSrc,
		),
		false,
	);

	const blob = joinedSources(rightsSrcDir);
	assert.equal(/\bNATIVE_RIGHTS\b/.test(blob), false);
	assert.equal(/\bnativeRightsCatalog\b/.test(blob), false);

	for (const specifier of rightsImportSpecifiers()) {
		const rel = specifier.replace(/\\/g, "/");
		assert.equal(
			/(^|\/)(billing|auth|storage|cli)(\/|$)/.test(rel),
			false,
			`src/rights must not import ${specifier}`,
		);
	}

	for (const file of collectTsFiles(rightsSrcDir)) {
		const rel = relative(srcRoot, file).replace(/\\/g, "/");
		assert.equal(rel.startsWith("rights/"), true, rel);
	}
});

test("T-RIR-EXPORT: P?: package export map includes ./rights", () => {
	const pkg = loadPackageJson();
	const exportsMap = pkg.exports ?? {};
	assert.equal("./policy" in exportsMap, true);
	assert.equal("./rights" in exportsMap, true, "exports must include ./rights");
	assert.equal(readPkgRel("package.json").includes('"./rights"'), true);

	const tsup = readPkgRel("tsup.config.ts");
	assert.match(tsup, /rights:\s*"src\/rights\/index\.ts"/);

	const typesStar = pkg.typesVersions?.["*"] ?? {};
	assert.equal("rights" in typesStar, true, "typesVersions must include rights");
});

test("T-RIR-SYMBOL-BUDGET: P?: public ./rights symbol budget is closed", async () => {
	const barrelPath = join(rightsSrcDir, "index.ts");
	assert.equal(existsSync(barrelPath), true);
	const barrel = readFileSync(barrelPath, "utf8");
	for (const name of FORBIDDEN_PUBLIC_NAMES) {
		assert.equal(
			barrel.includes(name),
			false,
			`./rights must not publish ${name}`,
		);
	}
	for (const name of [...PUBLIC_RIGHTS_RUNTIME, ...PUBLIC_RIGHTS_TYPES]) {
		assert.match(barrel, new RegExp(`\\b${name}\\b`), name);
	}

	const rights = await importRights();
	for (const name of PUBLIC_RIGHTS_RUNTIME) {
		assert.equal(name in rights, true, `runtime export missing: ${name}`);
	}
	for (const name of FORBIDDEN_PUBLIC_NAMES) {
		assert.equal(name in rights, false, `forbidden runtime export: ${name}`);
	}
	assert.equal("createRightsClient" in rootBarrel, false);
	assert.equal("AthenaRightsClient" in rootBarrel, false);
});

test("T-RIR-NO-CTOR: P?: no createRightsClient", () => {
	const blob = joinedSources(srcRoot);
	assert.equal(/\bcreateRightsClient\b/.test(blob), false);
	assert.equal(/\bAthenaRightsClient\b/.test(blob), false);
	assert.equal("createRightsClient" in rootBarrel, false);
	assert.equal(typeof rootBarrel.createClient, "function");
});

test("T-RIR-NO-COLON-DOT: P?: admin:read does not become admin.read", async () => {
	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const tryParse = assertFunction(rights, "tryParseAthenaRightKey");
	let thrown: unknown;
	try {
		parse("admin:read" as never);
	} catch (error) {
		thrown = error;
	}
	assert.ok(thrown, "admin:read must be rejected");
	assert.equal(errorCode(thrown), "RIGHT_KEY_INVALID_CHARACTERS");
	assert.equal(tryParse("admin:read" as never), undefined);
	assert.notEqual(String(thrown), "admin.read");
	if (thrown && typeof thrown === "object" && "key" in thrown) {
		assert.notEqual(String((thrown as { key: unknown }).key), "admin.read");
	}
});

test("T-RIR-MISSING: P?: missingRequiredRights returns uncovered required keys", async () => {
	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const missing = assertFunction(rights, "missingRequiredRights");
	const granted = ["users.*", "gateway.query"].map((key) =>
		parse(key as never),
	);
	const required = [
		"users.read",
		"users.write",
		"tickets.read",
		"gateway.query",
	].map((key) => parse(key as never));
	const uncovered = missing(granted as never, required as never);
	assert.deepEqual(
		uncovered.map((key) => String(key)),
		["tickets.read"],
	);
});

test("T-RIR-ERRORS: P?: parse errors map Rust RightKeyError codes", async () => {
	const errorsPath = join(rightsSrcDir, "errors.ts");
	assert.equal(existsSync(errorsPath), true, "src/rights/errors.ts must exist");
	const errorsSrc = readFileSync(errorsPath, "utf8");
	assert.match(errorsSrc, /export type AthenaRightKeyErrorCode/);
	assert.match(errorsSrc, /RIGHT_KEY_EMPTY/);
	assert.match(errorsSrc, /RIGHT_KEY_INVALID_CHARACTERS/);
	assert.match(errorsSrc, /RIGHT_KEY_EMPTY_SEGMENT/);
	assert.match(errorsSrc, /RIGHT_KEY_MALFORMED_PATTERN/);
	assert.equal(/\bmissing_right\b/.test(errorsSrc), false);
	assert.equal(/\bpolicy_deny\b/.test(errorsSrc), false);
	assert.match(errorsSrc, /export class AthenaRightKeyError extends Error/);

	const rights = await importRights();
	const parse = assertFunction(rights, "parseAthenaRightKey");
	const ErrorCtor = rights.AthenaRightKeyError;
	assert.equal(typeof ErrorCtor, "function");

	const samples: Array<{ code: string; input: string }> = [
		{ code: "RIGHT_KEY_EMPTY", input: "   " },
		{ code: "RIGHT_KEY_INVALID_CHARACTERS", input: "gateway .query" },
		{ code: "RIGHT_KEY_EMPTY_SEGMENT", input: "gateway..query" },
		{ code: "RIGHT_KEY_MALFORMED_PATTERN", input: "{}.read" },
	];
	for (const sample of samples) {
		let thrown: unknown;
		try {
			parse(sample.input as never);
		} catch (error) {
			thrown = error;
		}
		assert.ok(thrown, sample.input);
		assert.equal(errorCode(thrown), sample.code);
		if (ErrorCtor) {
			assert.equal(thrown instanceof ErrorCtor, true, sample.input);
		}
		assert.notEqual(errorCode(thrown), "deny");
		assert.notEqual(errorCode(thrown), "missing_right");
		assert.notEqual(errorCode(thrown), "policy_deny");
	}
});

test("T-RIR-DESCRIPTORS-FIXTURE: P?: descriptors-v1.json is generated from Rust and never hand-authored as a TS table", () => {
	const fixturePath = "test/fixtures/rights/descriptors-v1.json";
	const raw = loadJson(fixturePath) as {
		authority?: string;
		descriptors?: Array<{
			action?: string;
			isPattern?: boolean;
			key?: string;
			kind?: string;
			resource?: string;
			source?: string;
		}>;
		version?: number;
	};
	assert.equal(raw.authority, "crates/athena-rights");
	assert.equal(raw.version, 1);
	assert.ok(Array.isArray(raw.descriptors));
	const descriptors = raw.descriptors ?? [];
	assert.ok(descriptors.length > 0, "descriptors-v1.json must not be empty");
	const rpc = descriptors.find((item) => item.key === "gateway.rpc.execute");
	assert.ok(rpc, "fixture must include gateway.rpc.execute from Rust catalog");
	assert.equal(
		rpc.resource,
		"gateway.rpc",
		"descriptor.resource is catalog metadata, not the first dotted segment",
	);

	assert.ok(
		existsSync(join(rustRightsSrc, "lib.rs")),
		"crates/athena-rights remains catalog authority",
	);
	const libRs = readFileSync(join(rustRightsSrc, "lib.rs"), "utf8");
	assert.match(libRs, /fn native_right_catalog|fn gateway_right_catalog/);

	const crateRoot = join(repoRoot, "crates", "athena-rights");
	function collectRustFiles(dir: string): string[] {
		const out: string[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				out.push(...collectRustFiles(full));
				continue;
			}
			if (entry.name.endsWith(".rs")) {
				out.push(full);
			}
		}
		return out;
	}
	const rustSources = collectRustFiles(crateRoot)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.match(
		rustSources,
		/key-parsing-v1\.json|descriptors-v1\.json|matching-v1\.json/,
		"cargo test -p athena-rights must own the checked-in fixture bytes",
	);
});

test("T-RIR-POLICY-IR: P?: Policy IR matcher file still exists (no fork this slice)", () => {
	const matchPrincipalPath = join(srcRoot, "policy", "match-principal.ts");
	assert.equal(existsSync(matchPrincipalPath), true);
	const matchSrc = readFileSync(matchPrincipalPath, "utf8");
	assert.match(matchSrc, /sensitivity:\s*"accent"/);
	assert.match(matchSrc, /listHas\(principal\.rights/);
	assert.equal(/\bcreatePolicyClient\b/.test(joinedSources(srcRoot)), false);
	assert.equal(
		/\bexport (?:class|function|type|interface) PolicyClient\b/.test(
			joinedSources(join(srcRoot, "policy")),
		),
		false,
	);
});

test("T-RIR-NO-NUCLEUS-EXPORT: P?: Data Nucleus is not a public package export", () => {
	const pkg = loadPackageJson();
	const exportKeys = Object.keys(pkg.exports ?? {});
	assert.equal(
		exportKeys.some((key) => key.includes("nucleus")),
		false,
	);
	assert.equal("./runtime" in (pkg.exports ?? {}), true);
	assert.equal(existsSync(join(srcRoot, "runtime", "data", "nucleus")), true);
});

test("T-RIR-RUST-AUTHORITY: P?: crates/athena-rights remains catalog authority", () => {
	assert.equal(existsSync(join(rustRightsSrc, "key.rs")), true);
	assert.equal(existsSync(join(rustRightsSrc, "matching.rs")), true);
	assert.equal(existsSync(join(rustRightsSrc, "lib.rs")), true);
	assert.equal(existsSync(join(rustRightsSrc, "catalog.rs")), true);
	const keyRs = readFileSync(join(rustRightsSrc, "key.rs"), "utf8");
	assert.match(keyRs, /impl AthenaRightKey/);
	const matchingRs = readFileSync(join(rustRightsSrc, "matching.rs"), "utf8");
	assert.match(matchingRs, /fn right_matches/);
	const libRs = readFileSync(join(rustRightsSrc, "lib.rs"), "utf8");
	assert.match(libRs, /fn native_right_catalog/);
});

test("T-RIR-ANONYMOUS: P?: anonymous principal remains empty frozen rights and grants", () => {
	const anonymous = anonymousAthenaPrincipal();
	assert.deepEqual([...anonymous.rights], []);
	assert.deepEqual([...anonymous.grants], []);
});
