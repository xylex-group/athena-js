/**
 * Target: Athena JS Runtime Plan Phases 0–4 DESIRED behavior.
 * GREEN after plan pipeline + materializers + identity kinds.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-runtime-plan.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-runtime-plan/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as rootBarrel from "../../src/index.ts";
import * as runtimeBarrel from "../../src/runtime/index.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const runtimeRoot = join(srcRoot, "runtime");
const planDir = join(runtimeRoot, "plan");
const materializersDir = join(runtimeRoot, "materializers");

const PLAN_FILES = [
	"types.ts",
	"normalize.ts",
	"resolve.ts",
	"validate.ts",
	"materialize.ts",
] as const;

const MATERIALIZER_FILES = [
	"database.ts",
	"storage.ts",
	"auth.ts",
	"chat.ts",
	"billing.ts",
] as const;

const PIPELINE_EXPORTS = [
	"resolveRuntimePlan",
	"validateRuntimePlan",
	"materializeRuntimePlan",
] as const;

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
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

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return "";
}

function isPlanConflictError(error: unknown): boolean {
	const code = errorCode(error);
	const message = error instanceof Error ? error.message : String(error);
	return (
		code === "ATHENA_RUNTIME_CONFIG_INVALID" ||
		/PLAN|CONFLICT|INVALID/i.test(code) ||
		/conflict|local.*url|plan valid/i.test(message)
	);
}

function importSpecifier(source: string, specifier: string): boolean {
	const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`(?:from|import)\\s+["']${escaped}["']`,
	).test(source);
}

test("P?: SPEC, PHASE-0-FREEZE, dual-suite spec, Draft ADR 0049, and package Draft ADR 0029 exist", () => {
	const paths = [
		join(repoRoot, "docs", "sdd", "xylex", "athena-js-runtime-plan", "SPEC.md"),
		join(
			repoRoot,
			"docs",
			"sdd",
			"xylex",
			"athena-js-runtime-plan",
			"PHASE-0-FREEZE.md",
		),
		join(
			repoRoot,
			"docs",
			"sdd",
			"xylex",
			"athena-js-runtime-plan",
			"dual-suite",
			"dual-suite-spec.md",
		),
		join(
			repoRoot,
			"docs",
			"adr",
			"technical",
			"0049-athena-js-runtime-plan.md",
		),
		join(
			pkgRoot,
			"docs",
			"adr",
			"0029-runtime-plan-and-materializers.md",
		),
	];
	for (const path of paths) {
		assert.equal(existsSync(path), true, path);
	}
});

test("P?: Add the required runtime-plan freeze artifact", () => {
	const freeze = join(
		repoRoot,
		"docs",
		"sdd",
		"xylex",
		"athena-js-runtime-plan",
		"PHASE-0-FREEZE.md",
	);
	assert.equal(
		existsSync(freeze),
		true,
		"PHASE-0-FREEZE.md must be tracked under docs/sdd/xylex/athena-js-runtime-plan/",
	);
	const body = readFileSync(freeze, "utf8");
	assert.match(body, /PHASE-0-FREEZE/);
	assert.match(body, /athena-js-runtime-plan/);
	assert.match(body, /s3_id/);
});

test("P?: src/runtime/plan/{types,normalize,resolve,validate,materialize}.ts exist", () => {
	assert.equal(existsSync(planDir), true, "src/runtime/plan/");
	for (const file of PLAN_FILES) {
		assert.equal(
			existsSync(join(planDir, file)),
			true,
			`src/runtime/plan/${file}`,
		);
	}
});

test("P?: resolveRuntimePlan, validateRuntimePlan, materializeRuntimePlan identifiers exist", async () => {
	const planSources = joinedSources(planDir);
	for (const identifier of PIPELINE_EXPORTS) {
		assert.match(
			planSources,
			new RegExp(`export\\s+(?:async\\s+)?function\\s+${identifier}\\b`),
			identifier,
		);
	}
	assert.match(
		joinedSources(planDir),
		/export\s+(?:async\s+)?function\s+normalizeUniversalConfig\b/,
		"normalizeUniversalConfig",
	);

	const resolveMod = (await import(
		pathToFileURL(join(planDir, "resolve.ts")).href
	)) as Record<string, unknown>;
	const validateMod = (await import(
		pathToFileURL(join(planDir, "validate.ts")).href
	)) as Record<string, unknown>;
	const materializeMod = (await import(
		pathToFileURL(join(planDir, "materialize.ts")).href
	)) as Record<string, unknown>;
	assert.equal(typeof resolveMod.resolveRuntimePlan, "function");
	assert.equal(typeof validateMod.validateRuntimePlan, "function");
	assert.equal(typeof materializeMod.materializeRuntimePlan, "function");

	const v3 = readSrc("v3-client.ts");
	for (const identifier of PIPELINE_EXPORTS) {
		assert.match(v3, new RegExp(`\\b${identifier}\\b`), identifier);
	}
	assert.equal("AthenaRuntimePlan" in runtimeBarrel, false);
	assert.equal("resolveRuntimePlan" in runtimeBarrel, false);
});

test("P?: AthenaRuntimePlan is not a public package export", () => {
	const typesPath = join(planDir, "types.ts");
	assert.equal(existsSync(typesPath), true, "src/runtime/plan/types.ts");
	const typesSrc = readFileSync(typesPath, "utf8");
	assert.match(
		typesSrc,
		/export\s+(?:type|interface)\s+AthenaRuntimePlan\b/,
	);

	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	const exportKeys = Object.keys(pkg.exports ?? {});
	assert.equal(
		exportKeys.some((key) => key.includes("runtime/plan")),
		false,
	);
	assert.equal(JSON.stringify(pkg.exports ?? {}).includes("AthenaRuntimePlan"), false);

	for (const barrel of ["index.ts", "browser.ts"] as const) {
		const src = readSrc(barrel);
		assert.equal(
			/\bexport\s+[\s\S]*\bAthenaRuntimePlan\b/.test(src),
			false,
			barrel,
		);
		assert.equal("AthenaRuntimePlan" in rootBarrel, false);
	}
});

test("P?: conflicting local storage provider and storage.url fail at plan validation", async () => {
	const root = mkdtempSync(join(tmpdir(), "athena-runtime-plan-conflict-"));
	const conflicting = {
		key: "ak_test_runtime_plan",
		storage: {
			provider: "local" as const,
			root,
			url: "https://storage.example.test/managed",
		},
	};

	let constructed: { close?: () => unknown } | undefined;
	let threw = false;
	try {
		constructed = createClient(conflicting);
	} catch (error) {
		threw = true;
		assert.equal(isPlanConflictError(error), true, String(error));
	} finally {
		if (constructed && typeof constructed.close === "function") {
			await constructed.close();
		}
	}
	assert.equal(
		threw,
		true,
		"createClient must fail closed on storage.provider local + storage.url",
	);

	const validatePath = join(planDir, "validate.ts");
	assert.equal(existsSync(validatePath), true, "src/runtime/plan/validate.ts");
	const validateSrc = readFileSync(validatePath, "utf8");
	assert.match(
		validateSrc,
		/export\s+(?:async\s+)?function\s+validateRuntimePlan\b/,
	);

	const resolvePath = join(planDir, "resolve.ts");
	assert.equal(existsSync(resolvePath), true, "src/runtime/plan/resolve.ts");
	const resolveMod = (await import(pathToFileURL(resolvePath).href)) as {
		resolveRuntimePlan?: (config: unknown) => unknown;
	};
	const validateMod = (await import(pathToFileURL(validatePath).href)) as {
		validateRuntimePlan?: (plan: unknown) => unknown;
	};
	assert.equal(typeof resolveMod.resolveRuntimePlan, "function");
	assert.equal(typeof validateMod.validateRuntimePlan, "function");
	const plan = resolveMod.resolveRuntimePlan?.(conflicting);
	let planThrew = false;
	try {
		validateMod.validateRuntimePlan?.(plan);
	} catch (error) {
		planThrew = true;
		assert.equal(isPlanConflictError(error), true, String(error));
	}
	assert.equal(planThrew, true, "validateRuntimePlan must reject local+url");
});

test("P?: src/runtime/materializers/{database,storage,auth,chat,billing}.ts exist", () => {
	assert.equal(existsSync(materializersDir), true, "src/runtime/materializers/");
	for (const file of MATERIALIZER_FILES) {
		assert.equal(
			existsSync(join(materializersDir, file)),
			true,
			`src/runtime/materializers/${file}`,
		);
	}
});

test("P?: v3-client.ts does not import storage/local.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.equal(importSpecifier(v3, "./storage/local.ts"), false);
	assert.equal(/\bcreateLocalStorageModule\b/.test(v3), false);
});

test("P?: v3-client.ts does not import postgres/transport.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.equal(importSpecifier(v3, "./postgres/transport.ts"), false);
	assert.equal(/\bcreatePostgresDirectTransport\b/.test(v3), false);
});

test("P?: v3-client.ts does not import billing local providers", () => {
	const v3 = readSrc("v3-client.ts");
	assert.equal(v3.includes("providers/create-registry"), false);
	assert.equal(importSpecifier(v3, "./billing/runtime/local/providers/create-registry.ts"), false);
	assert.equal(/\bcreateBillingProviderRegistry\b/.test(v3), false);
});

test("P?: v3-client.ts does not import chat/local/database.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.equal(importSpecifier(v3, "./chat/local/database.ts"), false);
	assert.equal(/\bcreateChatDatabaseFromRuntime\b/.test(v3), false);
});

test("P?: AthenaResourceIdentity kinds are relation, storage-object, auth, service", () => {
	const resource = readSrc("schema/resource.ts");
	assert.match(resource, /export\s+type\s+AthenaResourceKind\b/);
	assert.match(resource, /export\s+type\s+AthenaResourceIdentity\b/);
	assert.match(resource, /"relation"/);
	assert.match(resource, /"storage-object"/);
	assert.match(resource, /"auth"/);
	assert.match(resource, /"service"/);
	assert.match(resource, /kind:\s*"relation"/);
	assert.match(resource, /kind:\s*"storage-object"/);
	assert.match(resource, /kind:\s*"auth"/);
	assert.match(resource, /kind:\s*"service"/);
	assert.equal(
		/export\s+type\s+AthenaResourceIdentity\s*=[\s\S]*?\bname\s*[?:]/.test(
			resource,
		),
		false,
		"AthenaResourceIdentity must not grow a generic name field",
	);
	const policyTypes = readSrc("policy/types.ts");
	assert.match(policyTypes, /\bAthenaResourceIdentity\b/);
});

test("P?: Schema IR document does not gain storage-object relations", () => {
	const ir = joinedSources(join(srcRoot, "schema", "ir"));
	assert.match(ir, /kind:\s*"athena\.schema"/);
	assert.match(ir, /\birVersion\b/);
	assert.equal(ir.includes("storage-object"), false);
	assert.equal(/kind:\s*"storage-object"/.test(ir), false);
	const resource = readSrc("schema/resource.ts");
	assert.match(resource, /kind:\s*"storage-object"/);
});

test("P?: Schema IR owns relation identity; Policy IR owns authorization; Data Nucleus owns data execution order", () => {
	const irDir = join(srcRoot, "schema", "ir");
	assert.equal(existsSync(join(irDir, "column.ts")), true);
	assert.equal(existsSync(join(irDir, "relation.ts")), true);
	assert.equal(existsSync(join(irDir, "identity.ts")), true);
	const columnSrc = readSrc("schema/ir/column.ts");
	const relationSrc = readSrc("schema/ir/relation.ts");
	assert.match(columnSrc, /export\s+interface\s+SchemaColumn\b/);
	assert.match(relationSrc, /export\s+interface\s+SchemaRelation\b/);

	const policyTypes = readSrc("policy/types.ts");
	assert.match(policyTypes, /\bAthenaResourceIdentity\b/);
	assert.match(policyTypes, /export\s+type\s+PolicyExpr\b/);
	const policy = joinedSources(join(srcRoot, "policy"));
	assert.equal(/\bexport\s+interface\s+SchemaColumn\b/.test(policy), false);
	assert.equal(/\bexport\s+interface\s+AthenaSchemaIr\b/.test(policy), false);

	const nucleus = joinedSources(join(srcRoot, "runtime", "data", "nucleus"));
	assert.match(nucleus, /AuthorizedDataMutation|brandAuthorizedDataPayload/);
	assert.equal(/\bexport\s+interface\s+AthenaSchemaIr\b/.test(nucleus), false);
	assert.equal(nucleus.includes('kind: "athena.schema"'), false);

	const adapterSources = [
		readSrc("storage/local.ts"),
		readSrc("postgres/transport.ts"),
	].join("\n");
	assert.equal(
		/\bexport\s+function\s+canonicalAthenaResource\b/.test(adapterSources),
		false,
	);
	assert.equal(
		/\bexport\s+type\s+AthenaResourceIdentity\b/.test(adapterSources),
		false,
	);
	assert.match(
		readSrc("schema/resource.ts"),
		/\bcanonicalAthenaResource\b/,
	);
});

test("P?: createClient remains the only consumer constructor", () => {
	assert.equal("createStorageClient" in rootBarrel, false);
	assert.equal("createPolicyClient" in rootBarrel, false);
	assert.equal(typeof rootBarrel.createClient, "function");
	const pkg = readFileSync(join(pkgRoot, "package.json"), "utf8");
	assert.equal(pkg.includes("createStorageClient"), false);
	assert.equal(pkg.includes("createPolicyClient"), false);
	for (const file of collectTsFiles(srcRoot)) {
		const text = readFileSync(file, "utf8");
		assert.equal(
			/\bexport\s+(?:async\s+)?function\s+createStorageClient\b/.test(text),
			false,
			file,
		);
		assert.equal(
			/\bexport\s+(?:async\s+)?function\s+createPolicyClient\b/.test(text),
			false,
			file,
		);
	}
});

test("P?: createClient still constructs without a public plan field", async () => {
	const configSrc = readSrc("v3-client-core.ts");
	assert.equal(
		/\bplan\?:/.test(configSrc),
		false,
		"AthenaClientConfig must not grow a public plan field",
	);

	const remote = createClient({
		key: "ak_test_runtime_plan",
		url: "https://athena.example.test",
	});
	assert.equal(typeof remote, "object");
	assert.equal(typeof remote.close, "function");
	await remote.close();

	const root = mkdtempSync(join(tmpdir(), "athena-runtime-plan-compat-"));
	const local = createClient({
		storage: { provider: "local", root },
	});
	assert.equal(typeof local.storage, "object");
	await local.close();
});

test("P?: v3-client-core.ts does not import pg, node:fs, or Node materializers", () => {
	const core = readSrc("v3-client-core.ts");
	assert.equal(importSpecifier(core, "pg"), false);
	assert.equal(importSpecifier(core, "node:fs"), false);
	assert.equal(core.includes("runtime/materializers"), false);
	assert.equal(importSpecifier(core, "./postgres/transport.ts"), false);
	assert.equal(importSpecifier(core, "./storage/local.ts"), false);
});

test("P?: storage nucleus lives under storage/runtime; s3_id and object policy verbs stay", () => {
	assert.equal(
		existsSync(join(srcRoot, "runtime", "storage", "nucleus")),
		false,
	);
	assert.equal(
		existsSync(join(srcRoot, "storage", "runtime", "nucleus.ts")),
		true,
	);
	const configSrc = readSrc("v3-client-core.ts");
	const lifecycleBlock = configSrc.match(/lifecycle\?:\s*\{([^}]*)\}/);
	assert.equal(
		Boolean(lifecycleBlock?.[1]?.includes("storage")),
		true,
		"athena-embedded-storage-runtime landed lifecycle.storage",
	);
	const fileSrc = readSrc("storage/file.ts");
	assert.match(fileSrc, /s3_id\??:\s*string/);
	const policyTypes = readSrc("policy/types.ts");
	assert.equal(policyTypes.includes("getObject"), false);
	assert.equal(policyTypes.includes("putObject"), false);
});
