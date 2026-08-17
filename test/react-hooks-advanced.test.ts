import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import {
	AthenaQueryClientProvider,
	createAthenaQueryClient,
	type UseMutationOptions,
	type UseMutationResult,
	type UseQueryOptions,
	type UseQueryResult,
	useMutation,
	useQuery,
} from "../src/react/index.ts";
import type { AthenaQueryClientProviderProps } from "../src/react/provider.ts";

type Deferred<T> = ReturnType<typeof createDeferred<T>>;

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

function QueryProbe<TQueryFnData, TData = TQueryFnData>(props: {
	onChange: (value: UseQueryResult<TData>) => void;
	options: UseQueryOptions<TQueryFnData, TData>;
}) {
	const result = useQuery(props.options);
	props.onChange(result);
	return null;
}

function MutationProbe<TVariables, TMutationFnData, TData = TMutationFnData>(
	props: {
		onChange: (value: UseMutationResult<TVariables, TData>) => void;
		options: UseMutationOptions<TVariables, TMutationFnData, TData>;
	},
) {
	const result = useMutation(props.options);
	props.onChange(result);
	return null;
}

function StaleOnSuccessQueryApp(props: {
	fast: Deferred<Array<{ id: string }>>;
	onSuccessValues: string[];
	queryScope: string;
	slow: Deferred<Array<{ id: string }>>;
}) {
	useQuery({
		onSuccess: (rows) => {
			props.onSuccessValues.push(rows[0]?.id ?? "none");
		},
		queryFn: async () =>
			props.queryScope === "slow" ? props.slow.promise : props.fast.promise,
		queryKey: ["users", props.queryScope],
	});
	return null;
}

type BrowserEventName = "focus" | "online";

function installMockBrowserTarget() {
	const root = globalThis as { window?: unknown };
	const originalWindow = root.window;
	const listeners = new Map<BrowserEventName, Set<() => void>>([
		["focus", new Set()],
		["online", new Set()],
	]);

	const mockWindow = {
		addEventListener(event: BrowserEventName, listener: () => void) {
			listeners.get(event)?.add(listener);
		},
		emit(event: BrowserEventName) {
			for (const listener of listeners.get(event) ?? []) {
				listener();
			}
		},
		removeEventListener(event: BrowserEventName, listener: () => void) {
			listeners.get(event)?.delete(listener);
		},
	};

	root.window = mockWindow;

	return {
		emit(event: BrowserEventName) {
			mockWindow.emit(event);
		},
		restore() {
			if (originalWindow === undefined) {
				root.window = undefined;
				return;
			}
			root.window = originalWindow;
		},
	};
}

test("useQuery supports initialData without immediate execution when disabled", async () => {
	const client = createAthenaQueryClient();
	let calls = 0;
	let latest: UseQueryResult<Array<{ id: number }>> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(QueryProbe, {
					options: {
						enabled: false,
						initialData: [{ id: 10 }],
						queryFn: async () => {
							calls += 1;
							return [{ id: 99 }];
						},
						queryKey: ["initial-data"],
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	assert.equal(calls, 0);
	assert(latest);
	assert.equal(latest.status, "success");
	assert.equal(latest.isLoading, false);
	assert.deepEqual(latest.data, [{ id: 10 }]);
});

test("useQuery applies select transform", async () => {
	const client = createAthenaQueryClient();
	let latest: UseQueryResult<string[]> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(QueryProbe, {
					options: {
						queryFn: async () => ({
							data: [{ id: "a" }, { id: "b" }],
							error: null,
							raw: null,
							status: 200,
						}),
						queryKey: ["select-transform"],
						// select receives unwrapped envelope `data` (row array), not the full response
						select: (rows) =>
							(rows as unknown as { id: string }[]).map((item) => item.id),
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, ["a", "b"]);
});

test("useQuery success callbacks fire with normalized result", async () => {
	const client = createAthenaQueryClient();
	const calls: string[] = [];

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(QueryProbe, {
					options: {
						onSettled: (data, error) => {
							calls.push(
								`onSettled:${Array.isArray(data)}:${error === null}`,
							);
						},
						onSuccess: () => calls.push("onSuccess"),
						queryFn: async () => [{ id: 1 }],
						queryKey: ["query-callback-success"],
					},
					onChange: () => undefined,
				}),
			),
		);
		await flush();
	});

	assert.deepEqual(calls, ["onSuccess", "onSettled:true:true"]);
});

test("useQuery error callbacks fire with normalized error", async () => {
	const client = createAthenaQueryClient();
	const calls: string[] = [];

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(QueryProbe, {
					options: {
						onError: (error) => {
							calls.push(`onError:${error.message}`);
						},
						onSettled: (data, error) => {
							calls.push(`onSettled:${data === undefined}:${error?.message}`);
						},
						queryFn: async () => {
							throw new Error("query-failed");
						},
						queryKey: ["query-callback-error"],
					},
					onChange: () => undefined,
				}),
			),
		);
		await flush();
	});

	assert.deepEqual(calls, [
		"onError:query-failed",
		"onSettled:true:query-failed",
	]);
});

test("useQuery retry option retries failed queryFn and eventually succeeds", async () => {
	const client = createAthenaQueryClient();
	let attempts = 0;
	let latest: UseQueryResult<Array<{ id: string }>> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(QueryProbe, {
					options: {
						queryFn: async () => {
							attempts += 1;
							if (attempts < 3) {
								throw new Error(`retry-${attempts}`);
							}
							return [{ id: "ok" }];
						},
						queryKey: ["query-retry"],
						retry: 2,
						retryDelay: 0,
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	assert.equal(attempts, 3);
	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: "ok" }]);
	assert.equal(latest.lastRequest?.attempt, 3);
});

test("useQuery does not refetch on remount when cached and refetchOnMount=false", async () => {
	const client = createAthenaQueryClient({
		cache: { mode: "memory", staleTime: 60_000 },
	});
	let calls = 0;
	let renderer: ReactTestRenderer | undefined;

	const App = () =>
		createElement(QueryProbe, {
			options: {
				queryFn: async () => {
					calls += 1;
					return [{ id: calls }];
				},
				queryKey: ["remount-no-refetch"],
				refetchOnMount: false,
			},
			onChange: () => undefined,
		});

	await act(async () => {
		renderer = create(withQueryClientProvider(client, createElement(App)));
		await flush();
	});

	assert.equal(calls, 1);

	await act(async () => {
		renderer?.unmount();
		await flush();
	});

	await act(async () => {
		renderer = create(withQueryClientProvider(client, createElement(App)));
		await flush();
	});

	assert.equal(calls, 1);
	renderer?.unmount();
});

test("useQuery suppresses stale onSuccess callbacks from outdated query keys", async () => {
	const client = createAthenaQueryClient();
	const slow = createDeferred<Array<{ id: string }>>();
	const fast = createDeferred<Array<{ id: string }>>();
	const onSuccessValues: string[] = [];

	let scope = "slow";
	let renderer: ReactTestRenderer | undefined;

	const App = () =>
		createElement(StaleOnSuccessQueryApp, {
			fast,
			onSuccessValues,
			queryScope: scope,
			slow,
		});

	await act(async () => {
		renderer = create(withQueryClientProvider(client, createElement(App)));
		await flush();
	});

	await act(async () => {
		scope = "fast";
		renderer?.update(withQueryClientProvider(client, createElement(App)));
		await flush();
	});

	await act(async () => {
		fast.resolve([{ id: "new" }]);
		await flush();
	});

	await act(async () => {
		slow.resolve([{ id: "old" }]);
		await flush();
	});

	assert.deepEqual(onSuccessValues, ["new"]);
	renderer?.unmount();
});

test("useQuery refetches on focus and reconnect when enabled", async () => {
	const mockBrowser = installMockBrowserTarget();
	const client = createAthenaQueryClient();
	let calls = 0;
	let renderer: ReactTestRenderer | undefined;

	try {
		await act(async () => {
			renderer = create(
				withQueryClientProvider(
					client,
					createElement(QueryProbe, {
						options: {
							queryFn: async () => {
								calls += 1;
								return [{ id: calls }];
							},
							queryKey: ["browser-refetch"],
							refetchOnReconnect: true,
							refetchOnWindowFocus: true,
						},
						onChange: () => undefined,
					}),
				),
			);
			await flush();
		});

		assert.equal(calls, 1);

		await act(async () => {
			mockBrowser.emit("focus");
			await flush();
		});

		await act(async () => {
			mockBrowser.emit("online");
			await flush();
		});

		assert.equal(calls, 3);
	} finally {
		renderer?.unmount();
		mockBrowser.restore();
	}
});

test("useMutation applies select transform and returns transformed data", async () => {
	const client = createAthenaQueryClient();
	let latest: UseMutationResult<{ name: string }, string> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(MutationProbe, {
					options: {
						mutationFn: async () => ({
							data: { id: "m1", ok: true },
							error: null,
							raw: { source: "mutation" },
							status: 201,
						}),
						mutationKey: ["mutation-select-transform"],
						select: (row: { id: string; ok: boolean }) => row.id,
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	let value: string | undefined;
	await act(async () => {
		value = await latest?.mutateAsync({ name: "X" });
		await flush();
	});

	assert.equal(value, "m1");
	assert(latest);
	assert.equal(latest.status, "success");
	assert.equal(latest.data, "m1");
});

test("useMutation error callbacks fire in correct order", async () => {
	const client = createAthenaQueryClient();
	const calls: string[] = [];
	let latest: UseMutationResult<{ id: string }, { id: string }> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(MutationProbe, {
					options: {
						mutationFn: async (variables: { id: string }) => {
							calls.push(`mutationFn:${variables.id}`);
							throw new Error("mutation-boom");
						},
						onError: (error) => {
							calls.push(`onError:${error.message}`);
						},
						onMutate: async (variables) => {
							calls.push(`onMutate:${variables.id}`);
						},
						onSettled: (data, error) => {
							calls.push(`onSettled:${data === undefined}:${error?.message}`);
						},
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	await act(async () => {
		try {
			await latest?.mutateAsync({ id: "7" });
		} catch {
			// expected
		}
		await flush();
	});

	assert.deepEqual(calls, [
		"onMutate:7",
		"mutationFn:7",
		"onError:mutation-boom",
		"onSettled:true:mutation-boom",
	]);
});

test("useMutation retry re-executes failed mutationFn and succeeds", async () => {
	const client = createAthenaQueryClient();
	let attempts = 0;
	let latest: UseMutationResult<{ id: string }, { id: string }> | undefined;

	await act(async () => {
		create(
			withQueryClientProvider(
				client,
				createElement(MutationProbe, {
					options: {
						mutationFn: async (variables: { id: string }) => {
							attempts += 1;
							if (attempts < 2) {
								throw new Error("retry-this");
							}
							return { id: variables.id };
						},
						mutationKey: ["mutation-retry"],
						retry: 1,
						retryDelay: 0,
					},
					onChange: (value) => {
						latest = value;
					},
				}),
			),
		);
		await flush();
	});

	let result: { id: string } | undefined;
	await act(async () => {
		result = await latest?.mutateAsync({ id: "ok" });
		await flush();
	});

	assert.equal(attempts, 2);
	assert.deepEqual(result, { id: "ok" });
	assert(latest);
	assert.equal(latest.status, "success");
	assert.equal(latest.lastRequest?.attempt, 2);
});
