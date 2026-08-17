import assert from "node:assert/strict";
import test from "node:test";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";

test("embedded local runtime serves JWKS and issues session JWTs", async () => {
	const runtime = createAthenaAuthRuntime({ autoMigrate: false });
	const jwks = await runtime.handle(
		new Request("http://localhost:3001/.well-known/jwks.json"),
	);
	assert.equal(jwks.status, 200);
	const jwksBody = (await jwks.json()) as {
		keys: Array<{ alg: string; d?: string }>;
	};
	assert.equal(jwksBody.keys[0]?.alg, "ES256");
	assert.equal(jwksBody.keys[0]?.d, undefined);

	const signUp = await runtime.handle(
		new Request("http://localhost:3001/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "jwt-local@example.com",
				name: "JWT Local",
				password: "correct-horse-battery",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signUp.status, 200, await signUp.clone().text());
	const cookie = signUp.headers.get("set-cookie");
	assert.ok(cookie);

	const issued = await runtime.handle(
		new Request("http://localhost:3001/api/auth/token", {
			body: JSON.stringify({ audience: "neon" }),
			headers: {
				"content-type": "application/json",
				cookie: cookie.split(";")[0] ?? cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(issued.status, 200, await issued.clone().text());
	const token = (await issued.json()) as { token: string; tokenType: string };
	assert.equal(token.tokenType, "Bearer");
	assert.equal(token.token.split(".").length, 3);

	await runtime.close();
});
