import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { createClient, string, table } from "../src/index.ts";
import {
	AthenaQueryClientProvider,
	createAthenaQueryClient,
	type UseQueryResult,
	useAthenaQuery,
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

const File = table("File")
	.schema("public")
	.from("files")
	.columns({
		displayName: string(),
		fileId: string().generated(),
		organizationId: string(),
	})
	.primaryKey("fileId");

function QueryProbe<T>(props: {
	hook: () => UseQueryResult<T>;
	onChange: (value: UseQueryResult<T>) => void;
}) {
	props.onChange(props.hook());
	return null;
}

test("useAthenaQuery loads an executable without a manual queryKey", async () => {
	const deferred = createDeferred<{ data: Array<{ fileId: string }> }>();
	const original = globalThis.fetch;
	globalThis.fetch = async () => {
		const payload = await deferred.promise;
		return new Response(JSON.stringify(payload), { status: 200 });
	};

	const queryClient = createAthenaQueryClient();
	const athena = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const query = athena.from(File).select("*").eq("organizationId", "org-a");

	let latest: UseQueryResult<unknown> | undefined;
	let renderer: ReactTestRenderer | undefined;

	try {
		await act(async () => {
			renderer = create(
				withQueryClientProvider(
					queryClient,
					createElement(QueryProbe, {
						hook: () => useAthenaQuery(query),
						onChange: (value) => {
							latest = value;
						},
					}),
				),
			);
		});

		assert.equal(latest?.isLoading, true);
		await act(async () => {
			deferred.resolve({ data: [{ fileId: "f1" }] });
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(latest?.isSuccess, true);
		const payload = latest?.data as
			| Array<{ fileId: string }>
			| { data?: Array<{ fileId: string }> }
			| undefined;
		const rows = Array.isArray(payload) ? payload : payload?.data;
		assert.deepEqual(rows, [{ fileId: "f1" }]);
		const cached = queryClient.getQueryData(
			query.capture().getDescriptor().queryKey,
		);
		assert.ok(cached !== undefined);
	} finally {
		globalThis.fetch = original;
		renderer?.unmount();
	}
});

test("useAthenaQuery does not retarget when the same builder is mutated after subscribe", async () => {
	const seenBodies: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (_url, init) => {
		seenBodies.push(String(init?.body ?? ""));
		return new Response(JSON.stringify({ data: [] }), { status: 200 });
	};

	const queryClient = createAthenaQueryClient();
	const athena = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const query = athena.from(File).select("*").eq("organizationId", "org-a");
	const originalKey = [...query.getDescriptor().queryKey];

	let renderer: ReactTestRenderer | undefined;
	try {
		await act(async () => {
			renderer = create(
				withQueryClientProvider(
					queryClient,
					createElement(QueryProbe, {
						hook: () => useAthenaQuery(query),
						onChange: () => undefined,
					}),
				),
			);
			await Promise.resolve();
			await Promise.resolve();
		});

		query.eq("displayName", "mutated-after-subscribe");
		await act(async () => {
			await Promise.resolve();
		});

		const afterKey = query.getDescriptor().queryKey;
		assert.notDeepEqual(afterKey, originalKey);
		const firstPayload = JSON.parse(seenBodies[0] ?? "{}") as {
			conditions?: Array<{ column?: string }>;
		};
		assert.equal(
			firstPayload.conditions?.some(
				(condition) => condition.column === "displayName",
			),
			false,
			"captured execute must not pick up post-subscribe builder mutation",
		);
	} finally {
		globalThis.fetch = original;
		renderer?.unmount();
	}
});
