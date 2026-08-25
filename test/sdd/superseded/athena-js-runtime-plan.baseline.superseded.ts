/**
 * SUPERSEDED by test/sdd/athena-js-runtime-plan.target.test.ts
 *
 * Former characterization of Phases 0–4 CURRENT defects:
 * - no src/runtime/plan/**
 * - no AthenaRuntimePlan
 * - resolveAthenaRuntime diagnostic-only
 * - no src/runtime/materializers/**
 * - v3-client.ts value-imported storage/local, postgres/transport,
 *   billing provider registry, chat/local/database
 * - schema/resource.ts relational-only
 * - local storage silently won over storage.url
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 *
 * See docs/sdd/xylex/athena-js-runtime-plan/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as runtimeBarrel from "../../../src/runtime/index.ts";
import { resolveAthenaRuntime } from "../../../src/runtime/resolve.ts";
import * as rootBarrel from "../../../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const runtimeRoot = join(srcRoot, "runtime");

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
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

function runtimeSourceMentions(identifier: string): boolean {
	return collectTsFiles(runtimeRoot).some((file) =>
		new RegExp(`\\b${identifier}\\b`).test(readFileSync(file, "utf8")),
	);
}

test("P?: src/runtime/plan/ does not exist", () => {
	const planDir = join(runtimeRoot, "plan");
	assert.equal(existsSync(planDir), false);
});

test("P?: AthenaRuntimePlan does not exist", () => {
	assert.equal(runtimeSourceMentions("AthenaRuntimePlan"), false);
	assert.equal("AthenaRuntimePlan" in runtimeBarrel, false);
	assert.equal(
		readSrc("runtime/resolve.ts").includes("AthenaRuntimePlan"),
		false,
	);
});

test("P?: resolveAthenaRuntime is a thin ResolvedAthenaRuntime diagnostic, not validateRuntimePlan", () => {
	const resolveSrc = readSrc("runtime/resolve.ts");
	assert.match(resolveSrc, /export interface ResolvedAthenaRuntime/);
	assert.match(resolveSrc, /export function resolveAthenaRuntime/);
	assert.equal(resolveSrc.includes("validateRuntimePlan"), false);
	assert.equal(resolveSrc.includes("materializeRuntimePlan"), false);
	assert.equal(resolveSrc.includes("resolveRuntimePlan"), false);
	assert.equal(typeof resolveAthenaRuntime, "function");
	assert.equal("validateRuntimePlan" in runtimeBarrel, false);
	assert.equal("resolveAthenaRuntime" in runtimeBarrel, true);
});

test("P?: src/runtime/materializers/ does not exist", () => {
	const materializersDir = join(runtimeRoot, "materializers");
	assert.equal(existsSync(materializersDir), false);
});

test("P?: v3-client.ts value-imports storage/local.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.match(v3, /from ["']\.\/storage\/local\.ts["']/);
	assert.match(v3, /createLocalStorageModule/);
});

test("P?: v3-client.ts value-imports postgres/transport.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.match(v3, /from ["']\.\/postgres\/transport\.ts["']/);
	assert.match(v3, /createPostgresDirectTransport/);
});

test("P?: v3-client.ts value-imports billing local provider registry", () => {
	const v3 = readSrc("v3-client.ts");
	assert.match(
		v3,
		/createBillingProviderRegistry[\s\S]*from ["']\.\/billing\/runtime\/local\/providers\/create-registry\.ts["']/,
	);
});

test("P?: v3-client.ts value-imports chat/local/database.ts", () => {
	const v3 = readSrc("v3-client.ts");
	assert.match(v3, /from ["']\.\/chat\/local\/database\.ts["']/);
	assert.match(v3, /createChatDatabaseFromRuntime/);
});

test("P?: schema/resource.ts is relational-only (no storage-object, auth, or service kind)", () => {
	const resource = readSrc("schema/resource.ts");
	assert.equal(resource.includes("storage-object"), false);
	assert.equal(resource.includes('kind: "auth"'), false);
	assert.equal(resource.includes('kind: "service"'), false);
	assert.equal(resource.includes("AthenaResourceIdentity"), false);
	assert.match(resource, /export type AthenaResourceRef/);
	assert.match(resource, /table: string/);
	assert.match(resource, /schema\?: string/);
	assert.match(resource, /database\?: string/);
});

test("P?: resolveAthenaRuntime sets storage.transport local when provider is local even if storage.url is set", () => {
	const plan = resolveAthenaRuntime({
		storage: {
			provider: "local",
			root: "/tmp/athena-runtime-plan-baseline",
			url: "https://storage.example.test/managed",
		},
	});
	assert.equal(plan.storage.transport, "local");
	assert.notEqual(plan.storage.transport, "http");
});

test("P?: no createStorageClient or createPolicyClient", () => {
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
