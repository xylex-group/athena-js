import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

const KNOWN_MISSING_IN_LOCAL = new Set([
	"GET /callback/{provider}",
	"GET /change-email/verify",
	"GET /delete-user/verify",
	"GET /email/list",
	"GET /passkey/generate-register-options",
	"GET /passkey/list-user-passkeys",
	"GET /reset-password/{token}",
	"POST /link-social",
	"POST /passkey/delete-passkey",
	"POST /passkey/generate-authenticate-options",
	"POST /passkey/update-passkey",
	"POST /passkey/verify-authentication",
	"POST /passkey/verify-registration",
	"POST /sign-in/social",
	"POST /unlink-account",
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
		rust: string[];
		sdkMissing: string[];
	};

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
});
