import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import {
	AthenaQueryClientProvider,
	createAthenaQueryClient,
	type UseAdminPermissionResult,
	type UseAthenaSessionClientResult,
	type UseMutationResult,
	type UseQueryResult,
	type UseSessionResult,
	type UseStorageUploadResult,
	useAdminPermission,
	useAthenaSessionClient,
	useMutation,
	useQuery,
	useSession,
	useStorageUpload,
} from "../src/react/index.ts";
import type { AthenaStorageFileUploadInput } from "../src/storage/file.ts";
import type { AthenaStorageModule } from "../src/storage/module.ts";

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

// Probes intentionally use `any` so createElement does not need explicit generics.
function QueryProbe(props: {
	onChange: (value: UseQueryResult<any>) => void;
	hook: () => UseQueryResult<any>;
}) {
	props.onChange(props.hook());
	return null;
}

function MutationProbe(props: {
	onChange: (value: UseMutationResult<any, any>) => void;
	hook: () => UseMutationResult<any, any>;
}) {
	props.onChange(props.hook());
	return null;
}

function SessionProbe(props: {
	onChange: (value: UseSessionResult) => void;
	hook: () => UseSessionResult;
}) {
	props.onChange(props.hook());
	return null;
}

function AdminPermissionProbe(props: {
	onChange: (value: UseAdminPermissionResult) => void;
	hook: () => UseAdminPermissionResult;
}) {
	props.onChange(props.hook());
	return null;
}

function AthenaSessionClientProbe<TClient>(props: {
	onChange: (value: UseAthenaSessionClientResult<TClient>) => void;
	hook: () => UseAthenaSessionClientResult<TClient>;
}) {
	props.onChange(props.hook());
	return null;
}

function StorageUploadProbe(props: {
	onChange: (value: UseStorageUploadResult) => void;
	hook: () => UseStorageUploadResult;
}) {
	props.onChange(props.hook());
	return null;
}

test("useQuery loads then succeeds", async () => {
	const client = createAthenaQueryClient();
	const deferred = createDeferred<Array<{ id: number }>>();

	let latest: UseQueryResult<Array<{ id: number }>> | undefined;
	let renderer: ReactTestRenderer | undefined;

	await act(async () => {
		renderer = create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(QueryProbe, {
					hook: () =>
						useQuery({
							queryFn: async () => deferred.promise,
							queryKey: ["products"],
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.isFetching, true);

	await act(async () => {
		deferred.resolve([{ id: 1 }]);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: 1 }]);
	renderer?.unmount();
});

test("useQuery disabled does not run until refetch", async () => {
	const client = createAthenaQueryClient();
	let calls = 0;

	let latest: UseQueryResult<Array<{ id: number }>> | undefined;
	let renderer: ReactTestRenderer | undefined;

	await act(async () => {
		renderer = create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(QueryProbe, {
					hook: () =>
						useQuery({
							enabled: false,
							queryFn: async () => {
								calls += 1;
								return [{ id: 2 }];
							},
							queryKey: ["disabled"],
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	assert.equal(calls, 0);
	assert(latest);
	assert.equal(latest.status, "idle");

	await act(async () => {
		await latest?.refetch();
		await flush();
	});

	assert.equal(calls, 1);
	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: 2 }]);
	renderer?.unmount();
});

test("useQuery normalizes Athena envelope response shape", async () => {
	const client = createAthenaQueryClient();
	let latest: UseQueryResult<Array<{ id: number }>> | undefined;

	await act(async () => {
		create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(QueryProbe, {
					hook: () =>
						useQuery({
							queryFn: async () => ({
								data: [{ id: 10 }],
								error: null,
								raw: { source: "athena" },
								status: 200,
							}),
							queryKey: ["envelope"],
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: 10 }]);
	assert.deepEqual(latest.lastResponse, {
		data: [{ id: 10 }],
		error: null,
		raw: { source: "athena" },
		status: 200,
	});
});

test("useQuery handles thrown errors", async () => {
	const client = createAthenaQueryClient();
	let latest: UseQueryResult<Array<{ id: number }>> | undefined;

	await act(async () => {
		create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(QueryProbe, {
					hook: () =>
						useQuery({
							queryFn: async () => {
								throw new Error("boom");
							},
							queryKey: ["error"],
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "error");
	assert.equal(latest.error?.message, "boom");
});

test("useQuery older slower request does not overwrite newer request on key change", async () => {
	const client = createAthenaQueryClient();
	const slow = createDeferred<Array<{ id: string }>>();
	const fast = createDeferred<Array<{ id: string }>>();

	let scope = "slow";
	let latest: UseQueryResult<Array<{ id: string }>> | undefined;
	let renderer: ReactTestRenderer | undefined;

	const App = () =>
		createElement(QueryProbe, {
			hook: () =>
				useQuery({
					queryFn: async () => (scope === "slow" ? slow.promise : fast.promise),
					queryKey: ["users", scope],
				}),
			onChange: (value: UseQueryResult<Array<{ id: string }>>) => {
				latest = value as any;
			},
		});

	await act(async () => {
		renderer = create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(App),
			),
		);
		await flush();
	});

	await act(async () => {
		scope = "fast";
		renderer?.update(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(App),
			),
		);
		await flush();
	});

	await act(async () => {
		fast.resolve([{ id: "new" }]);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: "new" }]);

	await act(async () => {
		slow.resolve([{ id: "old" }]);
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, [{ id: "new" }]);

	renderer?.unmount();
});

test("useMutation mutateAsync success and callbacks", async () => {
	const client = createAthenaQueryClient();
	const callOrder: string[] = [];
	let latest:
		| UseMutationResult<{ name: string }, { id: string; name: string }>
		| undefined;

	let renderer: ReactTestRenderer | undefined;
	await act(async () => {
		renderer = create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(MutationProbe, {
					hook: () =>
						useMutation({
							mutationFn: async (variables: any) => ({
								id: "1",
								name: variables.name,
							}),
							mutationKey: ["create-product"],
							onMutate: async () => {
								callOrder.push("onMutate");
							},
							onSettled: () => {
								callOrder.push("onSettled");
							},
							onSuccess: () => {
								callOrder.push("onSuccess");
							},
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	const data = await (act as any)(async () => {
		const result = await latest?.mutateAsync({ name: "Product" });
		await flush();
		return result;
	});

	assert.deepEqual(data, { id: "1", name: "Product" });
	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, { id: "1", name: "Product" });
	assert.deepEqual(callOrder, ["onMutate", "onSuccess", "onSettled"]);
	renderer?.unmount();
});

test("useStorageUpload reports upload progress and result state", async () => {
	const storage = {
		file: {
			async upload(input: AthenaStorageFileUploadInput) {
				input.onProgress?.({
					aggregateLoaded: 5,
					aggregatePercent: 50,
					aggregateTotal: 10,
					fileCount: 1,
					fileIndex: 0,
					fileName: "report.txt",
					loaded: 5,
					percent: 50,
					phase: "uploading",
					total: 10,
				});
				input.onProgress?.({
					aggregateLoaded: 10,
					aggregatePercent: 100,
					aggregateTotal: 10,
					fileCount: 1,
					fileIndex: 0,
					fileName: "report.txt",
					loaded: 10,
					percent: 100,
					phase: "complete",
					total: 10,
				});
				return { count: 0, files: [] };
			},
		},
	} as unknown as Pick<AthenaStorageModule, "file">;
	let latest: UseStorageUploadResult | undefined;
	let renderer: ReactTestRenderer | undefined;

	await act(async () => {
		renderer = create(
			createElement(StorageUploadProbe, {
				hook: () =>
					useStorageUpload({
						fileName: "report.txt",
						s3_id: "s3_1",
						storage,
					}),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert(latest);
	await act(async () => {
		await latest?.upload(new Blob(["test"]));
		await flush();
	});

	assert(latest);
	assert.equal(latest.uploading, false);
	assert.equal(latest.percent, 100);
	assert.equal(latest.progress?.phase, "complete");
	assert.deepEqual(latest.result, { count: 0, files: [] });
	assert.equal(latest.error, null);
	renderer?.unmount();
});

test("useMutation mutateAsync error throws normalized error", async () => {
	const client = createAthenaQueryClient();
	let latest: UseMutationResult<{ id: string }, { id: string }> | undefined;

	await act(async () => {
		create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(MutationProbe, {
					hook: () =>
						useMutation({
							mutationFn: async () => {
								throw new Error("mutation failed");
							},
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	let thrown: unknown;
	await act(async () => {
		try {
			await latest?.mutateAsync({ id: "1" });
		} catch (error) {
			thrown = error;
		}
		await flush();
	});

	assert(thrown);
	assert.equal((thrown as { message?: string }).message, "mutation failed");
	assert(latest);
	assert.equal(latest.status, "error");
	assert.equal(latest.error?.message, "mutation failed");
});

test("useMutation mutate updates status and reset clears state", async () => {
	const client = createAthenaQueryClient();
	const deferred = createDeferred<{ id: string }>();

	let latest: UseMutationResult<{ name: string }, { id: string }> | undefined;

	await act(async () => {
		create(
			createElement(
				AthenaQueryClientProvider,
				{ client } as any,
				createElement(MutationProbe, {
					hook: () =>
						useMutation({
							mutationFn: async () => deferred.promise,
						}),
					onChange: (value) => {
						latest = value as any;
					},
				}),
			),
		);
		await flush();
	});

	await act(async () => {
		latest?.mutate({ name: "A" });
		await flush();
	});

	assert(latest);
	assert.equal(latest.isLoading, true);

	await act(async () => {
		deferred.resolve({ id: "9" });
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "success");
	assert.deepEqual(latest.data, { id: "9" });

	await act(async () => {
		latest?.reset();
		await flush();
	});

	assert(latest);
	assert.equal(latest.status, "idle");
	assert.equal(latest.data, undefined);
	assert.equal(latest.error, null);
});

test("useQuery unmount safety: no setState warning after unmount", async () => {
	const client = createAthenaQueryClient();
	const deferred = createDeferred<Array<{ id: number }>>();

	let renderer: ReactTestRenderer | undefined;
	const errors: string[] = [];
	const originalConsoleError = console.error;
	console.error = (...args: unknown[]) => {
		const line = args.map((arg) => String(arg)).join(" ");
		errors.push(line);
	};

	try {
		await act(async () => {
			renderer = create(
				createElement(
					AthenaQueryClientProvider,
					{ client } as any,
					createElement(QueryProbe, {
						hook: () =>
							useQuery({
								queryFn: async () => deferred.promise,
								queryKey: ["unmount-safe"],
							}),
						onChange: () => undefined,
					}),
				),
			);
			await flush();
		});

		await act(async () => {
			renderer?.unmount();
			await flush();
		});

		await act(async () => {
			deferred.resolve([{ id: 1 }]);
			await flush();
		});

		const unmountedWarnings = errors.filter((line) =>
			line.toLowerCase().includes("unmounted"),
		);
		assert.equal(unmountedWarnings.length, 0);
	} finally {
		console.error = originalConsoleError;
	}
});

test("useSession returns data and refetch parity fields", async () => {
	const calls: string[] = [];
	const authClient = {
		getSession: async () => {
			calls.push("getSession");
			return {
				data: {
					session: { id: "s_1" },
					user: { email: "u@example.com", id: "u_1" },
				},
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			};
		},
	};

	let latest: UseSessionResult | undefined;

	await act(async () => {
		create(
			createElement(SessionProbe, {
				hook: () => useSession(authClient),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert.equal(calls.length, 1);
	assert(latest);
	assert.equal(latest.isPending, false);
	assert.equal(latest.isRefetching, false);
	assert.equal(latest.isAuthenticated, true);
	assert.equal(latest.data?.session.id, "s_1");
	assert.equal(latest.user?.id, "u_1");
	assert.equal(latest.organizationId, null);
	assert.equal(latest.organization?.activeId, null);
	assert.equal(latest.organization?.rawActiveId, null);

	await act(async () => {
		const refetched = await latest?.refetch();
		assert.equal(refetched?.session.id, "s_1");
		await flush();
	});

	assert.equal(calls.length, 2);
});

test("useSession accepts createClient-style auth namespace input", async () => {
	const calls: string[] = [];
	const client = {
		auth: {
			getSession: async () => {
				calls.push("getSession");
				return {
					data: {
						session: { id: "s_2" },
						user: { email: "u2@example.com", id: "u_2" },
					},
					error: null,
					errorDetails: null,
					ok: true,
					raw: null,
					status: 200,
				};
			},
		},
	};

	let latest: UseSessionResult | undefined;
	await act(async () => {
		create(
			createElement(SessionProbe, {
				hook: () => useSession(client),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert.equal(calls.length, 1);
	assert(latest);
	assert.equal(latest.data?.session.id, "s_2");
	assert.equal(latest.isAuthenticated, true);
	assert.equal(latest.session?.id, "s_2");
});

test("useSession surfaces error details on failed session request", async () => {
	const authClient = {
		getSession: async () => ({
			data: null,
			error: "unauthorized",
			errorDetails: {
				code: "HTTP_ERROR" as const,
				endpoint: "/get-session" as const,
				message: "unauthorized",
				method: "GET" as const,
				status: 401,
			},
			ok: false,
			raw: null,
			status: 401,
		}),
	};

	let latest: UseSessionResult | undefined;
	await act(async () => {
		create(
			createElement(SessionProbe, {
				hook: () => useSession(authClient),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.data, null);
	assert.equal(latest.isAuthenticated, false);
	assert.equal(latest.error?.code, "HTTP_ERROR");
	assert.equal(latest.isPending, false);
});

test("useSession ignores AbortError without NETWORK_ERROR", async () => {
	let calls = 0;
	const authClient = {
		getSession: async () => {
			calls += 1;
			if (calls === 1) {
				return {
					data: {
						session: { id: "s_ok", activeOrganizationId: "org_1" },
						user: { email: "u@example.com", id: "u_ok" },
					},
					error: null,
					errorDetails: null,
					ok: true,
					raw: null,
					status: 200,
				};
			}
			const err = new Error("aborted");
			err.name = "AbortError";
			throw err;
		},
	};

	let latest: UseSessionResult | undefined;
	let renderer: ReactTestRenderer;
	await act(async () => {
		renderer = create(
			createElement(SessionProbe, {
				hook: () => useSession(authClient),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert.equal(latest?.isAuthenticated, true);
	assert.equal(latest?.data?.session.id, "s_ok");
	assert.equal(latest?.error, null);

	await act(async () => {
		await latest?.refetch();
		await flush();
	});

	// Abort must not clear session or invent a network error
	assert.equal(latest?.data?.session.id, "s_ok");
	assert.equal(latest?.error, null);
	assert.equal(latest?.isAuthenticated, true);
	assert.equal(calls, 2);
});

test("useSession concurrent mounts dedupe default getSession", async () => {
	let calls = 0;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const getSession = async () => {
		calls += 1;
		await gate;
		return {
			data: {
				session: { id: "s_dedupe" },
				user: { email: "d@example.com", id: "u_dedupe" },
			},
			error: null,
			errorDetails: null,
			ok: true,
			raw: null,
			status: 200,
		};
	};
	const authClient = { getSession };

	const latest: UseSessionResult[] = [];
	await act(async () => {
		create(
			createElement(SessionProbe, {
				hook: () => useSession(authClient),
				onChange: (value) => {
					latest[0] = value as any;
				},
			}),
		);
		create(
			createElement(SessionProbe, {
				hook: () => useSession(authClient),
				onChange: (value) => {
					latest[1] = value as any;
				},
			}),
		);
		// Let effects schedule both mounts against the shared in-flight promise.
		await flush();
		assert.equal(calls, 1);
		release();
		await flush();
		await flush();
	});

	assert.equal(calls, 1);
	assert.equal(latest[0]?.data?.session.id, "s_dedupe");
	assert.equal(latest[1]?.data?.session.id, "s_dedupe");
	assert.equal(latest[0]?.isAuthenticated, true);
	assert.equal(latest[1]?.isAuthenticated, true);
});

test("useAdminPermission short-circuits on local admin role", async () => {
	let hasPermissionCalls = 0;
	const client = {
		admin: {
			hasPermission: async () => {
				hasPermissionCalls += 1;
				return {
					data: { success: true },
					error: null,
					errorDetails: null,
					ok: true,
					raw: null,
					status: 200,
				};
			},
		},
		getSession: async () => ({
			data: {
				session: { id: "s_admin" },
				user: { id: "u_admin", role: "admin" },
			},
			error: null,
			errorDetails: null,
			ok: true,
			raw: null,
			status: 200,
		}),
	};

	let latest: UseAdminPermissionResult | undefined;
	await act(async () => {
		create(
			createElement(AdminPermissionProbe, {
				hook: () =>
					useAdminPermission(client as any, { permissions: ["admin:read"] }),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
		await flush();
	});

	assert(latest);
	assert.equal(latest.allowed, true);
	assert.equal(latest.isPending, false);
	assert.equal(hasPermissionCalls, 0);
});

test("useAdminPermission denies when session user is missing", async () => {
	const client = {
		admin: {
			hasPermission: async () => ({
				data: { success: true },
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			}),
		},
		getSession: async () => ({
			data: {
				session: { id: "s_guest" },
				user: null,
			},
			error: null,
			errorDetails: null,
			ok: true,
			raw: null,
			status: 200,
		}),
	};

	let latest: UseAdminPermissionResult | undefined;
	await act(async () => {
		create(
			createElement(AdminPermissionProbe, {
				hook: () => useAdminPermission(client as any),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
		await flush();
	});

	assert(latest);
	assert.equal(latest.allowed, false);
	assert.equal(latest.isPending, false);
});

test("useAthenaSessionClient derives a scoped client and current organization id", async () => {
	let activeOrganizationId = "org_1";
	const baseClient = {
		auth: {
			getSession: async () => ({
				data: {
					session: {
						activeOrganizationId,
						id: "s_1",
						token: "session-token",
					},
					user: {
						email: "u@example.com",
						id: "u_1",
					},
				},
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			}),
		},
		withContext: (context: { organizationId?: string | null }) => ({
			scopedOrganizationId: context.organizationId ?? null,
		}),
	};

	let latest: UseAthenaSessionClientResult<typeof baseClient> | undefined;
	await act(async () => {
		create(
			createElement(AthenaSessionClientProbe, {
				hook: () => useAthenaSessionClient(baseClient),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.userId, "u_1");
	assert.equal(latest.organizationId, "org_1");
	assert.equal(latest.session?.session.activeOrganizationId, "org_1");
	assert.deepEqual(latest.client, {
		scopedOrganizationId: "org_1",
	});

	await act(async () => {
		activeOrganizationId = "org_2";
		const refetched = await latest?.refetch();
		assert.equal(refetched?.session.activeOrganizationId, "org_2");
		await flush();
	});

	assert(latest);
	assert.equal(latest.organizationId, "org_2");
	assert.deepEqual(latest.client, {
		scopedOrganizationId: "org_2",
	});
});

test("useAthenaSessionClient returns the base client when the user is unauthorized", async () => {
	let withContextCalls = 0;
	const baseClient = {
		auth: {
			getSession: async () => ({
				data: null,
				error: "Unauthorized",
				errorDetails: {
					code: "HTTP_ERROR" as const,
					message: "Unauthorized",
					status: 401,
				},
				ok: false,
				raw: null,
				status: 401,
			}),
		},
		withContext: () => {
			withContextCalls += 1;
			return { scoped: true };
		},
	};

	let latest: UseAthenaSessionClientResult<typeof baseClient> | undefined;
	await act(async () => {
		create(
			createElement(AthenaSessionClientProbe, {
				hook: () => useAthenaSessionClient(baseClient),
				onChange: (value) => {
					latest = value as any;
				},
			}),
		);
		await flush();
	});

	assert(latest);
	assert.equal(latest.session, null);
	assert.equal(latest.organizationId, null);
	assert.equal(latest.client, baseClient);
	assert.equal(withContextCalls, 0);
	assert.equal(latest.error?.status, 401);
});
