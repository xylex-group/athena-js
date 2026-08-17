import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
	createMemoryTokenStore,
	createReactNativeClient,
	createClient as rnCreateClient,
} from "../src/react-native/index.ts";
import {
	type AthenaClient,
	AthenaConfigurationError,
} from "../src/v3-client-core.ts";

interface Captured {
	init?: RequestInit;
	url: string;
}

function mockFetch(
	responseBody: unknown = { session: null, user: null },
	responseInit: ResponseInit = { status: 200 },
) {
	const calls: Captured[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		const body =
			typeof responseBody === "string"
				? responseBody
				: JSON.stringify(responseBody);
		return new Response(body, responseInit);
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

function headerRecord(init?: RequestInit): Record<string, string> {
	const h = init?.headers;
	if (!h) return {};
	if (h instanceof Headers) {
		const out: Record<string, string> = {};
		h.forEach((v, k) => {
			out[k] = v;
		});
		return out;
	}
	if (Array.isArray(h)) {
		return Object.fromEntries(h);
	}
	return { ...(h as Record<string, string>) };
}

test("T-RN-001 package.json exports ./react-native subpath", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		exports: Record<
			string,
			{ types?: string; import?: string; require?: string }
		>;
	};
	const exp = pkg.exports["./react-native"];
	assert.ok(exp, 'missing exports["./react-native"]');
	assert.equal(exp.types, "./dist/react-native.d.ts");
	assert.equal(exp.import, "./dist/react-native.js");
	assert.equal(exp.require, "./dist/react-native.cjs");
});

test("T-RN-001 react-native entry exports createClient and createReactNativeClient", () => {
	assert.equal(typeof rnCreateClient, "function");
	assert.equal(typeof createReactNativeClient, "function");
});

// Original found case (PR #578 discussion_r3762275833):
// re-exported createClient from @xylex-group/athena/react-native bypassed
// assertDirectPostgresRequiresNodeRuntime (only createReactNativeClient guarded).
test("P1: Guard the re-exported React Native createClient", () => {
	const secretUri = "postgres://s3cret-user:hunter2@db.internal:5432/prod";

	let thrown: Error | undefined;
	try {
		rnCreateClient({
			url: "https://athena.example.com",
			key: "public-key",
			db: { pgUri: secretUri },
		});
	} catch (error) {
		thrown = error as Error;
	}

	assert.ok(thrown instanceof AthenaConfigurationError);
	assert.equal(thrown.code, "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED");
	assert.equal(thrown.service, "db");
	// URI/secret must never appear in the diagnostic.
	assert.ok(!thrown.message.includes(secretUri));
	assert.ok(!thrown.message.includes("s3cret-user"));
	assert.ok(!thrown.message.includes("hunter2"));
	assert.ok(!thrown.message.includes("db.internal"));
	assert.ok(!thrown.message.includes("postgres://"));
});

test("T-RN-002 createReactNativeClient defaults auth credentials to omit", async () => {
	const { calls, restore } = mockFetch({ session: null, user: null });
	try {
		const client = createReactNativeClient({
			auth: { url: "https://auth.example.com/api/auth" },
			db: { url: "https://gateway.example.com" },
			key: "gateway-key",
		});
		await client.auth.getSession();
		assert.ok(calls.length >= 1);
		assert.equal(calls[0].init?.credentials, "omit");
	} finally {
		restore();
	}
});

test("T-RN-003 tokenStore injects bearer and session headers", async () => {
	const { calls, restore } = mockFetch({
		session: { id: "s1" },
		user: { id: "u1" },
	});
	try {
		const tokenStore = createMemoryTokenStore({
			accessToken: "rn-access-token",
			sessionToken: "rn-session-token",
		});
		const client = createReactNativeClient({
			auth: { url: "https://auth.example.com/api/auth" },
			db: { url: "https://gateway.example.com" },
			key: "gateway-key",
			tokenStore,
		});
		await client.auth.getSession();
		const headers = headerRecord(calls[0].init);
		assert.equal(headers["X-Athena-Auth-Session-Token"], "rn-session-token");
		assert.ok(
			typeof headers.Authorization === "string" &&
				headers.Authorization.includes("rn-access-token"),
			`expected Authorization to carry access token, got ${headers.Authorization}`,
		);
		assert.equal(calls[0].init?.credentials, "omit");
	} finally {
		restore();
	}
});

test("T-RN-005 react-native source must not import query builders or expo", async () => {
	const root = join(process.cwd(), "src", "react-native");
	const { readdir, readFile: rf } = await import("node:fs/promises");
	const names = await readdir(root);
	const banned =
		/from\s+["']react-native["']|from\s+["']expo|from\s+["'][^"']*query\/|assembleSql|buildFilter/i;
	for (const name of names) {
		if (!name.endsWith(".ts")) continue;
		const text = await rf(join(root, name), "utf8");
		assert.equal(banned.test(text), false, `forbidden pattern in ${name}`);
	}
});

test("T-RN-007 no prettier dependency in package.json", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	assert.equal(pkg.dependencies?.prettier, undefined);
	assert.equal(pkg.devDependencies?.prettier, undefined);
	assert.ok(pkg.devDependencies?.["@biomejs/biome"]);
	assert.ok(pkg.devDependencies?.ultracite);
});

test("T-RN-004 browser createClient and RN client emit identical query payloads", async () => {
	const { createClient } = await import("../src/v3-client.ts");
	const callsA: Captured[] = [];
	const callsB: Captured[] = [];
	const original = globalThis.fetch;

	globalThis.fetch = async (url, init) => {
		callsA.push({ init, url: String(url) });
		return new Response(JSON.stringify({ data: [], status: 200 }), {
			status: 200,
		});
	};
	try {
		const browserLike = createClient({
			db: { url: "https://athena-db.example" },
			key: "secret",
		});
		await browserLike
			.from("characters")
			.eq("role", "mage")
			.order("name", { ascending: true })
			.range(0, 9)
			.select("id,name");
	} finally {
		globalThis.fetch = original;
	}

	globalThis.fetch = async (url, init) => {
		callsB.push({ init, url: String(url) });
		return new Response(JSON.stringify({ data: [], status: 200 }), {
			status: 200,
		});
	};
	try {
		const rn = createReactNativeClient({
			db: { url: "https://athena-db.example" },
			key: "secret",
			tokenStore: createMemoryTokenStore(),
		});
		await rn
			.from("characters")
			.eq("role", "mage")
			.order("name", { ascending: true })
			.range(0, 9)
			.select("id,name");
	} finally {
		globalThis.fetch = original;
	}

	assert.ok(callsA.length >= 1 && callsB.length >= 1);
	const bodyA = JSON.parse(String(callsA[0].init?.body ?? "{}"));
	const bodyB = JSON.parse(String(callsB[0].init?.body ?? "{}"));
	assert.deepEqual(bodyB, bodyA);
	assert.equal(
		new URL(callsA[0].url).pathname,
		new URL(callsB[0].url).pathname,
	);
});

test("T-RN-004 insert/update/delete payloads match between createClient and RN", async () => {
	const { createClient } = await import("../src/v3-client.ts");

	async function capture(
		run: (client: AthenaClient<undefined>) => Promise<void>,
	): Promise<unknown[]> {
		const calls: Captured[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			calls.push({ init, url: String(url) });
			return new Response(JSON.stringify({ data: null, status: 200 }), {
				status: 200,
			});
		};
		try {
			const client = createReactNativeClient({
				db: { url: "https://athena-db.example" },
				key: "secret",
			});
			await run(client);
		} finally {
			globalThis.fetch = original;
		}
		return calls.map((c) => JSON.parse(String(c.init?.body ?? "{}")));
	}

	async function captureCore(
		run: (client: AthenaClient<undefined>) => Promise<void>,
	): Promise<unknown[]> {
		const calls: Captured[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			calls.push({ init, url: String(url) });
			return new Response(JSON.stringify({ data: null, status: 200 }), {
				status: 200,
			});
		};
		try {
			const client = createClient({
				db: { url: "https://athena-db.example" },
				key: "secret",
			});
			await run(client);
		} finally {
			globalThis.fetch = original;
		}
		return calls.map((c) => JSON.parse(String(c.init?.body ?? "{}")));
	}

	const coreBodies = await captureCore(async (c) => {
		await c.from("characters").insert({ name: "Aragorn" });
		await c.from("characters").update({ name: "Strider" }).eq("id", 1);
		await c.from("characters").delete({ resourceId: "abc" });
	});
	const rnBodies = await capture(async (c) => {
		await c.from("characters").insert({ name: "Aragorn" });
		await c.from("characters").update({ name: "Strider" }).eq("id", 1);
		await c.from("characters").delete({ resourceId: "abc" });
	});
	assert.deepEqual(rnBodies, coreBodies);
});
