import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";

test("legacy routing-only auth config normalizes to remote execution", () => {
	const normalized = normalizeAthenaAuthConfig({
		routing: "same-origin",
		upstreamUrl: "https://auth.example.com",
	});
	assert.equal(normalized.execution, "remote");
	assert.equal(normalized.routing, "same-origin");
	assert.equal(normalized.upstreamUrl, "https://auth.example.com");
	assert.ok(normalized.warnings.length > 0);
});

test("explicit local mode ignores remote url fields", () => {
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		url: "https://auth.example.com",
		routing: "direct",
	});
	assert.equal(normalized.execution, "local");
	assert.equal(normalized.routing, "same-origin");
	assert.ok(
		normalized.warnings.some((warning) => warning.includes("ignores remote")),
	);
});

test("auth:false normalizes to disabled execution", () => {
	const normalized = normalizeAthenaAuthConfig(false);
	assert.equal(normalized.execution, "disabled");
});

test("normalizeAthenaAuthConfig always includes APP_URL in trustedOrigins", () => {
	const previous = process.env.APP_URL;
	process.env.APP_URL = "https://app.example.com/dashboard";
	try {
		const normalized = normalizeAthenaAuthConfig({
			mode: "local",
			security: { trustedOrigins: ["https://other.example.com"] },
		});
		assert.equal(
			normalized.security.trustedOrigins.includes("https://app.example.com"),
			true,
		);
		assert.equal(
			normalized.security.trustedOrigins.includes("https://other.example.com"),
			true,
		);
	} finally {
		if (previous === undefined) {
			delete process.env.APP_URL;
		} else {
			process.env.APP_URL = previous;
		}
	}
});

test("normalizeAthenaAuthConfig dedupes repeated passkey origins", () => {
	const origin = "https://2f6c-178-230-72-220.ngrok-free.app";
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: { origins: [origin, `${origin}/`] },
	});
	assert.deepEqual(normalized.passkey.origins, [origin]);
	assert.equal(
		normalized.security.trustedOrigins.filter((entry) => entry === origin)
			.length,
		1,
	);
});

test("normalizeAthenaAuthConfig includes passkey.origins in trustedOrigins", () => {
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: { origins: ["http://localhost:3010/"] },
	});
	assert.equal(
		normalized.security.trustedOrigins.includes("http://localhost:3010"),
		true,
	);
});

test("explicit remote mode keeps direct routing", () => {
	const normalized = normalizeAthenaAuthConfig({
		mode: "remote",
		routing: "direct",
		url: "https://auth.example.com",
	});
	assert.equal(normalized.execution, "remote");
	assert.equal(normalized.routing, "direct");
	assert.equal(normalized.url, "https://auth.example.com");
});
