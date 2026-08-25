import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
	createEmbeddedCapabilitySnapshot,
} from "../src/auth/capabilities.ts";
import { ATHENA_AUTH_OPERATIONS } from "../src/auth/contract/operations.generated.ts";
import {
	type AthenaAuthOperationDefinition,
	deriveEmbeddedCapabilityAdvertisement,
	listMissingEmbeddedOperations,
} from "../src/auth/contract/operations.ts";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

const KNOWN_MISSING_IN_LOCAL = new Set([
]);

test("mechanical auth route inventory keeps JWT routes on both runtimes", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/auth-route-parity.mjs"],
		{
			cwd: packageRoot,
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);

	const inventory = JSON.parse(
		readFileSync(
			path.join(packageRoot, "contracts/auth/routes.generated.json"),
			"utf8",
		),
	) as {
		missingInLocal: string[];
		operations: AthenaAuthOperationDefinition[];
		rust: string[];
		sdkMissing: string[];
	};

	assert.equal(Array.isArray(inventory.operations), true);
	assert.equal(inventory.operations.length > 0, true);
	for (const operation of inventory.operations) {
		assert.equal(typeof operation.id, "string");
		assert.equal(typeof operation.method, "string");
		assert.equal(typeof operation.path, "string");
		assert.equal(typeof operation.capability, "string");
		assert.equal(
			operation.rust === "supported" || operation.rust === "unsupported",
			true,
		);
		assert.equal(
			operation.embedded === "supported" ||
				operation.embedded === "unsupported",
			true,
		);
		assert.equal(
			operation.auth === "public" ||
				operation.auth === "optional-session" ||
				operation.auth === "session" ||
				operation.auth === "admin",
			true,
		);
		assert.equal(typeof operation.mutation, "boolean");
	}

	for (const required of [
		"POST /token",
		"GET /.well-known/jwks.json",
		"GET /.well-known/openid-configuration",
	]) {
		assert.equal(
			inventory.rust.includes(required),
			true,
			`rust missing ${required}`,
		);
		assert.equal(
			inventory.missingInLocal.includes(required),
			false,
			`embedded local runtime missing ${required}`,
		);
	}

	assert.deepEqual(inventory.sdkMissing, []);

	const unexpected = inventory.missingInLocal.filter(
		(route) => !KNOWN_MISSING_IN_LOCAL.has(route),
	);
	assert.deepEqual(
		unexpected,
		[],
		`new Rust auth routes are missing from the Node local runtime: ${unexpected.join(", ")}`,
	);

	const resolved = [...KNOWN_MISSING_IN_LOCAL].filter(
		(route) => !inventory.missingInLocal.includes(route),
	);
	assert.deepEqual(
		resolved,
		[],
		`allowlisted gaps were implemented — remove them from KNOWN_MISSING_IN_LOCAL: ${resolved.join(", ")}`,
	);

	const catalogGaps = listMissingEmbeddedOperations(inventory.operations);
	assert.deepEqual(
		catalogGaps,
		[...KNOWN_MISSING_IN_LOCAL].sort(),
		"generated operations must be the SSOT behind KNOWN_MISSING_IN_LOCAL",
	);
});

test("embedded capability snapshot matches generated operation support", () => {
	const advertised = deriveEmbeddedCapabilityAdvertisement(
		ATHENA_AUTH_OPERATIONS,
	);
	assert.equal(advertised.passkeys, true);
	assert.equal(advertised.socialProvidersAdvertised, true);
	assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
	assert.equal(
		createEmbeddedCapabilitySnapshot({ passkeyEnabled: true }).passkeys,
		advertised.passkeys,
	);
	assert.deepEqual(
		ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.social?.providers,
		[],
	);
});

test("passkey related origins and optional-session are in the operation catalog", () => {
	const related = ATHENA_AUTH_OPERATIONS.find(
		(operation) =>
			operation.method === "GET" && operation.path === "/.well-known/webauthn",
	);
	assert.ok(related);
	assert.equal(related?.id, "passkey.relatedOrigins");
	assert.equal(related?.capability, "passkeys");
	assert.equal(related?.rust, "supported");
	assert.equal(related?.embedded, "supported");
	assert.equal(related?.auth, "public");
	assert.equal(related?.mutation, false);

	const authenticateOptions = ATHENA_AUTH_OPERATIONS.find(
		(operation) =>
			operation.method === "POST" &&
			operation.path === "/passkey/generate-authenticate-options",
	);
	assert.ok(authenticateOptions);
	assert.equal(authenticateOptions?.auth, "optional-session");
	assert.equal(authenticateOptions?.capability, "passkeys");
});
