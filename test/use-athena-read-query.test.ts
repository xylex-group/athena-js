import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import type { AthenaReadQueryClient } from "../src/query/read-query.ts";
import {
	AthenaQueryClientProvider,
	createAthenaQueryClient,
	type UseAthenaReadQueryResult,
	useAthenaReadQuery,
} from "../src/react/index.ts";
import type { AthenaQueryClientProviderProps } from "../src/react/provider.ts";

function withQueryClientProvider(
	client: NonNullable<AthenaQueryClientProviderProps["client"]>,
	child: ReturnType<typeof createElement>,
) {
	return createElement(
		AthenaQueryClientProvider,
		{ client } as AthenaQueryClientProviderProps,
		child,
	);
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, reject, resolve };
}

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

function ReadQueryProbe(props: {
	onChange: (value: UseAthenaReadQueryResult) => void;
	hook: () => UseAthenaReadQueryResult;
}) {
	props.onChange(props.hook());
	return null;
}

class FakeTableBuilder {
	constructor(
		private readonly rows: readonly Record<string, unknown>[],
		private readonly count: number,
	) {}

	currentPage() {
		return this;
	}

	pageSize() {
		return this;
	}

	findMany() {
		return Promise.resolve({ count: this.count, data: this.rows });
	}

	select(_columns: string, options?: { head?: boolean; count?: string }) {
		if (options?.head) {
			return Promise.resolve({ count: this.count });
		}
		return Promise.resolve({ count: this.count, data: this.rows });
	}
}

function createFakeAthenaClient(
	rows: readonly Record<string, unknown>[],
	count: number,
): AthenaReadQueryClient {
	return {
		db: {
			from: () => new FakeTableBuilder(rows, count),
		},
	} as unknown as AthenaReadQueryClient;
}

test("useAthenaReadQuery loads rows via AthenaQueryClient and executeAthenaReadQuery", async () => {
	const queryClient = createAthenaQueryClient();
	const athena = createFakeAthenaClient([{ id: "order_1", status: "paid" }], 3);

	let latest: UseAthenaReadQueryResult | undefined;
	let renderer: ReactTestRenderer | undefined;

	await act(async () => {
		renderer = create(
			withQueryClientProvider(
				queryClient,
				createElement(ReadQueryProbe, {
					hook: () =>
						useAthenaReadQuery({
							client: athena,
							page: 1,
							pageSize: 10,
							query: {
								columns: [
									{ column: "id", key: "id" },
									{ column: "status", key: "status" },
								],
								countColumn: "id",
								table: "orders",
							},
						}),
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
	});

	await act(async () => {
		await flush();
		await flush();
	});

	assert.ok(latest);
	assert.equal(latest.isLoading, false);
	assert.equal(latest.isSuccess, true);
	assert.equal(latest.totalItems, 3);
	assert.deepEqual(latest.rows, [
		{ __rowKey: "order_1", id: "order_1", status: "paid" },
	]);

	await act(async () => {
		renderer?.unmount();
	});
});

test("useAthenaReadQuery stays idle when client is missing", async () => {
	const queryClient = createAthenaQueryClient();
	let latest: UseAthenaReadQueryResult | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				queryClient,
				createElement(ReadQueryProbe, {
					hook: () =>
						useAthenaReadQuery({
							client: null,
							query: {
								columns: [{ column: "id", key: "id" }],
								countColumn: "id",
								table: "orders",
							},
						}),
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
	});

	await act(async () => {
		await flush();
	});

	assert.ok(latest);
	assert.equal(latest.isLoading, false);
	assert.equal(latest.status, "idle");
	assert.equal(latest.rows.length, 0);
});

test("useAthenaReadQuery surfaces queryFn errors", async () => {
	const queryClient = createAthenaQueryClient();
	const deferred = createDeferred<never>();
	const athena = {
		db: {
			from: () => ({
				currentPage: () => ({
					pageSize: () => ({
						findMany: () => deferred.promise,
					}),
				}),
				select: () => Promise.resolve({ count: 0 }),
			}),
		},
	} as unknown as AthenaReadQueryClient;

	let latest: UseAthenaReadQueryResult | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				queryClient,
				createElement(ReadQueryProbe, {
					hook: () =>
						useAthenaReadQuery({
							client: athena,
							query: {
								columns: [{ column: "id", key: "id" }],
								countColumn: "id",
								table: "orders",
							},
							retry: false,
						}),
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
	});

	await act(async () => {
		deferred.reject(new Error("gateway down"));
		await flush();
		await flush();
	});

	assert.ok(latest);
	assert.equal(latest.isError, true);
	assert.equal(latest.error?.message, "gateway down");
});
