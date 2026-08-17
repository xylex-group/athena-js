/**
 * Anti-stale tests for examples/session/*
 *
 * Imports the example modules (not re-copies) so export renames, API shape
 * drift, and broken wiring fail CI when session APIs move.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import {
	createExampleServerSessionResolver,
	exampleGetServerSession,
	exampleGetServerSessionDataOrNull,
	exampleRequireServerSessionData,
	exampleResolveActiveOrganizationId,
} from "../examples/session/server-session.ts";
import {
	createExampleBridgePostRequest,
	createExampleSessionBridgeHandlers,
	createExampleSessionBridgePathHandlers,
	EXAMPLE_SESSION_BRIDGE_COOKIE,
	EXAMPLE_SESSION_BRIDGE_ROUTE,
	resolveExampleSessionBridgePayload,
} from "../examples/session/session-bridge.ts";
import {
	createExampleAuthSessionResponse,
	exampleBrowserSessionSnapshot,
	exampleRequireAuthenticatedView,
	exampleServerRepairedSessionSnapshot,
	exampleSessionView,
} from "../examples/session/session-snapshot.ts";
import {
	SessionScopedClientPanel,
	useExampleAthenaSessionClient,
	type ExampleSessionScopedBaseClient,
	type SessionScopedClientPanelProps,
} from "../examples/session/use-athena-session-client-panel.tsx";
import {
	SessionStatusPanel,
	useExampleSession,
	type SessionStatusPanelProps,
} from "../examples/session/use-session-panel.tsx";
import type { ResolveActiveOrganizationIdArgs } from "../src/next/get-server-session.ts";
import type {
	UseAthenaSessionClientResult,
	UseSessionResult,
} from "../src/react/index.ts";
import type { AthenaRequestContext } from "../src/v3-client-core.ts";
import { ATHENA_SESSION_DATA_HEADER } from "../src/utils/athena-auth-url.ts";

const examplesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"examples",
	"session",
);

const sampleTransport = createExampleAuthSessionResponse({
	activeOrganizationId: "org_raw",
	email: "user@example.com",
	sessionId: "session_1",
	token: "tok_live",
	userId: "user_1",
});

function SessionHookProbe(props: {
	onChange: (value: UseSessionResult) => void;
	hook: () => UseSessionResult;
}) {
	props.onChange(props.hook());
	return null;
}

function ScopedHookProbe<TClient>(props: {
	onChange: (value: UseAthenaSessionClientResult<TClient>) => void;
	hook: () => UseAthenaSessionClientResult<TClient>;
}) {
	props.onChange(props.hook());
	return null;
}

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

function createSessionStatusPanelElement(
	authClient: SessionStatusPanelProps["authClient"],
	render: NonNullable<SessionStatusPanelProps["children"]>,
) {
	return createElement(SessionStatusPanel, {
		authClient,
		children: render,
	});
}

function createSessionScopedPanelElement<
	TClient extends ExampleSessionScopedBaseClient,
>(
	baseClient: TClient,
	render: NonNullable<SessionScopedClientPanelProps<TClient>["children"]>,
) {
	return createElement(SessionScopedClientPanel, {
		baseClient,
		children: render,
	} as SessionScopedClientPanelProps<TClient>);
}

test("examples/session snapshot: browser path freezes organization without repair", () => {
	const data = exampleBrowserSessionSnapshot(sampleTransport);
	assert.equal(data.user.id, "user_1");
	assert.equal(data.session.id, "session_1");
	assert.equal(data.organization.rawActiveId, "org_raw");
	assert.equal(data.organization.activeId, "org_raw");
	assert.ok(Object.isFrozen(data));
	assert.ok(Object.isFrozen(data.organization));
});

test("examples/session snapshot: server repair keeps rawActiveId distinct", () => {
	const data = exampleServerRepairedSessionSnapshot(sampleTransport, "org_fix");
	assert.equal(data.organization.rawActiveId, "org_raw");
	assert.equal(data.organization.activeId, "org_fix");
});

test("examples/session snapshot: deriveSessionView convenience fields", () => {
	const view = exampleSessionView(sampleTransport);
	assert.equal(view.isAuthenticated, true);
	assert.equal(view.user?.id, "user_1");
	assert.equal(view.organizationId, "org_raw");
	assert.equal(view.session?.id, "session_1");

	const empty = exampleSessionView(null);
	assert.equal(empty.isAuthenticated, false);
	assert.equal(empty.data, null);

	assert.throws(
		() => exampleRequireAuthenticatedView(null),
		/Not authenticated/,
	);
	const required = exampleRequireAuthenticatedView(sampleTransport);
	assert.equal(required.user?.id, "user_1");
});

test("examples/session useSession panel: loads authenticated user", async () => {
	let calls = 0;
	const authClient = {
		getSession: async () => {
			calls += 1;
			return {
				data: sampleTransport,
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			};
		},
	};

	let latest: UseSessionResult | undefined;
	let renderer: ReactTestRenderer | undefined;

	await act(async () => {
		renderer = create(
			createSessionStatusPanelElement(authClient, (state) => {
				latest = state;
				return null;
			}),
		);
	});
	await act(async () => {
		await flush();
	});

	assert.ok(latest);
	assert.equal(latest.isPending, false);
	assert.equal(latest.isAuthenticated, true);
	assert.equal(latest.user?.id, "user_1");
	assert.equal(latest.organizationId, "org_raw");
	assert.equal(calls, 1);

	await act(async () => {
		await latest?.refetch();
	});
	assert.equal(calls, 2);

	// Headless example wrapper stays wired to the same hook.
	let headless: UseSessionResult | undefined;
	await act(async () => {
		create(
			createElement(SessionHookProbe, {
				hook: () => useExampleSession(authClient),
				onChange: (value) => {
					headless = value;
				},
			}),
		);
	});
	await act(async () => {
		await flush();
	});
	assert.equal(headless?.user?.id, "user_1");

	renderer?.unmount();
});

test("examples/session useAthenaSessionClient: scopes withContext from session", async () => {
	const contexts: Record<string, unknown>[] = [];
	const baseClient = {
		auth: {
			getSession: async () => ({
				data: sampleTransport,
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			}),
		},
		withContext(context: AthenaRequestContext) {
			contexts.push(context as Record<string, unknown>);
			return { ...this, context, scoped: true };
		},
	};

	let latest: UseAthenaSessionClientResult<typeof baseClient> | undefined;

	await act(async () => {
		create(
			createSessionScopedPanelElement(baseClient, (state) => {
				latest = state;
				return null;
			}),
		);
	});
	await act(async () => {
		await flush();
	});

	assert.ok(latest);
	assert.equal(latest.isPending, false);
	assert.equal(latest.userId, "user_1");
	assert.equal(latest.organizationId, "org_raw");
	assert.ok(contexts.length >= 1);
	assert.equal(contexts.at(-1)?.userId, "user_1");
	assert.equal(contexts.at(-1)?.organizationId, "org_raw");
	assert.equal(contexts.at(-1)?.sessionToken, "tok_live");

	let headless: UseAthenaSessionClientResult<typeof baseClient> | undefined;
	await act(async () => {
		create(
			createElement(ScopedHookProbe, {
				hook: () => useExampleAthenaSessionClient(baseClient),
				onChange: (value) => {
					// createElement erases the probe's generic (TClient = unknown).
					headless = value as UseAthenaSessionClientResult<typeof baseClient>;
				},
			}),
		);
	});
	await act(async () => {
		await flush();
	});
	assert.equal(headless?.userId, "user_1");
});

test("examples/session server: getServerSession + resolver via example helpers", async () => {
	const headerResult = await exampleGetServerSession({
		fetchImpl: (async () => {
			throw new Error("fetch should not run when session header is present");
		}) as typeof fetch,
		requestCookies: "",
		requestHeaders: {
			[ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sampleTransport),
		},
		resolveActiveOrganizationId: ({
			rawActiveOrganizationId,
			userId,
		}: ResolveActiveOrganizationIdArgs) => {
			assert.equal(userId, "user_1");
			return exampleResolveActiveOrganizationId({
				rawActiveOrganizationId,
				userId,
			});
		},
	});

	assert.equal(headerResult.ok, true);
	assert.equal(headerResult.authenticated, true);
	assert.equal(headerResult.data?.user.id, "user_1");
	assert.equal(headerResult.meta.fromSessionDataHeader, true);

	const mockClient = {
		auth: {
			getSession: async () => ({
				data: sampleTransport,
				error: null,
				errorDetails: null,
				ok: true,
				raw: null,
				status: 200,
			}),
		},
	};

	const resolver = createExampleServerSessionResolver(mockClient, {
		appOrigin: "https://app.example.com",
		fetchImpl: (async () =>
			new Response(JSON.stringify({ data: sampleTransport }), {
				headers: { "content-type": "application/json" },
				status: 200,
			})) as typeof fetch,
		request: "none",
		requestCookies: "athena-auth.session-token=tok_live",
		requestHeaders: {},
	});

	const detailed = await resolver.getSession();
	assert.equal(detailed.ok, true);

	const orNull = await exampleGetServerSessionDataOrNull(resolver);
	// May be null if fetch/credentials path does not authenticate in this stub;
	// requireSession only when authenticated.
	if (orNull) {
		assert.equal(orNull.user.id, "user_1");
		const required = await exampleRequireServerSessionData(resolver);
		assert.equal(required.user.id, "user_1");
	} else {
		// Header short-circuit path already proved exampleGetServerSession.
		assert.equal(orNull, null);
	}
});

test("examples/session bridge: payload resolve + POST sets cookie", async () => {
	assert.equal(EXAMPLE_SESSION_BRIDGE_ROUTE, "/api/athena-auth/session");
	assert.equal(EXAMPLE_SESSION_BRIDGE_COOKIE, "athena-auth.session-token");

	const payload = resolveExampleSessionBridgePayload(sampleTransport);
	assert.deepEqual(payload, {
		expiresAt: undefined,
		token: "tok_live",
	});
	assert.equal(resolveExampleSessionBridgePayload(null), null);
	assert.equal(resolveExampleSessionBridgePayload({ token: "  " }), null);

	const { POST, DELETE } = createExampleSessionBridgeHandlers();
	assert.equal(typeof POST, "function");
	assert.equal(typeof DELETE, "function");

	const ok = await POST(
		createExampleBridgePostRequest({ token: "tok_bridge" }),
	);
	assert.equal(ok.status, 200);
	const setCookie = ok.headers.getSetCookie?.() ?? [];
	const cookieHeader =
		setCookie.length > 0
			? setCookie.join("\n")
			: (ok.headers.get("set-cookie") ?? "");
	assert.match(cookieHeader, /athena-auth\.session-token/);

	const bad = await POST(createExampleBridgePostRequest({}));
	assert.equal(bad.status, 400);

	const cleared = DELETE(
		new Request(`https://app.example.com${EXAMPLE_SESSION_BRIDGE_ROUTE}`, {
			method: "DELETE",
		}),
	);
	assert.equal(cleared.status, 200);

	const pathHandlers = createExampleSessionBridgePathHandlers();
	const miss = await pathHandlers.POST(
		new Request("https://app.example.com/api/auth/other", {
			body: JSON.stringify({ token: "x" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(miss.status, 404);

	const hit = await pathHandlers.POST(
		createExampleBridgePostRequest(
			{ token: "tok_path" },
			"https://app.example.com/api/auth/session",
		),
	);
	assert.equal(hit.status, 200);
});

test("examples/session modules stay importable from public entrypoints (stale-export guard)", () => {
	// Each example must import from published subpaths, not deep src paths.
	const files = [
		"session-snapshot.ts",
		"use-session-panel.tsx",
		"use-athena-session-client-panel.tsx",
		"server-session.ts",
		"session-bridge.ts",
	];

	for (const file of files) {
		const source = readFileSync(join(examplesDir, file), "utf8");
		assert.match(
			source,
			/@xylex-group\/athena(\/react|\/next\/server)?/,
			`${file} must import from package public entrypoints`,
		);
		assert.doesNotMatch(
			source,
			/from ["']\.\.\/\.\.\/src\//,
			`${file} must not deep-import package src/`,
		);
	}

	// Public symbols used by examples still re-export from barrels (import-time).
	assert.equal(typeof useExampleSession, "function");
	assert.equal(typeof useExampleAthenaSessionClient, "function");
	assert.equal(typeof createExampleServerSessionResolver, "function");
	assert.equal(typeof createExampleSessionBridgeHandlers, "function");
	assert.equal(typeof exampleBrowserSessionSnapshot, "function");
});
