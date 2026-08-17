/**
 * Athena 5 Finality — canonical session owner (SESSION-INV-01…09).
 * Failure messages cite the invariant id.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthModule } from "../src/auth/client.ts";
import { createAthenaAuthSessionController } from "../src/auth/session-controller.ts";
import { sessionInvariantMessage } from "../src/auth/session-invariants.ts";
import { createAthenaServerClient } from "../src/next/server.ts";
import { createClient } from "../src/v3-client.ts";

type SessionPayload = {
	session: { id: string; token?: string };
	user: { id: string; email: string };
};

function payload(id: string, userId: string): SessionPayload {
	return {
		session: { id, token: id },
		user: { id: userId, email: `${userId}@example.com` },
	};
}

function installFetch(
	handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = handler as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

test("T-SESS-01 simultaneous refresh single-flight", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	const first = store.beginRefresh();
	const second = store.beginRefresh();
	assert.equal(first.skipped, false, sessionInvariantMessage("SESSION-INV-01"));
	assert.equal(second.skipped, true, sessionInvariantMessage("SESSION-INV-01"));
	assert.equal(
		second.epoch,
		first.epoch,
		sessionInvariantMessage("SESSION-INV-01"),
	);
});

test("T-SESS-02 sign-in beats stale refresh", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	const flight = store.beginRefresh();
	store.accept(payload("signed-in", "u-new"));
	store.completeRefresh(flight.epoch, {
		ok: true,
		session: payload("stale", "u-old"),
	});
	assert.equal(
		store.get()?.session.id,
		"signed-in",
		sessionInvariantMessage("SESSION-INV-02"),
	);
});

test("T-SESS-03 sign-out beats stale refresh", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	store.accept(payload("s1", "u1"));
	const flight = store.beginRefresh();
	store.invalidate("signOut");
	store.completeRefresh(flight.epoch, {
		ok: true,
		session: payload("s2", "u1"),
	});
	assert.equal(store.get(), null, sessionInvariantMessage("SESSION-INV-03"));
	assert.equal(
		store.getSnapshot().status,
		"unauthenticated",
		sessionInvariantMessage("SESSION-INV-03"),
	);
});

test("T-SESS-04 revoke beats stale refresh", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	store.accept(payload("s1", "u1"));
	const flight = store.beginRefresh();
	store.invalidate("revoke");
	store.completeRefresh(flight.epoch, {
		ok: true,
		session: payload("s1", "u1"),
	});
	assert.equal(store.get(), null, sessionInvariantMessage("SESSION-INV-04"));
});

test("T-SESS-05 transient error preserves valid session", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	store.accept(payload("s1", "u1"));
	store.setError(new Error("upstream timeout"));
	assert.equal(
		store.get()?.session.id,
		"s1",
		sessionInvariantMessage("SESSION-INV-05"),
	);
	assert.equal(
		store.getSnapshot().status,
		"authenticated",
		sessionInvariantMessage("SESSION-INV-05"),
	);
});

test("T-SESS-06 invalid session clears state", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	store.accept(payload("s1", "u1"));
	const flight = store.beginRefresh();
	store.completeRefresh(flight.epoch, {
		ok: false,
		error: { status: 401 },
		clearSession: true,
	});
	assert.equal(store.get(), null, sessionInvariantMessage("SESSION-INV-06"));
	assert.equal(
		store.getSnapshot().status,
		"unauthenticated",
		sessionInvariantMessage("SESSION-INV-06"),
	);
});

test("T-SESS-07 monotonic subscriber notifications", () => {
	const store = createAthenaAuthSessionController<SessionPayload>();
	const epochs: number[] = [];
	const order: number[] = [];
	store.subscribe((snapshot) => {
		epochs.push(snapshot.epoch);
		order.push(1);
	});
	store.subscribe((snapshot) => {
		epochs.push(snapshot.epoch);
		order.push(2);
	});
	store.accept(payload("s1", "u1"));
	store.accept(payload("s2", "u1"));
	assert.deepEqual(
		order,
		[1, 2, 1, 2],
		sessionInvariantMessage("SESSION-INV-07"),
	);
	for (let index = 1; index < epochs.length; index += 1) {
		const current = epochs[index];
		const previous = epochs[index - 1];
		assert.ok(
			current !== undefined &&
				previous !== undefined &&
				current >= previous,
			sessionInvariantMessage("SESSION-INV-07", "epoch went backwards"),
		);
	}
});

test("T-SESS-08 multiple React consumers share owner", async () => {
	const restore = installFetch(async () =>
		jsonResponse({
			token: "tok_shared",
			user: { id: "u1", email: "a@example.com" },
		}),
	);
	try {
		const mod = createAuthModule({
			baseUrl: "https://auth.example.test",
			apiKey: "test-key",
		});
		const seen: string[] = [];
		const unsubA = mod.auth.session.subscribe((snapshot) => {
			seen.push(`a:${snapshot.status}:${snapshot.session?.user.id ?? "none"}`);
		});
		const unsubB = mod.auth.session.subscribe((snapshot) => {
			seen.push(`b:${snapshot.status}:${snapshot.session?.user.id ?? "none"}`);
		});
		await mod.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		unsubA();
		unsubB();
		assert.equal(mod.auth.session.get()?.user.id, "u1");
		assert.ok(
			seen.some((row) => row.startsWith("a:authenticated")),
			sessionInvariantMessage(
				"SESSION-INV-07",
				"consumer A missed owner write",
			),
		);
		assert.ok(
			seen.some((row) => row.startsWith("b:authenticated")),
			sessionInvariantMessage(
				"SESSION-INV-07",
				"consumer B missed owner write",
			),
		);
	} finally {
		restore();
	}
});

test("T-SESS-09 separate browser clients stay isolated", async () => {
	const restore = installFetch(async (input) => {
		const url = String(input);
		if (url.includes("client-a")) {
			return jsonResponse({
				token: "tok_a",
				user: { id: "user-a", email: "a@example.com" },
			});
		}
		return jsonResponse({
			token: "tok_b",
			user: { id: "user-b", email: "b@example.com" },
		});
	});
	try {
		const a = createAuthModule({
			baseUrl: "https://auth.example.test/client-a",
			apiKey: "k",
		});
		const b = createAuthModule({
			baseUrl: "https://auth.example.test/client-b",
			apiKey: "k",
		});
		await a.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		assert.equal(
			b.auth.session.get(),
			null,
			sessionInvariantMessage("SESSION-INV-08"),
		);
		assert.equal(
			a.auth.session.get()?.user.id,
			"user-a",
			sessionInvariantMessage("SESSION-INV-08"),
		);
	} finally {
		restore();
	}
});

test("T-SESS-10 / T-SESS-SSR-01 server request-scoped views do not leak users", async () => {
	const restore = installFetch(async (input, init) => {
		const headers = new Headers(init?.headers);
		const cookie = headers.get("cookie") ?? "";
		if (cookie.includes("session_A")) {
			return jsonResponse({
				session: { id: "sess-a", token: "session_A", userId: "user-a" },
				user: { id: "user-a", email: "a@example.com" },
			});
		}
		if (cookie.includes("session_B")) {
			return jsonResponse({
				session: { id: "sess-b", token: "session_B", userId: "user-b" },
				user: { id: "user-b", email: "b@example.com" },
			});
		}
		return jsonResponse({ error: "no session" }, 401);
	});
	try {
		const root = createClient({
			auth: { url: "https://auth.example.test" },
			key: "key",
			url: "https://athena.example.com",
		});

		const [viewA, viewB] = await Promise.all([
			createAthenaServerClient({
				// `as never` keeps generic depth under the TS2589 limit (house pattern).
				client: root as never,
				requestCookies: "athena-auth.session-token=session_A",
				requestHeaders: {},
			}),
			createAthenaServerClient({
				client: root as never,
				requestCookies: "athena-auth.session-token=session_B",
				requestHeaders: {},
			}),
		]);

		const [sessionA, sessionB] = await Promise.all([
			viewA.auth.getSession(),
			viewB.auth.getSession(),
		]);

		assert.equal(
			sessionA.ok && sessionA.data?.user.id,
			"user-a",
			sessionInvariantMessage("SESSION-INV-09", "request A leaked"),
		);
		assert.equal(
			sessionB.ok && sessionB.data?.user.id,
			"user-b",
			sessionInvariantMessage("SESSION-INV-09", "request B leaked"),
		);
		assert.notEqual(
			viewA.auth.session.get()?.user.id,
			viewB.auth.session.get()?.user.id,
			sessionInvariantMessage("SESSION-INV-09", "views shared owner"),
		);
		assert.equal(
			root.auth.session.get(),
			null,
			sessionInvariantMessage(
				"SESSION-INV-09",
				"process-root session became a global identity",
			),
		);
	} finally {
		restore();
	}
});

test("T-SESS-11 revoke-other-session preserves current", async () => {
	const restore = installFetch(async (input) => {
		const url = String(input);
		if (url.includes("/sign-in/email")) {
			return jsonResponse({
				token: "current-token",
				user: { id: "u1", email: "a@example.com" },
			});
		}
		if (url.includes("/revoke-other-sessions")) {
			return jsonResponse({ status: true });
		}
		return jsonResponse({ error: "unexpected" }, 500);
	});
	try {
		const mod = createAuthModule({
			baseUrl: "https://auth.example.test",
			apiKey: "k",
		});
		await mod.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		const result = await mod.auth.session.revokeOther();
		assert.equal(result.ok, true);
		assert.equal(
			mod.auth.session.get()?.session.token,
			"current-token",
			"T-SESS-11: revoke other must preserve current session",
		);
	} finally {
		restore();
	}
});

test("T-SESS-12 delete-user invalidates current", async () => {
	const restore = installFetch(async (input) => {
		const url = String(input);
		if (url.includes("/sign-in/email")) {
			return jsonResponse({
				token: "doomed-token",
				user: { id: "u1", email: "a@example.com" },
			});
		}
		if (url.includes("/delete-user")) {
			return jsonResponse({ success: true });
		}
		return jsonResponse({ error: "unexpected" }, 500);
	});
	try {
		const mod = createAuthModule({
			baseUrl: "https://auth.example.test",
			apiKey: "k",
		});
		await mod.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		const result = await mod.auth.user.delete({
			password: "password-long-enough",
		});
		assert.equal(result.ok, true);
		assert.equal(
			mod.auth.session.get(),
			null,
			"T-SESS-12: delete-user must invalidate current session",
		);
	} finally {
		restore();
	}
});

test("T-SESS-13 sign-out clears local state even when transport fails", async () => {
	const restore = installFetch(async (input) => {
		const url = String(input);
		if (url.includes("/sign-in/email")) {
			return jsonResponse({
				token: "tok",
				user: { id: "u1", email: "a@example.com" },
			});
		}
		if (url.includes("/sign-out")) {
			return jsonResponse({ error: "upstream down" }, 503);
		}
		return jsonResponse({ error: "unexpected" }, 500);
	});
	try {
		const mod = createAuthModule({
			baseUrl: "https://auth.example.test",
			apiKey: "k",
		});
		await mod.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		const result = await mod.auth.signOut();
		assert.equal(result.ok, false);
		assert.equal(
			mod.auth.session.get(),
			null,
			"local session must clear even if remote sign-out fails",
		);
	} finally {
		restore();
	}
});

test("T-SESS-14 revoke current session invalidates; other token does not", async () => {
	const restore = installFetch(async (input) => {
		const url = String(input);
		if (url.includes("/sign-in/email")) {
			return jsonResponse({
				token: "keep-me",
				user: { id: "u1", email: "a@example.com" },
			});
		}
		if (url.includes("/revoke-session")) {
			return jsonResponse({ status: true });
		}
		return jsonResponse({ error: "unexpected" }, 500);
	});
	try {
		const mod = createAuthModule({
			baseUrl: "https://auth.example.test",
			apiKey: "k",
		});
		await mod.auth.signIn.email({
			email: "a@example.com",
			password: "password-long-enough",
		});
		const other = await mod.auth.session.revoke({ token: "other-token" });
		assert.equal(other.ok, true);
		assert.equal(mod.auth.session.get()?.session.token, "keep-me");
		const self = await mod.auth.session.revoke({ token: "keep-me" });
		assert.equal(self.ok, true);
		assert.equal(mod.auth.session.get(), null);
	} finally {
		restore();
	}
});
