/**
 * Next Local Runtime auto-discovery (D2–D6).
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { handleAthenaGatewayRequest } from "../../src/gateway/server/adapter.ts";
import {
	createClient,
	resetAthenaDiscoverySessionCache,
} from "../../src/next/client.ts";
import { probeAthenaLocalRuntime } from "../../src/next/discovery.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

const compatibleDocument: AthenaRuntimeDiscoveryDocument = {
	athena: true,
	capabilities: {
		auth: false,
		delete: true,
		fetch: true,
		insert: true,
		models: "off",
		nestedRelations: false,
		policy: false,
		rawSql: false,
		rpc: false,
		update: true,
	},
	protocol: { major: 1, minor: 0 },
	runtime: "local",
	runtimeImplementation: "athena-js",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

test("D0: explicit url+key createClient stays synchronous and does not probe", async () => {
	const urls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		urls.push(String(input));
		return jsonResponse([]);
	};
	try {
		const client = createClient({
			key: "publishable",
			url: "https://hosted.example",
		});
		assert.equal(typeof client.from, "function");
		assert.equal(urls.length, 0);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: local discovered without a public API key", async () => {
	const urls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		urls.push(`${init?.method ?? "GET"} ${url}`);
		if (url.endsWith("/capabilities") || url.endsWith("/health")) {
			return jsonResponse(compatibleDocument);
		}
		return jsonResponse({ data: [{ id: "1" }], ok: true });
	};
	try {
		const client = createClient({
			next: { localRuntime: "auto" },
		});
		assert.equal(typeof client.from, "function");
		await client.from("users").select();
		assert.equal(
			urls.some(
				(item) => item.includes("/capabilities") || item.includes("/health"),
			),
			true,
		);
		assert.equal(
			urls.some((item) => item.includes("/gateway/fetch")),
			true,
		);
		assert.equal(
			urls.some((item) => item.includes("hosted.example")),
			false,
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: 404 local is unavailable", async () => {
	const result = await probeAthenaLocalRuntime({
		fetchImpl: async () => new Response("missing", { status: 404 }),
		timeoutMs: 50,
	});
	assert.equal(result.status, "unavailable");
	if (result.status === "unavailable") {
		assert.equal(result.reason, "http_404");
	}
});

test("discovery: incompatible protocol", async () => {
	const result = await probeAthenaLocalRuntime({
		fetchImpl: async () =>
			jsonResponse({
				...compatibleDocument,
				protocol: { major: 2, minor: 0 },
			}),
	});
	assert.equal(result.status, "incompatible");
	if (result.status === "incompatible") {
		assert.equal(result.reason, "protocol");
	}
});

test("discovery: missing required capability", async () => {
	const result = await probeAthenaLocalRuntime({
		fetchImpl: async () => jsonResponse(compatibleDocument),
		require: { policy: true },
	});
	assert.equal(result.status, "incompatible");
	if (result.status === "incompatible") {
		assert.equal(result.reason, "capability");
	}
});

test("discovery: fallback error when local absent", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => new Response("nope", { status: 404 });
	try {
		const client = createClient({
			topology: { discover: "next", fallback: "error" },
		});
		const result = await client.from("users").select();
		assert.equal(result.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");
		assert.equal(result.error?.gatewayCode, "ATHENA_DISCOVERY_UNAVAILABLE");
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: explicit hosted fallback", async () => {
	const urls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		urls.push(url);
		if (url.includes("/api/athena")) {
			return new Response("missing", { status: 404 });
		}
		return jsonResponse({ data: [{ id: "hosted" }], ok: true });
	};
	try {
		const client = createClient({
			key: "hosted-key",
			topology: { discover: "next", fallback: "hosted" },
			url: "https://hosted.example",
		});
		await client.from("users").select();
		assert.equal(
			urls.some((item) => item.includes("https://hosted.example")),
			true,
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: hosted fallback without url/key is invalid", () => {
	assert.throws(
		() =>
			createClient({
				topology: { discover: "next", fallback: "hosted" },
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.message.includes("ATHENA_DISCOVERY_CONFIG_INVALID"),
	);
});

test("discovery: prefer hosted never probes /api/athena", async () => {
	const urls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		urls.push(String(input));
		return jsonResponse({ data: [{ id: "hosted" }], ok: true });
	};
	try {
		const client = createClient({
			key: "hosted-key",
			topology: { discover: "next", prefer: "hosted" },
			url: "https://hosted.example",
		});
		await client.from("users").select();
		assert.equal(
			urls.some((item) => item.includes("/api/athena")),
			false,
		);
		assert.equal(
			urls.some((item) => item.includes("https://hosted.example")),
			true,
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: session cache shares one probe across 100 clients", async () => {
	resetAthenaDiscoverySessionCache();
	let probes = 0;
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/capabilities") || url.endsWith("/health")) {
			probes += 1;
			await new Promise((resolve) => setTimeout(resolve, 15));
			return jsonResponse(compatibleDocument);
		}
		return jsonResponse({ data: [{ id: "1" }], ok: true });
	};
	try {
		const clients = Array.from({ length: 100 }, () =>
			createClient({
				topology: {
					discover: "next",
					fallback: "error",
					probe: { cache: "session" },
				},
			}),
		);
		await Promise.all(clients.map((client) => client.from("users").select()));
		assert.equal(probes, 1);
	} finally {
		resetAthenaDiscoverySessionCache();
		globalThis.fetch = original;
	}
});

test("discovery: capability miss is ATHENA_DISCOVERY_CAPABILITY_MISSING", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/capabilities") || url.endsWith("/health")) {
			return jsonResponse(compatibleDocument);
		}
		return jsonResponse({ data: [{ id: "1" }], ok: true });
	};
	try {
		const client = createClient({
			topology: {
				discover: "next",
				fallback: "error",
				require: { policy: true },
			},
		});
		const result = await client.from("users").select();
		assert.equal(result.error?.code, "ATHENA_DISCOVERY_CAPABILITY_MISSING");
		assert.equal(
			result.error?.gatewayCode,
			"ATHENA_DISCOVERY_CAPABILITY_MISSING",
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: protocol miss is ATHENA_PROTOCOL_INCOMPATIBLE", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		jsonResponse({
			...compatibleDocument,
			protocol: { major: 2, minor: 0 },
		});
	try {
		const client = createClient({
			topology: { discover: "next", fallback: "error" },
		});
		const result = await client.from("users").select();
		assert.equal(result.error?.code, "ATHENA_PROTOCOL_INCOMPATIBLE");
		assert.equal(result.error?.gatewayCode, "ATHENA_PROTOCOL_INCOMPATIBLE");
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: concurrent first requests share one probe", async () => {
	let probes = 0;
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/capabilities") || url.endsWith("/health")) {
			probes += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return jsonResponse(compatibleDocument);
		}
		return jsonResponse({ data: [{ id: "1" }], ok: true });
	};
	try {
		const client = createClient({
			topology: { discover: "next", fallback: "error" },
		});
		await Promise.all([
			client.from("users").select(),
			client.from("posts").select(),
			client.from("invoices").select(),
		]);
		assert.equal(probes, 1);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: local selected once then later failure does not retry hosted", async () => {
	const urls: string[] = [];
	let dataCalls = 0;
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		urls.push(url);
		if (url.endsWith("/capabilities") || url.endsWith("/health")) {
			return jsonResponse(compatibleDocument);
		}
		dataCalls += 1;
		if (dataCalls === 1) {
			return jsonResponse({ data: [{ id: "1" }], ok: true });
		}
		return new Response("boom", { status: 500 });
	};
	try {
		const client = createClient({
			key: "hosted-key",
			topology: { discover: "next", fallback: "hosted" },
			url: "https://hosted.example",
		});
		const first = await client.from("users").select();
		assert.equal(first.error == null, true);
		const second = await client.from("users").select();
		assert.equal(second.error == null, false);
		assert.equal(
			urls.some((item) => item.includes("https://hosted.example")),
			false,
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("discovery: HTTP handlers expose capability document", async () => {
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport: {
			baseUrl: "https://athena.local/mock",
			buildHeaders() {
				return {};
			},
			async deleteGateway() {
				return { ok: true } as never;
			},
			async fetchGateway() {
				return { ok: true } as never;
			},
			async insertGateway() {
				return { ok: true } as never;
			},
			async queryGateway() {
				return { ok: true } as never;
			},
			async resolveCallOptions(options) {
				return options;
			},
			async rpcGateway() {
				return { ok: true } as never;
			},
			async updateGateway() {
				return { ok: true } as never;
			},
			async verifyConnection() {
				return { ok: true } as never;
			},
		},
		unsafeAllowUnauthenticated: true,
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/capabilities", { method: "GET" }),
		runtime,
	);
	const body = (await response.json()) as AthenaRuntimeDiscoveryDocument & {
		ok?: boolean;
	};
	assert.equal(body.athena, true);
	assert.equal(body.runtime, "local");
	assert.equal(body.protocol.major, 1);
	assert.equal(body.capabilities.fetch, true);
	assert.equal(body.ok, true);
});

test("discovery: next/client source stays free of Node runtime", async () => {
	const files = [
		"../../src/next/client.ts",
		"../../src/next/discovery.ts",
		"../../src/next/topology.ts",
		"../../src/gateway/discovery-types.ts",
		"../../src/gateway/protocol.ts",
	];
	for (const file of files) {
		const source = await readFile(new URL(file, import.meta.url), "utf8");
		assert.equal(source.includes('from "pg"'), false, file);
		assert.equal(source.includes("postgres/transport"), false, file);
		assert.equal(source.includes("auth/local/runtime"), false, file);
		assert.equal(source.includes("runtime/data/runtime"), false, file);
		assert.equal(source.includes("node:fs"), false, file);
		assert.equal(source.includes("node:net"), false, file);
		assert.equal(source.includes("node:tls"), false, file);
	}
});
