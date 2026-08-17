import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaConfigurationError } from "../src/config/errors.ts";
import { createAthenaBrowserClient } from "../src/next/client.ts";
import { createAthenaServerClient } from "../src/next/server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures/next-app");
const packageRoot = join(here, "..");

async function readFixture(relativePath: string): Promise<string> {
	return readFile(join(fixtureRoot, relativePath), "utf8");
}

async function readDist(relativePath: string): Promise<string> {
	return readFile(join(packageRoot, "dist", relativePath), "utf8");
}

test("fixture browser modules import createAthenaBrowserClient and public config only", async () => {
	const publicConfig = await readFixture("app/lib/athena-public-config.ts");
	const clientModule = await readFixture("app/lib/athena-client.ts");

	assert.match(publicConfig, /AthenaBrowserClientConfig/);
	assert.match(publicConfig, /NEXT_PUBLIC_ATHENA_URL/);
	assert.match(publicConfig, /NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY/);
	assert.equal(publicConfig.includes("ATHENA_API_KEY"), false);

	assert.match(clientModule, /['"]use client['"]/);
	assert.match(clientModule, /createAthenaBrowserClient/);
	assert.match(clientModule, /athenaPublicConfig/);
	assert.equal(clientModule.includes("createAthenaServerClient"), false);
	assert.equal(clientModule.includes("next/headers"), false);
	assert.equal(clientModule.includes("server-only"), false);
	assert.equal(clientModule.includes("ATHENA_API_KEY"), false);
});

test("fixture server modules import createAthenaServerClient and stay server-only", async () => {
	const serverModule = await readFixture("app/lib/athena-server.ts");
	const route = await readFixture("app/api/customers/route.ts");
	const bridgeRoute = await readFixture("app/api/athena-auth/session/route.ts");

	assert.match(serverModule, /import ['"]server-only['"]/);
	assert.match(serverModule, /createAthenaServerClient/);
	assert.match(serverModule, /ATHENA_URL/);
	assert.match(serverModule, /ATHENA_API_KEY/);
	assert.equal(serverModule.includes("NEXT_PUBLIC_"), false);

	assert.match(route, /createServerAthena/);
	assert.match(route, /await createServerAthena\(\)/);
	assert.match(route, /\.from\(['"]customers['"]\)/);

	assert.match(bridgeRoute, /createAthenaAuthSessionBridgeHandlers/);
	assert.match(bridgeRoute, /export const \{ POST, DELETE \}/);
	assert.equal(bridgeRoute.includes("createAthenaBrowserClient"), false);
	assert.equal(bridgeRoute.includes("createAthenaServerClient"), false);
	assert.match(bridgeRoute, /@xylex-group\/athena\/next\/server/);
});

test("built next/client entry keeps server-only seams out of the browser graph", async () => {
	const clientJs = await readDist("next/client.js");
	const clientCjs = await readDist("next/client.cjs");

	for (const source of [clientJs, clientCjs]) {
		assert.equal(source.includes("next/headers"), false);
		assert.equal(source.includes("server-only"), false);
		assert.match(source, /createAthenaBrowserClient/);
		// Actual server secrets must never be inlined into the browser entry.
		assert.equal(source.includes("server-secret-key-do-not-ship"), false);
	}
});

test("built next/server entry exports the async factory and requires server-only", async () => {
	const serverJs = await readDist("next/server.js");
	const serverCjs = await readDist("next/server.cjs");

	assert.match(serverJs, /import ['"]server-only['"]/);
	assert.match(serverCjs, /require\(['"]server-only['"]\)/);
	assert.match(serverJs, /createAthenaServerClient/);
	assert.match(serverCjs, /createAthenaServerClient/);
});

test("browser factory rejects blank publishable configuration at construction", () => {
	assert.throws(
		() =>
			createAthenaBrowserClient({
				key: "",
				url: "https://athena.example.com",
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_API_KEY_REQUIRED",
	);
});

test("server factory works for Route Handler style explicit request inputs", async () => {
	const originalFetch = globalThis.fetch;
	const captured: string[] = [];
	globalThis.fetch = async (url) => {
		captured.push(String(url));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		// Mirrors app/api/customers/route.ts: construct per request, then query.
		const athena = await createAthenaServerClient({
			key: "server-secret-key-do-not-ship",
			requestCookies: "athena-auth.session_token=fixture_session",
			requestHeaders: { authorization: "Bearer route_token" },
			url: "https://athena.example.com",
		});

		await athena.from("customers").select("*");
		assert.equal(captured.length, 1);
		assert.match(captured[0], /athena\.example\.com/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fixture TypeScript project typechecks against Next entry sources", () => {
	assert.equal(existsSync(join(fixtureRoot, "tsconfig.json")), true);

	const result = spawnSync(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["exec", "tsc", "-p", "test/fixtures/next-app/tsconfig.json"],
		{
			cwd: packageRoot,
			encoding: "utf8",
			shell: process.platform === "win32",
		},
	);

	assert.equal(
		result.status,
		0,
		`fixture typecheck failed:\n${result.stdout}\n${result.stderr}`,
	);
});
