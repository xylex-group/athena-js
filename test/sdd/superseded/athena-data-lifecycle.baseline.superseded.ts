/**
 * SUPERSEDED by test/sdd/athena-data-lifecycle.target.test.ts (PRs C/D/E GREEN).
 * Former characterization of mutation Data Lifecycle still ABSENT after Wave 1.
 *
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { string, table } from "../../src/schema/index.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const dataRuntimeDir = join(srcRoot, "runtime", "data");

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

function ok<T>(data: T): AthenaGatewayResponse<T> {
	return {
		count: Array.isArray(data) ? data.length : 1,
		data,
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { data },
		status: 200,
		statusText: "OK",
	};
}

function createRecordingTransport(): AthenaGatewayClient & {
	calls: Array<{ op: string; payload: unknown }>;
} {
	const calls: Array<{ op: string; payload: unknown }> = [];
	return {
		baseUrl: "https://athena.local/mock",
		buildHeaders() {
			return {};
		},
		calls,
		async deleteGateway<T>(
			payload: AthenaDeletePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "delete", payload });
			return ok([{ deleted: true }] as T);
		},
		async fetchGateway<T>(
			payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "fetch", payload });
			return ok([{ id: "1" }] as T);
		},
		async insertGateway<T>(
			payload: AthenaInsertPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "insert", payload });
			return ok([payload.insert_body] as T);
		},
		async queryGateway<T>(
			payload: AthenaQueryPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "query", payload });
			return ok([{ sql: true }] as T);
		},
		async resolveCallOptions(options) {
			return options;
		},
		async rpcGateway<T>(
			payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
			_options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1],
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "rpc", payload });
			return ok([{ rpc: payload.function }] as T);
		},
		async updateGateway<T>(
			payload: AthenaUpdatePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "update", payload });
			return ok([payload.update_body] as T);
		},
		async verifyConnection() {
			return {
				baseUrl: "https://athena.local/mock",
				error: undefined,
				errorDetails: null,
				ok: true,
				raw: null,
				reachable: true,
				status: 200,
				statusText: "OK",
				url: "https://athena.local/mock/health",
			};
		},
	};
}

const users = table("users")
	.schema("public")
	.columns({
		email: string(),
		id: string(),
		name: string(),
	})
	.primaryKey("id");

test("B-DLC-NO-DIR: src/runtime/data/lifecycle/ is missing", () => {
	assert.equal(existsSync(join(dataRuntimeDir, "lifecycle")), false);
	const names = readdirSync(dataRuntimeDir);
	assert.equal(names.includes("lifecycle"), false);
	assert.ok(names.includes("executor.ts"));
});

test("B-DLC-NO-CLIENT-FIELD: AthenaClientConfig has no lifecycle.data (Auth hooks stay on auth config)", () => {
	const clientCoreSrc = readSrc("v3-client-core.ts");
	const configStart = clientCoreSrc.indexOf(
		"export interface AthenaClientConfig",
	);
	const configEnd = clientCoreSrc.indexOf(
		"export type AthenaClientConfigWithR2",
	);
	assert.ok(configStart >= 0 && configEnd > configStart);
	const block = clientCoreSrc.slice(configStart, configEnd);
	assert.equal(/\blifecycle\??:/.test(block), false);
	assert.match(block, /auth\?:/);
	assert.match(block, /policies\?:/);

	const authStart = clientCoreSrc.indexOf("export interface AthenaAuthConfig");
	assert.ok(authStart >= 0 && authStart < configStart);
	const authBlock = clientCoreSrc.slice(authStart, configStart);
	assert.match(authBlock, /hooks\?: AthenaAuthHooks/);
	assert.equal(/\blifecycle\??:/.test(authBlock), false);
});

test("B-DLC-NO-ERROR: ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME is absent; Auth hooks error exists", () => {
	const errorsSrc = readSrc("config/errors.ts");
	assert.match(errorsSrc, /ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME/);
	assert.equal(
		errorsSrc.includes("ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME"),
		false,
	);
});

test("B-DLC-SKIP-EVENT: onExecutionEvent only after transport switch; model deny skips it", async () => {
	const executorSrc = readSrc("runtime/data/executor.ts");
	const switchIdx = executorSrc.indexOf("switch (request.operation)");
	const eventIdx = executorSrc.indexOf("runtime.onExecutionEvent");
	assert.ok(switchIdx >= 0, "transport switch");
	assert.ok(eventIdx > switchIdx, "onExecutionEvent after switch");
	assert.equal(
		executorSrc.split("runtime.onExecutionEvent").length - 1,
		1,
	);
	assert.equal(
		executorSrc.includes("redactAthenaRuntimeExecutionEvent"),
		false,
	);

	const deniedReturn = executorSrc.indexOf("if (denied)");
	const policyDeniedReturn = executorSrc.indexOf("if (policyDenied)");
	const limitedReturn = executorSrc.indexOf("if (limited)");
	assert.ok(deniedReturn >= 0 && deniedReturn < switchIdx);
	assert.ok(policyDeniedReturn >= 0 && policyDeniedReturn < switchIdx);
	assert.ok(limitedReturn >= 0 && limitedReturn < switchIdx);

	const events: unknown[] = [];
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		onExecutionEvent: (event) => {
			events.push(event);
		},
		security: { mode: "trusted" },
		transport,
	});
	const denied = await runtime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1" }, table_name: "secrets" },
	});
	assert.equal(denied.ok, false);
	assert.equal(readRuntimeErrorCode(denied), "ATHENA_MODEL_NOT_EXPOSED");
	assert.equal(transport.calls.length, 0);
	assert.equal(events.length, 0);

	const allowed = await runtime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1" }, table_name: "public.users" },
	});
	assert.equal(allowed.ok, true);
	assert.equal(transport.calls.length, 1);
	assert.equal(events.length, 1);
});

test("B-DLC-NO-UPSERT-OP: AthenaRuntimeOperation has no upsert", () => {
	const typesSrc = readSrc("runtime/data/types.ts");
	const start = typesSrc.indexOf("export type AthenaRuntimeOperation");
	const end = typesSrc.indexOf("export type AthenaRuntimeSecurityMode");
	assert.ok(start >= 0 && end > start);
	const block = typesSrc.slice(start, end);
	assert.match(block, /"insert"/);
	assert.match(block, /"update"/);
	assert.match(block, /"delete"/);
	assert.match(block, /"fetch"/);
	assert.equal(block.includes('"upsert"'), false);

	const httpSrc = readSrc("runtime/data/http-profile.ts");
	assert.equal(/"upsert"/.test(httpSrc), false);
});

test("B-DLC-HANDLERS: hosted-only createAthenaDataHandlers throws ATHENA_LOCAL_RUNTIME_REQUIRED", () => {
	const client = createClient({
		key: "publishable",
		url: "https://hosted.example",
	});
	assert.throws(
		() => createAthenaDataHandlers({ client }),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.equal(
				(error as { code?: string }).code,
				"ATHENA_LOCAL_RUNTIME_REQUIRED",
			);
			return true;
		},
	);
});

test("B-DLC-NO-AUTH-HOOKS-REUSE: data runtime does not import AthenaAuthHooks", () => {
	for (const file of collectTsFiles(dataRuntimeDir)) {
		const text = readFileSync(file, "utf8");
		assert.equal(text.includes("AthenaAuthHooks"), false, file);
	}
});

test("B-DLC-UPSERT-INSERT: fluent upsert traces upsert but transports insert", () => {
	const fluentSrc = readSrc("client-fluent.ts");
	assert.match(fluentSrc, /upsert\s*\(/);
	assert.match(fluentSrc, /operation:\s*"upsert"/);
	assert.match(fluentSrc, /endpoint:\s*"\/gateway\/insert"/);
	assert.match(fluentSrc, /client\.insertGateway/);
	assert.match(
		fluentSrc,
		/formatGatewayResult\(\s*response,\s*\{\s*operation:\s*"insert"/,
	);
	assert.equal(/\bsemanticOperation\b/.test(fluentSrc), false);
	assert.match(fluentSrc, /function collectChangedFields\(/);
});

test("B-DLC-NO-PREPARE: no prepare* mutation lifecycle transforms", () => {
	for (const file of collectTsFiles(dataRuntimeDir)) {
		const text = readFileSync(file, "utf8");
		assert.equal(/\bprepareInsert\b/.test(text), false, file);
		assert.equal(/\bprepareUpdate\b/.test(text), false, file);
		assert.equal(/\bprepareDelete\b/.test(text), false, file);
		assert.equal(/\bprepareUpsert\b/.test(text), false, file);
		assert.equal(/\bsemanticOperation\b/.test(text), false, file);
	}
});

test("B-DLC-NO-AFTER-COMMIT: no afterCommit registration on data runtime", () => {
	for (const file of collectTsFiles(dataRuntimeDir)) {
		const text = readFileSync(file, "utf8");
		assert.equal(/\bafterCommit\b/.test(text), false, file);
		assert.equal(/\bafterInsert\b/.test(text), false, file);
		assert.equal(/\bafterUpdate\b/.test(text), false, file);
	}
});

test("B-DLC-NO-TX-NUCLEUS: src/runtime/data/ has no transaction-owning nucleus", () => {
	const names = readdirSync(dataRuntimeDir);
	assert.equal(
		names.some((name) => name.toLowerCase().includes("transaction")),
		false,
	);
	for (const file of collectTsFiles(dataRuntimeDir)) {
		const text = readFileSync(file, "utf8");
		assert.equal(/\btransaction\b/.test(text), false, file);
	}
});
