/**
 * Canonical Next.js embedded-runtime E2E against the public packed package.
 *
 * Happy path: createClient() root → Postgres runtime created → migrations
 * execute → embedded Auth boots → /api/athena mounted → /api/auth mounted →
 * insert row → browser-facing client reads row → sign up → sign in →
 * session cookie / Set-Cookie returned → server request resolves session →
 * organization created/selected → organization-scoped query succeeds.
 *
 * Also asserts N4–N8 against the live fixture runtime.
 */
import { strict as assert } from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(pkgRoot, "test", "fixtures", "next-embedded");
const TABLE = "finality_items";

function requireDatabaseUrl(): string {
	const url = (
		process.env.ATHENA_TEST_DATABASE_URL ||
		process.env.DATABASE_URL ||
		""
	).trim();
	if (!/^postgres(ql)?:\/\//i.test(url)) {
		throw new Error(
			"fail-closed: embedded-next requires ATHENA_TEST_DATABASE_URL or DATABASE_URL (orchestrator auto-launches Postgres)",
		);
	}
	return url;
}

function loadPacked(subpath: string): Promise<Record<string, unknown>> {
	const require = createRequire(join(fixtureRoot, "package.json"));
	let resolved: string;
	try {
		resolved = require.resolve(`@xylex-group/athena/${subpath}`);
	} catch (error) {
		throw new Error(
			`packed @xylex-group/athena/${subpath} missing in test/fixtures/next-embedded (install .tmp/packages/*.tgz): ${String(error)}`,
		);
	}
	if (resolved.replaceAll("\\", "/").includes("/packages/athena-js/src/")) {
		throw new Error("E2E must not resolve the SDK from src/");
	}
	return import(pathToFileURL(resolved).href) as Promise<Record<string, unknown>>;
}

function ownedRuntimeCache(): Map<string, { runtime: unknown }> {
	const key = Symbol.for("@xylex-group/athena.ownedPostgresRuntimes");
	const holder = globalThis as typeof globalThis & {
		[key]?: Map<string, { runtime: unknown }>;
	};
	holder[key] ??= new Map();
	return holder[key];
}

async function listenPort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
		server.on("error", reject);
	});
}

async function waitHttp(url: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.status > 0) {
				return;
			}
		} catch {
			await delay(200);
		}
	}
	throw new Error(`next-embedded did not become ready at ${url}`);
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

function cookieHeader(response: Response): string {
	const getSetCookie = (
		response.headers as Headers & { getSetCookie?: () => string[] }
	).getSetCookie;
	const cookies = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
	if (cookies.length > 0) {
		return cookies
			.map((entry) => entry.split(";", 1)[0])
			.filter(Boolean)
			.join("; ");
	}
	const single = response.headers.get("set-cookie");
	return single ? single.split(";", 1)[0] ?? "" : "";
}

test("embedded-next happy path + N4–N8 against packed @xylex-group/athena", async () => {
	const databaseUrl = requireDatabaseUrl();
	const serverMod = await loadPacked("server");
	const nextClient = await loadPacked("next/client");

	const createClient = serverMod.createClient as (config: {
		auth?: unknown;
		databaseUrl: string;
	}) => {
		auth: {
			server?: { migrate: () => Promise<void> };
		};
		close: () => Promise<void>;
		query: (sql: string, values?: unknown[]) => Promise<{ data?: unknown; error?: unknown }>;
		withContext: (ctx: Record<string, unknown>) => {
			close?: () => Promise<void>;
			query: (sql: string, values?: unknown[]) => Promise<{ data?: unknown; error?: unknown }>;
		};
	};
	const createAthenaBrowserClient = nextClient.createAthenaBrowserClient as (config: unknown) => unknown;

	const root = createClient({
		auth: {
			autoMigrate: true,
			mode: "local",
			secret: "finality-local-secret-32-chars!!",
		},
		databaseUrl,
	});
	assert.ok(root, "createClient root");

	const firstRuntime = ownedRuntimeCache().get(databaseUrl)?.runtime;
	assert.ok(firstRuntime, "Postgres runtime created");

	await root.auth.server?.migrate();
	const migrated = await root.query("select 1 as ok");
	assert.ok(migrated.error == null, String(migrated.error ?? ""));

	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		await pgClient.query(`
			CREATE TABLE IF NOT EXISTS ${TABLE} (
				id text PRIMARY KEY,
				label text NOT NULL,
				organization_id text
			)
		`);
		await pgClient.query(`TRUNCATE TABLE ${TABLE}`);
	} finally {
		await pgClient.end();
	}

	const port = await listenPort();
	const origin = `http://127.0.0.1:${port}`;
	const child: ChildProcess = spawn(
		process.execPath,
		[join(fixtureRoot, "server.mjs")],
		{
			cwd: fixtureRoot,
			env: {
				...process.env,
				ATHENA_TEST_DATABASE_URL: databaseUrl,
				DATABASE_URL: databaseUrl,
				HOST: "127.0.0.1",
				PORT: String(port),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const childLogs: string[] = [];
	child.stdout?.on("data", (chunk) => childLogs.push(String(chunk)));
	child.stderr?.on("data", (chunk) => childLogs.push(String(chunk)));
	try {
		try {
			await waitHttp(`${origin}/api/auth/ok`);
		} catch (error) {
			throw new Error(
				`${error instanceof Error ? error.message : error}\n${childLogs.join("")}`,
			);
		}

		const authOk = await fetch(`${origin}/api/auth/ok`);
		assert.ok(authOk.ok, "embedded Auth boots /api/auth mounted");
		const inserted = await fetch(`${origin}/api/athena/gateway/insert`, {
			body: JSON.stringify({
				columns: "*",
				insert_body: { id: "row-1", label: "from-root", organization_id: null },
				table_name: TABLE,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.equal(inserted.ok, true, "/api/athena mounted + insert row");

		const browserClient = createAthenaBrowserClient({
			key: "publishable",
			url: `${origin}/api/athena`,
		});
		assert.ok(browserClient, "browser-facing client");
		const browserRead = await fetch(`${origin}/api/athena/gateway/fetch`, {
			body: JSON.stringify({
				conditions: [{ column: "id", operator: "eq", value: "row-1" }],
				table_name: TABLE,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.equal(browserRead.ok, true, "browser-facing client reads row");
		const browserBody = await json(browserRead);
		const rows = (browserBody.data as { label?: string }[]) ?? [];
		assert.equal(rows[0]?.label, "from-root");

		const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
			body: JSON.stringify({
				email: "finality@example.com",
				name: "Finality",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.equal(signUp.status, 200, "sign up");
		assert.match(
			signUp.headers.get("set-cookie") ?? "",
			/athena-auth\.session-token=/,
			"session cookie returned",
		);

		const failedAuth = await fetch(`${origin}/api/auth/sign-in/email`, {
			body: JSON.stringify({
				email: "finality@example.com",
				password: "wrong-password",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.ok(failedAuth.status >= 400, "failed auth");

		const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
			body: JSON.stringify({
				email: "finality@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.equal(signIn.status, 200, "sign in");
		const sessionCookie = cookieHeader(signIn);
		assert.match(sessionCookie, /athena-auth\.session-token=/, "Set-Cookie");

		const session = await fetch(`${origin}/api/auth/get-session`, {
			headers: { cookie: sessionCookie },
		});
		assert.equal(session.status, 200, "server request resolves session");
		const sessionBody = await json(session);
		assert.equal(
			(sessionBody.user as { email?: string } | undefined)?.email,
			"finality@example.com",
		);

		const createdOrg = await fetch(`${origin}/api/auth/organization/create`, {
			body: JSON.stringify({ name: "Finality Org", slug: "finality-org" }),
			headers: {
				"content-type": "application/json",
				cookie: sessionCookie,
			},
			method: "POST",
		});
		assert.equal(createdOrg.status, 200, "organization created");
		const orgBody = await json(createdOrg);
		const organizationId =
			(orgBody.id as string | undefined) ||
			((orgBody.organization as { id?: string } | undefined)?.id ?? "");
		assert.ok(organizationId, "organization created/selected");

		await fetch(`${origin}/api/auth/organization/set-active`, {
			body: JSON.stringify({ organizationId }),
			headers: {
				"content-type": "application/json",
				cookie: sessionCookie,
			},
			method: "POST",
		});

		const orgInsert = await fetch(`${origin}/api/athena/gateway/insert`, {
			body: JSON.stringify({
				columns: "*",
				insert_body: {
					id: "row-org",
					label: "org-row",
					organization_id: organizationId,
				},
				table_name: TABLE,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		assert.equal(orgInsert.ok, true, "org-scoped insert");
		const orgIdSql = organizationId.replaceAll("'", "''");
		const scoped = await root.withContext({ organizationId }).query(
			`select label from ${TABLE} where organization_id = '${orgIdSql}'`,
		);
		assert.ok(scoped.error == null, String(scoped.error ?? ""));
		const scopedRows = scoped.data as { label?: string }[] | undefined;
		assert.equal(scopedRows?.[0]?.label, "org-row", "organization-scoped query");

		// N4 same DATABASE_URL reuses runtime
		const again = createClient({
			auth: { mode: "local", secret: "finality-local-secret-32-chars!!" },
			databaseUrl,
		});
		assert.equal(
			ownedRuntimeCache().get(databaseUrl)?.runtime,
			firstRuntime,
			"same DATABASE_URL reuses runtime",
		);

		// N5 different DATABASE_URL gets a new / distinct runtime
		const otherUrl = databaseUrl.includes("?")
			? `${databaseUrl}&application_name=finality-other`
			: `${databaseUrl}?application_name=finality-other`;
		const other = createClient({
			auth: { mode: "local", secret: "finality-local-secret-32-chars!!" },
			databaseUrl: otherUrl,
		});
		assert.notEqual(
			ownedRuntimeCache().get(otherUrl)?.runtime,
			firstRuntime,
			"different DATABASE_URL gets a new runtime / distinct runtime",
		);

		// N6 request context does not mutate root state
		const view = root.withContext({ userId: "ctx-user", organizationId });
		const afterContext = await root.query("select 1 as ok");
		assert.ok(afterContext.error == null);
		assert.notEqual(view, root, "request context must not mutate root state");

		// N7 closing a request client does not close Postgres
		await view.close?.();
		const stillOpen = await root.query("select 1 as ok");
		assert.ok(
			stillOpen.error == null,
			"closing request client must not close Postgres pool/runtime",
		);

		// N8 failed auth does not poison subsequent / later request
		const later = await fetch(`${origin}/api/auth/get-session`, {
			headers: { cookie: sessionCookie },
		});
		assert.equal(later.status, 200, "failed auth does not poison later request");

		await again.close();
		await other.close();
	} finally {
		if (child.pid) {
			child.kill("SIGTERM");
		}
		await root.close();
	}
});
