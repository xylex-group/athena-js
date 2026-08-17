import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AthenaConfigurationError } from "../src/config/errors.ts";
import { createClient } from "../src/v3-client.ts";
import { createAthenaBrowserClient } from "../src/next/client.ts";
import {
	createAthenaServerClient,
	resolveAthenaServerContext,
	resolveNextRequestContext,
} from "../src/next/server.ts";

test("resolveNextRequestContext forwards request cookie, bearer, custom headers, and cache state", async () => {
	const context = await resolveNextRequestContext({
		forceNoCache: true,
		headers: { "X-Company-Id": "company_1" },
		requestCookies: "athena-auth.session_token=session_cookie; theme=dark",
		requestHeaders: { authorization: "Bearer bearer_1" },
	});

	assert.equal(
		context.cookie,
		"athena-auth.session_token=session_cookie; theme=dark",
	);
	assert.equal(context.bearerToken, "bearer_1");
	assert.equal(context.forceNoCache, true);
	assert.equal(context.headers?.["X-Company-Id"], "company_1");
	assert.equal(context.headers?.authorization, "Bearer bearer_1");
});

test("resolveAthenaServerContext maps supplied session identity into request context", async () => {
	const resolved = await resolveAthenaServerContext({
		requestCookies: "",
		requestHeaders: {},
		session: {
			session: { activeOrganizationId: "org_1", id: "session_1" },
			user: { email: "user@example.com", id: "user_1" },
		},
	});

	assert.equal(resolved.userId, "user_1");
	assert.equal(resolved.organizationId, "org_1");
	assert.equal(resolved.request.userId, "user_1");
	assert.equal(resolved.request.organizationId, "org_1");
});

test("createAthenaBrowserClient delegates explicit configuration", () => {
	const client = createAthenaBrowserClient({
		client: "browser-app",
		key: "publishable_key",
		url: "https://athena.example.com",
	});

	assert.equal(typeof client.from, "function");
	assert.equal(typeof client.withContext, "function");
	assert.equal(typeof client.auth, "object");
});

test("createAthenaServerClient({ client }) only layers withContext — no re-materialize", async () => {
	let withContextCalls = 0;
	const base = createClient({
		auth: {
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		key: "key",
		url: "https://athena.example.com",
	});
	// Frozen client — wrap rather than mutate for the architectural probe.
	const probe = {
		withContext(context: Parameters<typeof base.withContext>[0]) {
			withContextCalls += 1;
			return base.withContext(context);
		},
	};

	const view = await createAthenaServerClient({
		client: probe as never,
		requestCookies: "session=1",
		requestHeaders: {},
		session: {
			session: { id: "s1" },
			user: { id: "u1" },
		},
	});

	assert.equal(withContextCalls, 1);
	assert.equal(typeof view.auth, "object");
	assert.equal(typeof view.withContext, "function");
	// Same auth routing authority as static client
	const baseDiag = base.system.inspectAuth();
	const viewDiag = view.system.inspectAuth();
	assert.equal(baseDiag.browserRequestBaseUrl, "/api/auth");
	assert.equal(viewDiag.browserRequestBaseUrl, "/api/auth");
});

test("createAthenaBrowserClient creates independent clients without caching", () => {
	const first = createAthenaBrowserClient({
		key: "key-a",
		url: "https://athena.example.com",
	});
	const second = createAthenaBrowserClient({
		key: "key-b",
		url: "https://athena.example.com",
	});

	assert.notEqual(first, second);
});

test("browser factory source does not access process or next/headers", async () => {
	const clientSource = await readFile(
		new URL("../src/next/client.ts", import.meta.url),
		"utf8",
	);
	// Strip block/line comments so documentation mentions of process.env do not fail the check.
	const withoutComments = clientSource
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
	// Also drop remaining JSDoc-style body lines that may sit outside a matched block.
	const codeOnly = withoutComments
		.split("\n")
		.filter((line) => !/^\s*\*/.test(line))
		.join("\n");
	assert.equal(codeOnly.includes("process."), false);
	assert.equal(codeOnly.includes("process.env"), false);
	// May call createClient(config) directly or via a TS2589-safe factory cast.
	assert.equal(
		/createClient\s*\(/.test(clientSource) ||
			clientSource.includes("createClient as"),
		true,
	);
	assert.equal(clientSource.includes("createAthenaBrowserClient"), true);
	assert.equal(clientSource.includes("next/headers"), false);
});

test("createAthenaServerClient forwards cookies, bearer, custom headers, and session identity", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = await createAthenaServerClient({
			forceNoCache: true,
			headers: { "X-Company-Id": "company_1" },
			key: "server-key",
			requestCookies: "athena-auth.session_token=session_cookie",
			requestHeaders: { authorization: "Bearer bearer_server" },
			session: {
				session: { activeOrganizationId: "org_server", id: "session_server" },
				user: { email: "server@example.com", id: "user_server" },
			},
			url: "https://athena.example.com",
		});

		await client.from("users").select();

		assert.equal(capturedHeaders.length, 1);
		const headers = capturedHeaders[0];
		assert.equal(headers.get("x-user-id"), "user_server");
		assert.equal(headers.get("x-organization-id"), "org_server");
		assert.equal(headers.get("x-company-id"), "company_1");
		assert.equal(headers.get("authorization"), "Bearer bearer_server");
		// cookie may appear via dedicated context.cookie and context.headers.cookie
		assert.match(
			headers.get("cookie") ?? "",
			/athena-auth\.session_token=session_cookie/,
		);
		assert.equal(headers.get("cache-control"), "no-cache");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaServerClient merges application context with request context", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = await createAthenaServerClient({
			context: {
				headers: { "X-App": "configured" },
				userId: "configured_user",
			},
			headers: { "X-Request": "request" },
			key: "server-key",
			requestCookies: "",
			requestHeaders: {},
			session: {
				session: { activeOrganizationId: "org_from_session", id: "s1" },
				user: { email: "s@example.com", id: "session_user" },
			},
			url: "https://athena.example.com",
		});

		await client.from("users").select();

		const headers = capturedHeaders[0];
		// request/session override wins for identity fields
		assert.equal(headers.get("x-user-id"), "session_user");
		assert.equal(headers.get("x-organization-id"), "org_from_session");
		// headers are deep-merged
		assert.equal(headers.get("x-app"), "configured");
		assert.equal(headers.get("x-request"), "request");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaServerClient resolves context on every invocation without caching clients", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const first = await createAthenaServerClient({
			key: "server-key",
			requestCookies: "token=first",
			requestHeaders: {},
			url: "https://athena.example.com",
		});
		const second = await createAthenaServerClient({
			key: "server-key",
			requestCookies: "token=second",
			requestHeaders: {},
			url: "https://athena.example.com",
		});

		assert.notEqual(first, second);

		await first.from("users").select();
		await second.from("users").select();

		assert.match(capturedHeaders[0].get("cookie") ?? "", /token=first/);
		assert.match(capturedHeaders[1].get("cookie") ?? "", /token=second/);
		assert.equal(
			(capturedHeaders[0].get("cookie") ?? "").includes("token=second"),
			false,
		);
		assert.equal(
			(capturedHeaders[1].get("cookie") ?? "").includes("token=first"),
			false,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaServerClient accepts explicit env configuration", async () => {
	const client = await createAthenaServerClient({
		env: {
			ATHENA_API_KEY: "env-key",
			ATHENA_URL: "https://athena.example.com",
		},
		requestCookies: "",
		requestHeaders: {},
	});

	assert.equal(typeof client.from, "function");
});

test("explicit request inputs avoid requiring next/headers", async () => {
	// If next/headers were required, this would throw ATHENA_NEXT_SERVER_RUNTIME_REQUIRED.
	const client = await createAthenaServerClient({
		key: "key",
		requestCookies: "a=b",
		requestHeaders: { authorization: "Bearer explicit" },
		url: "https://athena.example.com",
	});
	assert.equal(typeof client.request, "function");
});

test("server factory source exports createAthenaServerClient and imports server-only", async () => {
	const serverSource = await readFile(
		new URL("../src/next/server.ts", import.meta.url),
		"utf8",
	);
	assert.equal(serverSource.includes("createAthenaServerClient"), true);
	assert.equal(
		/import\s+['"]server-only['"]/.test(serverSource),
		true,
		"server factory must import server-only",
	);
	assert.equal(serverSource.includes("createClient"), true);
	assert.equal(
		serverSource.includes("createAthenaDataHandlers"),
		true,
		"server factory must export Local Runtime data handlers",
	);
});

test("missing API key fails with ATHENA_API_KEY_REQUIRED", () => {
	assert.throws(
		() =>
			createAthenaBrowserClient({
				key: "   ",
				url: "https://athena.example.com",
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_API_KEY_REQUIRED",
	);
});

test("resolveNextRequestContext accepts Headers-like and cookies bag inputs", async () => {
	const context = await resolveNextRequestContext({
		headers: { "X-App": "next" },
		requestCookies: {
			getAll() {
				return [
					{ name: "athena-auth.session_token", value: "from_bag" },
					{ name: "theme", value: "dark" },
					{ name: "  ", value: "ignored" },
				];
			},
		},
		requestHeaders: {
			get(name: string) {
				const key = name.toLowerCase();
				if (key === "authorization") {
					return "Bearer bag_token";
				}
				if (key === "x-company-id") {
					return "company_bag";
				}
				return null;
			},
		},
	});

	assert.equal(
		context.cookie,
		"athena-auth.session_token=from_bag; theme=dark",
	);
	assert.equal(context.bearerToken, "bag_token");
	assert.equal(context.headers?.authorization, "Bearer bag_token");
	assert.equal(
		context.headers?.cookie,
		"athena-auth.session_token=from_bag; theme=dark",
	);
	assert.equal(context.headers?.["X-App"], "next");
});

test("resolveNextRequestContext reads cookie header when cookies input is omitted", async () => {
	const context = await resolveNextRequestContext({
		requestHeaders: {
			authorization: "bearer  lower_case_token  ",
			cookie: "session=from_header; other=1",
		},
	});

	assert.equal(context.cookie, "session=from_header; other=1");
	assert.equal(context.bearerToken, "lower_case_token");
});

test("resolveNextRequestContext ignores blank Bearer tokens", async () => {
	const context = await resolveNextRequestContext({
		requestCookies: "",
		requestHeaders: { authorization: "Bearer    " },
	});
	assert.equal(context.bearerToken, undefined);
});

test("resolveNextRequestContext requires Next runtime when request inputs are omitted", async () => {
	await assert.rejects(
		() => resolveNextRequestContext(),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_NEXT_SERVER_RUNTIME_REQUIRED",
	);
});

test("createAthenaServerClient requires Next runtime without explicit request inputs", async () => {
	await assert.rejects(
		() =>
			createAthenaServerClient({
				key: "server-key",
				url: "https://athena.example.com",
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_NEXT_SERVER_RUNTIME_REQUIRED",
	);
});

test("createAthenaServerClient merges async application context with request context", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = await createAthenaServerClient({
			context: async () => ({
				headers: { "X-Async-App": "from_provider" },
				userId: "configured_user",
			}),
			key: "server-key",
			requestCookies: "token=async",
			requestHeaders: { authorization: "Bearer async_bearer" },
			session: {
				session: { activeOrganizationId: "org_async", id: "s1" },
				user: { email: "s@example.com", id: "session_user" },
			},
			url: "https://athena.example.com",
		});

		await client.from("users").select();

		const headers = capturedHeaders[0];
		assert.equal(headers.get("x-user-id"), "session_user");
		assert.equal(headers.get("x-organization-id"), "org_async");
		assert.equal(headers.get("x-async-app"), "from_provider");
		assert.equal(headers.get("authorization"), "Bearer async_bearer");
		assert.match(headers.get("cookie") ?? "", /token=async/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaBrowserClient and createAthenaServerClient accept models registries at runtime", async () => {
	const originalFetch = globalThis.fetch;
	const captured: string[] = [];
	globalThis.fetch = async (url) => {
		captured.push(String(url));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	const models = {
		app: {
			schemas: {
				public: {
					models: {
						users: {
							meta: {
								primaryKey: ["id"],
								tableName: "public.users",
							},
						},
					},
				},
			},
		},
	};

	try {
		const browser = createAthenaBrowserClient({
			key: "publishable_key",
			models,
			url: "https://athena.example.com",
		});
		await browser.from("users").select("*");

		const server = await createAthenaServerClient({
			key: "server-key",
			models,
			requestCookies: "",
			requestHeaders: {},
			url: "https://athena.example.com",
		});
		await server.from("users").select("*");

		assert.equal(captured.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("resolveAthenaServerContext nulls identity when session is absent", async () => {
	const resolved = await resolveAthenaServerContext({
		requestCookies: "a=1",
		requestHeaders: { authorization: "Bearer only" },
	});

	assert.equal(resolved.session, null);
	assert.equal(resolved.userId, null);
	assert.equal(resolved.organizationId, null);
	assert.equal(resolved.request.userId, null);
	assert.equal(resolved.request.organizationId, null);
	assert.equal(resolved.request.bearerToken, "only");
	assert.equal(resolved.request.cookie, "a=1");
});

test("resolveAthenaServerContext applies explicit scope identity", async () => {
	const resolved = await resolveAthenaServerContext({
		requestCookies: "",
		requestHeaders: {},
		scope: {
			organizationId: "scoped_org",
			userId: "scoped_user",
		},
	});

	assert.equal(resolved.userId, "scoped_user");
	assert.equal(resolved.organizationId, "scoped_org");
	assert.equal(resolved.request.userId, "scoped_user");
	assert.equal(resolved.request.organizationId, "scoped_org");
});

test("resolveAthenaServerContext lets scope fields override session identity", async () => {
	const resolved = await resolveAthenaServerContext({
		requestCookies: "",
		requestHeaders: {},
		scope: {
			organizationId: "override_org",
		},
		session: {
			session: { activeOrganizationId: "session_org", id: "s1" },
			user: { email: "s@example.com", id: "session_user" },
		},
	});

	assert.equal(resolved.userId, "session_user");
	assert.equal(resolved.organizationId, "override_org");
});

test("resolveAthenaServerContext empty scope keeps session and warns in non-production", async () => {
	const originalWarn = console.warn;
	const warnings: string[] = [];
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	};

	try {
		const resolved = await resolveAthenaServerContext({
			requestCookies: "",
			requestHeaders: {},
			scope: {},
			session: {
				session: { activeOrganizationId: "session_org", id: "s1" },
				user: { email: "s@example.com", id: "session_user" },
			},
		});

		assert.equal(resolved.userId, "session_user");
		assert.equal(resolved.organizationId, "session_org");
		assert.equal(
			warnings.some(
				(message) =>
					message.includes("scope") && message.includes("without userId"),
			),
			true,
		);
	} finally {
		console.warn = originalWarn;
	}
});

test("createAthenaServerClient applies scope headers on outbound requests", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = await createAthenaServerClient({
			key: "server-key",
			requestCookies: "",
			requestHeaders: {},
			scope: {
				organizationId: "scope_org",
				userId: "scope_user",
			},
			url: "https://athena.example.com",
		});

		await client.from("users").select();

		const headers = capturedHeaders[0];
		assert.equal(headers.get("x-user-id"), "scope_user");
		assert.equal(headers.get("x-organization-id"), "scope_org");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("withContext empty object warns in non-production", async () => {
	const { createClient, isEmptyAthenaRequestContext } = await import(
		"../src/v3-client.ts"
	);
	assert.equal(isEmptyAthenaRequestContext({}), true);
	assert.equal(isEmptyAthenaRequestContext({ userId: "u1" }), false);

	const originalWarn = console.warn;
	const warnings: string[] = [];
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	};

	try {
		const client = createClient({
			key: "key",
			url: "https://athena.example.com",
		});
		const scoped = client.withContext({});
		assert.equal(typeof scoped.from, "function");
		assert.equal(
			warnings.some((message) => message.includes("withContext({})")),
			true,
		);
	} finally {
		console.warn = originalWarn;
	}
});

test("resolveNextRequestContext treats empty cookie bags as missing", async () => {
	const context = await resolveNextRequestContext({
		requestCookies: {
			getAll() {
				return [{ name: "   ", value: "ignored" }];
			},
		},
		requestHeaders: { cookie: "from_header=1" },
	});

	// Blank cookie names are dropped; header cookie is used as fallback.
	assert.equal(context.cookie, "from_header=1");
});

test("createAthenaServerClient propagates forceNoCache into request headers path", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = await createAthenaServerClient({
			forceNoCache: true,
			key: "server-key",
			requestCookies: "",
			requestHeaders: {},
			url: "https://athena.example.com",
		});
		await client.from("users").select();

		const headers = capturedHeaders[0];
		assert.match(
			(headers.get("cache-control") ?? "").toLowerCase(),
			/no-cache|no-store/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("next/client does not export createAthenaServerClient", async () => {
	const client = await import("../src/next/client.ts");
	assert.equal(
		"createAthenaServerClient" in client,
		false,
		"server factory must stay out of the browser Next entry",
	);
	assert.equal(typeof client.createAthenaBrowserClient, "function");
});

test("createClient emits gateway identity headers without buildAthenaGatewayHeaders", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const { createClient } = await import("../src/v3-client.ts");
		const client = createClient({
			client: "app-client",
			key: "semantic-key",
			url: "https://athena.example.com",
		});

		await client.from("users").select();

		const headers = capturedHeaders[0];
		assert.equal(headers.get("x-athena-key"), "semantic-key");
		assert.equal(headers.get("x-athena-client"), "app-client");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaServerClient({ client }) layers request context without reconfiguring static options", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const base = createAthenaBrowserClient({
			client: "shared-app",
			key: "shared-key",
			url: "https://athena.example.com",
		});

		const scoped = await createAthenaServerClient({
			// `as never` keeps generic depth under the TS2589 limit (house pattern).
			client: base as never,
			forceNoCache: true,
			headers: { "X-Company-Id": "company_shared" },
			requestCookies: "athena-auth.session_token=from_base_client",
			requestHeaders: { authorization: "Bearer from_base" },
			session: {
				session: { activeOrganizationId: "org_from_base", id: "s_base" },
				user: { email: "base@example.com", id: "user_from_base" },
			},
		});

		await scoped.from("users").select();

		const headers = capturedHeaders[0];
		assert.equal(headers.get("x-athena-key"), "shared-key");
		assert.equal(headers.get("x-athena-client"), "shared-app");
		assert.equal(headers.get("x-user-id"), "user_from_base");
		assert.equal(headers.get("x-organization-id"), "org_from_base");
		assert.equal(headers.get("x-company-id"), "company_shared");
		assert.equal(headers.get("authorization"), "Bearer from_base");
		assert.match(
			headers.get("cookie") ?? "",
			/athena-auth\.session_token=from_base_client/,
		);
		assert.equal(headers.get("cache-control"), "no-cache");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createAthenaServerClient({ client }) isolates concurrent request contexts", async () => {
	const originalFetch = globalThis.fetch;
	const captured: Array<{ cookie: string; userId: string | null }> = [];
	globalThis.fetch = async (_url, init) => {
		const headers = new Headers(init?.headers);
		captured.push({
			cookie: headers.get("cookie") ?? "",
			userId: headers.get("x-user-id"),
		});
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const base = createAthenaBrowserClient({
			client: "concurrent-app",
			key: "concurrent-key",
			url: "https://athena.example.com",
		});

		const [a, b] = await Promise.all([
			createAthenaServerClient({
				// `as never` keeps generic depth under the TS2589 limit (house pattern).
				client: base as never,
				requestCookies: "token=session-a",
				requestHeaders: {},
				session: {
					session: { activeOrganizationId: "org-a", id: "sa" },
					user: { id: "user-a" },
				},
			}),
			createAthenaServerClient({
				client: base as never,
				requestCookies: "token=session-b",
				requestHeaders: {},
				session: {
					session: { activeOrganizationId: "org-b", id: "sb" },
					user: { id: "user-b" },
				},
			}),
		]);

		await Promise.all([a.from("users").select(), b.from("users").select()]);

		assert.equal(captured.length, 2);
		const byUser = Object.fromEntries(
			captured.map((entry) => [entry.userId, entry.cookie]),
		);
		assert.match(byUser["user-a"] ?? "", /token=session-a/);
		assert.match(byUser["user-b"] ?? "", /token=session-b/);
		assert.equal((byUser["user-a"] ?? "").includes("token=session-b"), false);
		assert.equal((byUser["user-b"] ?? "").includes("token=session-a"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
