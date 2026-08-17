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
