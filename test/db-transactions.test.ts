import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/v3-client.ts";
import {
	AthenaTransactionError,
	buildPostgresBeginStatement,
} from "../src/db/transaction/index.ts";
import { createCloudflareD1GatewayTransport } from "../src/cloudflare/d1/transport.ts";
import { createGatewayCapabilities } from "../src/cloudflare/capabilities.ts";
import { createPostgresDirectCapabilities } from "../src/cloudflare/capabilities.ts";
import { createCloudflareEdgeCapabilities } from "../src/cloudflare/capabilities.ts";
import { createMockD1 } from "./helpers/d1-r2-mocks.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../src/gateway/types.ts";
import type { AthenaTransactionOperation } from "../src/db/transaction/types.ts";

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

test("capabilities: D1 advertises atomic batch only", () => {
	const caps = createCloudflareEdgeCapabilities({
		authRemote: false,
		hasR2: false,
	});
	assert.deepEqual(caps.db.transactions, {
		atomic: true,
		backend: "d1-batch",
		deferrable: false,
		interactive: false,
		isolationLevels: [],
		readOnly: false,
		savepoints: false,
	});
});

test("capabilities: direct postgres advertises interactive + savepoints", () => {
	const caps = createPostgresDirectCapabilities();
	assert.equal(caps.db.transactions.atomic, true);
	assert.equal(caps.db.transactions.interactive, true);
	assert.equal(caps.db.transactions.savepoints, true);
	assert.equal(caps.db.transactions.backend, "postgres-direct");
});

test("capabilities: gateway postgres advertises atomic only", () => {
	const caps = createGatewayCapabilities();
	assert.equal(caps.db.transactions.backend, "gateway-postgres");
	assert.equal(caps.db.transactions.atomic, true);
	assert.equal(caps.db.transactions.interactive, false);
});

test("BEGIN SQL maps isolation exhaustively and rejects illegal DEFERRABLE", () => {
	assert.equal(buildPostgresBeginStatement(), "BEGIN");
	assert.equal(
		buildPostgresBeginStatement({ isolationLevel: "serializable" }),
		"BEGIN ISOLATION LEVEL SERIALIZABLE",
	);
	assert.equal(
		buildPostgresBeginStatement({
			deferrable: true,
			isolationLevel: "serializable",
			readOnly: true,
		}),
		"BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
	);
	assert.throws(
		() => buildPostgresBeginStatement({ deferrable: true, readOnly: true }),
		(error: unknown) =>
			error instanceof AthenaTransactionError &&
			error.code === "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
	);
});

test("D1 db.transaction compiles to exactly one batch() and maps positional results", async () => {
	const batchCalls: number[] = [];
	const d1 = createMockD1({
		rowsBySql: new Map([
			[
				'INSERT INTO "accounts" ("balance") VALUES (?) RETURNING *',
				[{ balance: 100, id: "a" }],
			],
		]),
	});
	const originalBatch = d1.batch.bind(d1);
	d1.batch = async (statements) => {
		batchCalls.push(statements.length);
		return originalBatch(statements);
	};
	const client = createClient({
		db: { d1 },
	});
	assert.equal(client.capabilities.db.transactions.backend, "d1-batch");
	const [insert] = await client.db.transaction([
		client.from("accounts").insert({ balance: 100, id: "a" }),
	] as const);
	assert.equal(insert.error, null);
	assert.equal(batchCalls.length, 1);
});

test("D1 withTransaction fails closed (no simulated interactive tx)", async () => {
	const client = createClient({
		db: { d1: createMockD1({}) },
	});
	await assert.rejects(
		() => client.db.withTransaction(async () => undefined),
		(error: unknown) =>
			error instanceof AthenaTransactionError &&
			error.code === "ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED",
	);
});

test("D1 isolationLevel is not silently ignored", async () => {
	const client = createClient({
		db: { d1: createMockD1({}) },
	});
	await assert.rejects(
		() =>
			client.db.transaction(
				[client.from("accounts").insert({ id: "a" })] as const,
				{ isolationLevel: "serializable" },
			),
		(error: unknown) =>
			error instanceof AthenaTransactionError &&
			error.code === "ATHENA_TRANSACTION_ISOLATION_UNSUPPORTED",
	);
});

test("transaction pins request context once", async () => {
	const seenOrgs: Array<string | null | undefined> = [];
	const operations: AthenaTransactionOperation[][] = [];
	const fakeTransport: AthenaGatewayClient = {
		baseUrl: "https://fake.test",
		buildHeaders: () => ({}),
		deleteGateway: async <T>(
			_payload: AthenaDeletePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> => ok(null as T),
		fetchGateway: async <T>(
			_payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> => ok([] as T),
		insertGateway: async <T>(
			_payload: AthenaInsertPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> => ok({ id: "1" } as T),
		queryGateway: async <T>(
			_payload: AthenaQueryPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> => ok([] as T),
		resolveCallOptions: async (options) => options,
		rpcGateway: async <T>(
			_payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
			_options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1],
		): Promise<AthenaGatewayResponse<T>> => ok(null as T),
		transactions: {
			capabilities: {
				atomic: true,
				backend: "gateway-postgres",
				deferrable: true,
				interactive: false,
				isolationLevels: ["read_committed", "repeatable_read", "serializable"],
				readOnly: true,
				savepoints: false,
			},
			async executeAtomic(ops, options) {
				operations.push([...ops]);
				seenOrgs.push(options?.callOptions?.organizationId);
				return {
					committed: true,
					results: ops.map(() => ({
						count: 1,
						data: { id: "1" },
						ok: true,
						raw: { id: "1" },
						status: 200,
						statusText: "OK",
					})),
				};
			},
		},
		updateGateway: async <T>(
			_payload: AthenaUpdatePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> => ok(null as T),
		verifyConnection: async () => ({
			baseUrl: "https://fake.test",
			ok: true,
			raw: null,
			reachable: true,
			status: 200,
			url: "https://fake.test",
		}),
	};

	const client = createClient({
		gatewayTransport: fakeTransport,
		key: "k",
		url: "https://example.test",
	}).withContext({ organizationId: "org-frozen" });

	await client.db.transaction([
		client.from("accounts").insert({ id: "1" }),
		client.from("ledger").insert({ id: "2" }),
	] as const);

	assert.equal(operations.length, 1);
	assert.equal(operations[0]?.length, 2);
	assert.deepEqual(seenOrgs, ["org-frozen"]);
});

test("empty transaction fails closed", async () => {
	const client = createClient({
		db: { d1: createMockD1({}) },
	});
	await assert.rejects(
		() => client.db.transaction([] as const),
		(error: unknown) =>
			error instanceof AthenaTransactionError &&
			error.code === "ATHENA_TRANSACTION_EMPTY",
	);
});

test("D1 transport is attached on createCloudflareD1GatewayTransport", () => {
	const transport = createCloudflareD1GatewayTransport({
		d1: createMockD1({}),
	});
	assert.equal(transport.transactions?.capabilities.backend, "d1-batch");
	assert.equal(transport.transactions?.capabilities.interactive, false);
});
