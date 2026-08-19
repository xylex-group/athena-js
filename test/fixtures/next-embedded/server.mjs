#!/usr/bin/env node
/**
 * Production-like boot for the next-embedded fixture (next start equivalent).
 * Imports packed @xylex-group/athena from node_modules — never ../../src.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Next empties server-only on the server. This Node fixture is not Next.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedServerOnly(request, parent, isMain) {
	if (request === "server-only") {
		return {};
	}
	return originalLoad.call(this, request, parent, isMain);
};

function resolvePacked(subpath) {
	return pathToFileURL(
		require.resolve(`@xylex-group/athena/${subpath}`),
	).href;
}

const { createClient } = await import(resolvePacked("server"));
const { createAthenaNextHandlers } = await import(resolvePacked("next/server"));

const databaseUrl =
	process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL / ATHENA_TEST_DATABASE_URL required to boot");
}

const athena = createClient({
	auth: {
		autoMigrate: true,
		mode: "local",
		secret: process.env.ATHENA_AUTH_SECRET || "finality-local-secret-32-chars!!",
	},
	databaseUrl,
});

if (typeof athena.auth?.server?.migrate === "function") {
	await athena.auth.server.migrate();
}

const { auth, data } = createAthenaNextHandlers({
	client: athena,
	security: { mode: "trusted" },
	unsafeAllowUnauthenticated: true,
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

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const server = createServer((req, res) => {
	const chunks = [];
	req.on("data", (chunk) => {
		chunks.push(chunk);
	});
	req.on("end", async () => {
		try {
			const url = new URL(req.url || "/", `http://${host}:${port}`);
			const request = toWebRequest(req, url, Buffer.concat(chunks));
			let response;
			if (url.pathname.startsWith("/api/auth")) {
				const method = (req.method || "GET").toUpperCase();
				const handler = auth[method] || auth.GET;
				response = await handler(request);
			} else if (url.pathname.startsWith("/api/athena")) {
				const method = (req.method || "GET").toUpperCase();
				const handler = data[method] || data.GET;
				response = await handler(request);
			} else {
				res.writeHead(404, { "content-type": "text/plain" });
				res.end("not found");
				return;
			}
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
	process.stdout.write(`next-embedded listening on http://${host}:${port}\n`);
});

process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});
