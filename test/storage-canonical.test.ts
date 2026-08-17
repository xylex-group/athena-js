import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/v3-client.ts";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

test("canonical storage namespaces serialize provider, connection, and file calls to service routes", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ body: unknown; method: string; path: string }> = [];

	globalThis.fetch = async (url, init) => {
		const request = new URL(String(url));
		calls.push({
			body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
			method: (init?.method ?? "GET").toUpperCase(),
			path: request.pathname,
		});

		if (request.pathname.endsWith("/storage/providers")) {
			return json({
				data: {
					providers: [
						{
							implementationStatus: "implemented",
							provider: "aws_s3",
						},
					],
				},
				message: "ok",
				status: "success",
			});
		}

		if (request.pathname.endsWith("/storage/connections")) {
			return json(
				{
					data: {
						connection: {
							config: {
								bucket: "documents",
								endpoint: "",
								region: "us-east-1",
							},
							credentialState: { configured: true },
							id: "connection_1",
							isActive: true,
							name: "documents",
							protocol: "s3_compatible",
							providerId: "aws_s3",
						},
					},
					message: "created",
					status: "success",
				},
				201,
			);
		}

		return json({
			data: {
				file: {
					bucket: "documents",
					id: "file_1",
					key: "reports/q1.txt",
					metadata: {},
					name: "q1.txt",
					status: "available",
					visibility: "private",
				},
			},
			message: "ok",
			status: "success",
		});
	};

	try {
		const client = createClient({
			client: "storage_canonical",
			key: "test-key",
			storage: { url: "https://athena.example.com" },
		});

		const providers = await client.storage.providers.list();
		assert.equal(providers[0]?.id, "aws_s3");

		const connection = await client.storage.connections.create({
			config: {
				bucket: "documents",
				region: "us-east-1",
			},
			credentials: {
				accessKeyId: "AKIATEST",
				secretAccessKey: "secret-value",
			},
			name: "documents",
			provider: "aws_s3",
		});
		assert.equal(connection.id, "connection_1");
		assert.equal(connection.credentialState.configured, true);

		const file = await client.storage.files.get("file_1");
		assert.equal(file.key, "reports/q1.txt");

		assert.deepEqual(
			calls.map(({ method, path }) => `${method} ${path}`),
			[
				"GET /storage/providers",
				"POST /storage/connections",
				"GET /storage/service/files/file_1",
			],
		);
		assert.deepEqual(calls[1]?.body, {
			accessKeyId: "AKIATEST",
			bucket: "documents",
			name: "documents",
			provider: "aws_s3",
			region: "us-east-1",
			secretAccessKey: "secret-value",
		});
		assert.equal(
			JSON.stringify(connection).includes("secret-value"),
			false,
			"connection responses must not expose submitted credentials",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
