#!/usr/bin/env node
/**
 * Production-like boot for the next-minimal golden-path fixture.
 * Imports packed @xylex-group/athena from node_modules — never ../../src.
 * Schema is applied by packed `athena-js migrate` before this process starts.
 */
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedServerOnly(request, parent, isMain) {
	if (request === "server-only") {
		return {};
	}
	return originalLoad.call(this, request, parent, isMain);
};

function resolvePacked(subpath) {
	return pathToFileURL(require.resolve(`@xylex-group/athena/${subpath}`)).href;
}

const { athenaNotificationCatalogDemo, createClient } = await import(
	resolvePacked("server")
);
const { createAthenaNextHandler } = await import(resolvePacked("next/server"));

const databaseUrl =
	process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL / ATHENA_TEST_DATABASE_URL required to boot");
}

const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "127.0.0.1";
const origin = `http://${host}:${port}`;
const failApplyManyOn = Number(
	process.env.ATHENA_GOLDEN_FAIL_APPLY_MANY_ON || 0,
);
let applyManyCount = 0;

class GoldenMollieSdk {}

const storageRoot = join(process.cwd(), ".tmp-golden-storage");
mkdirSync(storageRoot, { recursive: true });

const athena = createClient({
	app: {
		id: "next-minimal-golden",
		url: origin,
	},
	auth: {
		autoMigrate: false,
		mode: "local",
		passkey: { onboarding: true },
		secret:
			process.env.ATHENA_AUTH_SECRET || "finality-local-secret-32-chars!!",
		...(process.env.ATHENA_OAUTH_FIXTURE_ISSUER
			? {
					security: {
						trustedOrigins: [origin],
					},
					social: {
						providers: {
							testProvider: {
								clientId: process.env.ATHENA_OAUTH_CLIENT_ID || "athena-test",
								clientSecret:
									process.env.ATHENA_OAUTH_CLIENT_SECRET ||
									"athena-test-secret",
								issuer: process.env.ATHENA_OAUTH_FIXTURE_ISSUER,
							},
							...(process.env.ATHENA_OAUTH_LINK_CLIENT_ID
								? {
										testProviderB: {
											clientId: process.env.ATHENA_OAUTH_LINK_CLIENT_ID,
											clientSecret:
												process.env.ATHENA_OAUTH_LINK_CLIENT_SECRET ||
												"athena-test-secret-b",
											issuer: process.env.ATHENA_OAUTH_FIXTURE_ISSUER,
										},
									}
								: {}),
						},
					},
				}
			: {}),
	},
	billing: {
		catalog: { prices: [], products: [] },
		providers: {
			mollie: {
				liveKey: "live_golden_unused",
				sdk: GoldenMollieSdk,
				testKey: "test_golden_unused",
			},
		},
		testMode: true,
	},
	databaseUrl,
	notifications: {
		catalog: athenaNotificationCatalogDemo,
	},
	storage: {
		provider: "local",
		root: storageRoot,
	},
});

const athenaHttp = createAthenaNextHandler({
	client: athena,
});

function toWebRequest(req, url, body) {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (typeof value === "string") {
			headers.set(key, value);
		} else if (Array.isArray(value)) {
			headers.set(key, value.join(", "));
		}
	}
	const method = req.method || "GET";
	const init = { headers, method };
	if (body.length > 0 && method !== "GET" && method !== "HEAD") {
		init.body = body;
	}
	return new Request(url, init);
}

function injectedApplyManyFailure() {
	return Response.json(
		{
			error: {
				code: "ATHENA_NOTIFICATIONS_UNAVAILABLE",
				errorNumber: 9006,
				message: "injected applyMany failure",
			},
			ok: false,
			status: 503,
		},
		{ status: 503 },
	);
}

function shouldFailApplyMany(pathname, method, body) {
	if (failApplyManyOn <= 0 || method !== "POST") {
		return false;
	}
	if (pathname !== "/api/athena/notifications") {
		return false;
	}
	let envelope = {};
	try {
		envelope = JSON.parse(body.toString("utf8") || "{}");
	} catch {
		return false;
	}
	if (envelope.operation !== "notifications.preferences.applyMany") {
		return false;
	}
	applyManyCount += 1;
	return applyManyCount === failApplyManyOn;
}

const server = createServer((req, res) => {
	const chunks = [];
	req.on("data", (chunk) => {
		chunks.push(chunk);
	});
	req.on("end", async () => {
		try {
			const url = new URL(req.url || "/", origin);
			const body = Buffer.concat(chunks);
			const method = (req.method || "GET").toUpperCase();
			if (shouldFailApplyMany(url.pathname, method, body)) {
				const failure = injectedApplyManyFailure();
				const outHeaders = {};
				failure.headers.forEach((value, key) => {
					outHeaders[key] = value;
				});
				res.writeHead(failure.status, outHeaders);
				res.end(Buffer.from(await failure.arrayBuffer()));
				return;
			}
			const request = toWebRequest(req, url, body);
			const handler = athenaHttp[method] || athenaHttp.GET;
			const response = await handler(request);
			const outHeaders = {};
			response.headers.forEach((value, key) => {
				if (key.toLowerCase() === "set-cookie") {
					const previous = outHeaders["set-cookie"];
					outHeaders["set-cookie"] = previous
						? [].concat(previous, value)
						: value;
				} else {
					outHeaders[key] = value;
				}
			});
			res.writeHead(response.status, outHeaders);
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end(error instanceof Error ? error.message : String(error));
		}
	});
});

server.listen(port, host, () => {
	process.stdout.write(`next-minimal-golden listening on ${origin}\n`);
});

process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});
