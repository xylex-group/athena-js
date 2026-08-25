/**
 * N2 — browser bundle cannot resolve pg or server-only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readBuilt(relativePath: string): string {
	const source = readFileSync(join(pkgRoot, "dist", relativePath), "utf8");
	assert.ok(
		source.length > 0,
		`dist/${relativePath} is empty after package build`,
	);
	return source;
}

test("N2: browser bundle cannot resolve pg or server-only", () => {
	const browserJs = readBuilt("browser.js");
	const nextClientJs = readBuilt("next/client.js");
	const nextClientCjs = readBuilt("next/client.cjs");
	for (const [label, source] of [
		["browser.js", browserJs],
		["next/client.js", nextClientJs],
		["next/client.cjs", nextClientCjs],
	] as const) {
		assert.doesNotMatch(
			source,
			/from ["']pg["']|require\(["']pg["']\)/,
			`${label} must not resolve pg`,
		);
		assert.doesNotMatch(
			source,
			/from ["']server-only["']|require\(["']server-only["']\)/,
			`${label} must not resolve server-only`,
		);
	}
});

test("built next/client entry keeps server-only seams out of the browser graph", () => {
	for (const relativePath of ["next/client.js", "next/client.cjs"] as const) {
		const source = readBuilt(relativePath);
		assert.equal(source.includes("next/headers"), false);
		assert.equal(source.includes("server-only"), false);
		assert.match(source, /createAthenaBrowserClient/);
		assert.match(source, /\bcreateClient\b/);
		assert.equal(source.includes("server-secret-key-do-not-ship"), false);
	}
});

test("built next/server entry exports the async factory and requires server-only", () => {
	const serverJs = readBuilt("next/server.js");
	const serverCjs = readBuilt("next/server.cjs");

	assert.match(serverJs, /import ['"]server-only['"]/);
	assert.match(serverCjs, /require\(['"]server-only['"]\)/);
	assert.match(serverJs, /createAthenaServerClient/);
	assert.match(serverCjs, /createAthenaServerClient/);
});

test("built next/session entry is a session lookup without the composition root", () => {
	const sessionJs = readBuilt("next/session.js");
	const sessionCjs = readBuilt("next/session.cjs");

	assert.match(sessionJs, /import ['"]server-only['"]/);
	assert.match(sessionCjs, /require\(['"]server-only['"]\)/);
	assert.match(sessionJs, /getServerSession/);
	assert.match(sessionCjs, /getServerSession/);
	for (const [label, source] of [
		["next/session.js", sessionJs],
		["next/session.cjs", sessionCjs],
	] as const) {
		assert.doesNotMatch(
			source,
			/from ["']crypto["']|from ["']node:crypto["']|require\(["']crypto["']\)/,
			`${label} must not import Node crypto`,
		);
		assert.equal(source.includes("createAthenaServerClient"), false, label);
		assert.equal(source.includes("createClient"), false, label);
		assert.equal(source.includes("v3-client"), false, label);
	}
});
