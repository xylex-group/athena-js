/**
 * PR C/D/E target — mutation Data Lifecycle desired behavior (GREEN).
 * Titles encode the original found case (`P?: <exact subject>`).
 * Characterization retired to
 * test/sdd/superseded/athena-data-lifecycle.baseline.superseded.ts
 *
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
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
const lifecycleDir = join(dataRuntimeDir, "lifecycle");

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

type DataLifecycleHook = (event: unknown) => Promise<unknown>;
type DataLifecyclePrepare = (event: unknown) => unknown;

type DataLifecycleHooks = {
	afterDelete?: DataLifecycleHook;
	afterInsert?: DataLifecycleHook;
	afterUpdate?: DataLifecycleHook;
	beforeDelete?: DataLifecycleHook;
	beforeInsert?: DataLifecycleHook;
	beforeUpdate?: DataLifecycleHook;
	prepareDelete?: DataLifecyclePrepare;
	prepareInsert?: DataLifecyclePrepare;
	prepareUpdate?: DataLifecyclePrepare;
	prepareUpsert?: DataLifecyclePrepare;
};

async function importLifecycle(): Promise<Record<string, unknown>> {
	const url = pathToFileURL(join(lifecycleDir, "index.ts")).href;
	return (await import(url)) as Record<string, unknown>;
}

test("P?: data lifecycle kernel under src/runtime/data/lifecycle/; Next handlers forward root internals", () => {
	assert.equal(existsSync(lifecycleDir), true);
	assert.equal(existsSync(join(lifecycleDir, "index.ts")), true);
	const files = collectTsFiles(lifecycleDir);
	assert.ok(files.length > 0);
	const handlersSrc = readSrc("next/data-handlers.ts");
	assert.match(handlersSrc, /lifecycle/);
	const clientCoreSrc = readSrc("v3-client-core.ts");
	const configStart = clientCoreSrc.indexOf(
		"export interface AthenaClientConfig",
	);
	const configEnd = clientCoreSrc.indexOf(
		"export type AthenaClientConfigWithR2",
	);
	assert.ok(configStart >= 0 && configEnd > configStart);
	const block = clientCoreSrc.slice(configStart, configEnd);
	assert.match(block, /lifecycle\?:/);
});

test("P?: lifecycle.data on remote/browser throws ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME", () => {
	const errorsSrc = readSrc("config/errors.ts");
	assert.match(errorsSrc, /ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME/);
	assert.match(errorsSrc, /ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME/);

	const dataHooks: DataLifecycleHooks = {
		async afterInsert() {
			return undefined;
		},
	};
	assert.throws(
		() =>
			createClient({
				key: "publishable",
				lifecycle: { data: dataHooks },
				url: "https://hosted.example",
			} as never),
		(error: unknown) => {
			assert.ok(error instanceof AthenaConfigurationError);
			assert.equal(
				error.code,
				"ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME",
			);
			assert.notEqual(error.code, "ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME");
			return true;
		},
	);
});

test("P?: mutation-only data lifecycle events insert|upsert|update|delete; no SELECT/RPC hooks", async () => {
	const lifecycle = await importLifecycle();
	const events = lifecycle.DATA_LIFECYCLE_EVENTS as
		| Record<string, string>
		| undefined;
	assert.ok(events);
	assert.equal(events.insert, "data.insert");
	assert.equal(events.upsert, "data.upsert");
	assert.equal(events.update, "data.update");
	assert.equal(events.delete, "data.delete");
	const joined = collectTsFiles(lifecycleDir)
		.concat(collectTsFiles(join(dataRuntimeDir, "nucleus")))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.equal(/data\.select\b/.test(joined), false);
	assert.equal(/data\.rpc\b/.test(joined), false);
	assert.equal("afterSelect" in lifecycle, false);
	assert.equal("beforeSelect" in lifecycle, false);
	assert.equal("afterRpc" in lifecycle, false);
});

test("P?: no previous-row SELECT for beforeUpdate / beforeDelete", async () => {
	assert.equal(existsSync(lifecycleDir), true);
	const joined = collectTsFiles(lifecycleDir)
		.concat([join(dataRuntimeDir, "executor.ts")])
		.filter((file) => existsSync(file))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.match(joined, /beforeUpdate/);
	assert.match(joined, /beforeDelete/);
	assert.equal(/SELECT\s+\*\s+FROM/i.test(joined), false);
	assert.equal(/previousRow/.test(joined), false);
	assert.equal(/capturePrevious/.test(joined), false);
	await importLifecycle();
});

test("P?: after* throw is not mutation failure and does not mark onExecutionEvent failed", async () => {
	const events: Array<{ decision?: string; errorKind?: string }> = [];
	let afterCalled = false;
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		lifecycle: {
			data: {
				afterInsert: async () => {
					afterCalled = true;
					throw new Error("afterInsert boom");
				},
			},
		},
		modelEnforcement: "known-only",
		models: { users },
		onExecutionEvent: (event) => {
			events.push(event);
		},
		security: { mode: "trusted" },
		transport,
	} as never);
	const result = await runtime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1", name: "Ada" }, table_name: "public.users" },
	});
	assert.equal(afterCalled, true);
	assert.equal(result.ok, true);
	assert.equal(transport.calls.length, 1);
	assert.ok(events.length >= 1);
	assert.equal(events[0]?.decision, "allow");
	assert.equal(events[0]?.errorKind, undefined);
});

test("P?: deny/error/success all emit allowlisted onExecutionEvent", async () => {
	const executorSrc = readSrc("runtime/data/executor.ts");
	assert.equal(executorSrc.includes("redactAthenaRuntimeExecutionEvent"), false);

	const denyEvents: unknown[] = [];
	const denyTransport = createRecordingTransport();
	const denyRuntime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		onExecutionEvent: (event) => {
			denyEvents.push(event);
		},
		security: { mode: "trusted" },
		transport: denyTransport,
	});
	const denied = await denyRuntime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1" }, table_name: "secrets" },
	});
	assert.equal(denied.ok, false);
	assert.equal(readRuntimeErrorCode(denied), "ATHENA_MODEL_NOT_EXPOSED");
	assert.equal(denyTransport.calls.length, 0);
	assert.ok(denyEvents.length >= 1, "deny must emit onExecutionEvent");

	const errorEvents: unknown[] = [];
	const errorTransport = createRecordingTransport();
	errorTransport.insertGateway = async () => {
		throw new Error("transport boom");
	};
	const errorRuntime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		onExecutionEvent: (event) => {
			errorEvents.push(event);
		},
		security: { mode: "trusted" },
		transport: errorTransport,
	});
	try {
		await errorRuntime.execute({
			operation: "insert",
			payload: {
				insert_body: { id: "1" },
				table_name: "public.users",
			},
		});
	} catch {
		// executor may surface the transport error after emitting
	}
	assert.ok(errorEvents.length >= 1, "error must emit onExecutionEvent");

	const successEvents: unknown[] = [];
	const successTransport = createRecordingTransport();
	const successRuntime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		onExecutionEvent: (event) => {
			successEvents.push(event);
		},
		security: { mode: "trusted" },
		transport: successTransport,
	});
	const allowed = await successRuntime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1" }, table_name: "public.users" },
	});
	assert.equal(allowed.ok, true);
	assert.ok(successEvents.length >= 1);
});

test("P?: bypass IN fluent/local PG/D1/Next handlers hit the data lifecycle nucleus", () => {
	assert.equal(existsSync(lifecycleDir), true);
	const fluentSrc = readSrc("client-fluent.ts");
	const runtimeSrc = readSrc("runtime/data/runtime.ts");
	const handlersSrc = readSrc("next/data-handlers.ts");
	const d1Src = existsSync(join(srcRoot, "d1"))
		? collectTsFiles(join(srcRoot, "d1")).map((file) => readFileSync(file, "utf8")).join("\n")
		: "";
	assert.match(`${fluentSrc}\n${runtimeSrc}`, /lifecycle/);
	assert.match(handlersSrc, /lifecycle/);
	assert.equal(typeof createAthenaDataHandlers, "function");
	assert.ok(d1Src.includes("lifecycle") || runtimeSrc.includes("lifecycle"));
});

test("P?: bypass OUT admin.query and RPC are outside data lifecycle", async () => {
	assert.equal(existsSync(lifecycleDir), true);
	const joined = collectTsFiles(lifecycleDir)
		.concat([
			join(dataRuntimeDir, "executor.ts"),
			join(srcRoot, "client-fluent.ts"),
		])
		.filter((file) => existsSync(file))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.match(joined, /admin\.query|queryGateway/);
	assert.match(joined, /\brpc\b/);
	const lifecycle = await importLifecycle();
	assert.equal("afterQuery" in lifecycle, false);
	assert.equal("afterRpc" in lifecycle, false);
	assert.equal("beforeRpc" in lifecycle, false);
});

test("P?: transactions hit the same nucleus or are declared unsupported", async () => {
	assert.equal(existsSync(lifecycleDir), true);
	const joined = collectTsFiles(lifecycleDir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	const hasNucleus = /\btransaction\s*\(/.test(joined);
	const hasUnsupported =
		joined.includes("ATHENA_DATA_LIFECYCLE_TRANSACTIONS_UNSUPPORTED") ||
		joined.includes("ATHENA_DATA_LIFECYCLE_TX_UNSUPPORTED");
	assert.ok(
		hasNucleus || hasUnsupported,
		"transactions must share the nucleus or fail closed",
	);
	await importLifecycle();
});

test("P?: data lifecycle copies Auth mutation split and must not reuse AthenaAuthHooks", async () => {
	assert.equal(existsSync(lifecycleDir), true);
	const files = collectTsFiles(lifecycleDir);
	assert.ok(files.length > 0);
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		assert.equal(text.includes("AthenaAuthHooks"), false, file);
		assert.equal(text.includes("redactAthenaRuntimeExecutionEvent"), false, file);
	}
	const executorSrc = readSrc("runtime/data/executor.ts");
	assert.equal(executorSrc.includes("redactAthenaRuntimeExecutionEvent"), false);
	const lifecycle = await importLifecycle();
	assert.ok(
		"AthenaDataLifecycleHooks" in lifecycle ||
			"createDataMutationScope" in lifecycle ||
			"executeDataMutation" in lifecycle,
	);
});

test("P?: prepare* transforms run on the mutation lifecycle", async () => {
	let prepared: unknown;
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		lifecycle: {
			data: {
				prepareInsert: (event: { record?: Record<string, unknown> }) => {
					prepared = { ...(event.record ?? {}), name: "prepared" };
					return prepared;
				},
			},
		},
		modelEnforcement: "known-only",
		models: { users },
		security: { mode: "trusted" },
		transport,
	} as never);
	const result = await runtime.execute({
		operation: "insert",
		payload: { insert_body: { id: "1", name: "Ada" }, table_name: "public.users" },
	});
	assert.equal(result.ok, true);
	assert.ok(prepared);
	const insertCall = transport.calls.find((call) => call.op === "insert");
	assert.ok(insertCall);
	const payload = insertCall.payload as { insert_body?: { name?: string } };
	assert.equal(payload.insert_body?.name, "prepared");

	const joined = collectTsFiles(lifecycleDir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.match(joined, /prepareInsert/);
	assert.match(joined, /prepareUpdate/);
	assert.match(joined, /prepareDelete/);
});

test("P?: semantic upsert never affects Policy; wire stays insert", () => {
	const fluentSrc = readSrc("client-fluent.ts");
	assert.match(fluentSrc, /semanticOperation:\s*"upsert"/);
	assert.match(fluentSrc, /client\.insertGateway/);
	assert.match(
		fluentSrc,
		/formatGatewayResult\(\s*response,\s*\{\s*operation:\s*"insert"/,
	);

	const typesSrc = readSrc("runtime/data/types.ts");
	const start = typesSrc.indexOf("export type AthenaRuntimeOperation");
	const end = typesSrc.indexOf("export type AthenaRuntimeSecurityMode");
	assert.ok(start >= 0 && end > start);
	const block = typesSrc.slice(start, end);
	assert.equal(block.includes('"upsert"'), false);

	const decisionSrc = readSrc("policy/decision.ts");
	assert.equal(/upsert/.test(decisionSrc), false);
	const decideSrc = readSrc("policy/decide.ts");
	assert.equal(decideSrc.includes("semanticOperation"), false);
	const applySrc = readSrc("policy/apply.ts");
	assert.equal(applySrc.includes("semanticOperation"), false);
	const executorSrc = readSrc("runtime/data/executor.ts");
	assert.match(executorSrc, /semanticOperation/);
	assert.equal(
		/decideAthenaPolicy\([\s\S]*semanticOperation/.test(executorSrc),
		false,
	);
});

test("P?: changedFields is computed server-side not from client collectChangedFields", () => {
	assert.equal(existsSync(lifecycleDir), true);
	const fluentSrc = readSrc("client-fluent.ts");
	assert.match(fluentSrc, /function collectChangedFields\(/);
	const lifecycleSrc = collectTsFiles(lifecycleDir)
		.concat([join(dataRuntimeDir, "executor.ts")])
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.match(lifecycleSrc, /changedFields/);
	assert.equal(lifecycleSrc.includes("collectChangedFields"), false);
});

test("P?: registering afterCommit fail-closes with a stable error; no afterUpdate alias", () => {
	const errorsSrc = readSrc("config/errors.ts");
	assert.match(errorsSrc, /ATHENA_DATA_LIFECYCLE_AFTER_COMMIT_UNSUPPORTED/);
	assert.throws(
		() =>
			createClient({
				db: { pgUri: "postgres://lifecycle:lifecycle@127.0.0.1:1/athena" },
				lifecycle: {
					data: {
						afterCommit() {
							return undefined;
						},
					},
				},
			} as never),
		(error: unknown) => {
			assert.ok(error instanceof AthenaConfigurationError);
			assert.equal(
				error.code,
				"ATHENA_DATA_LIFECYCLE_AFTER_COMMIT_UNSUPPORTED",
			);
			return true;
		},
	);
	if (existsSync(lifecycleDir)) {
		const joined = collectTsFiles(lifecycleDir)
			.map((file) => readFileSync(file, "utf8"))
			.join("\n");
		assert.equal(
			/afterCommit\s*=\s*afterUpdate/.test(joined),
			false,
			"afterCommit must not alias afterUpdate",
		);
		assert.equal(joined.includes("commit-final"), false);
	}
});
