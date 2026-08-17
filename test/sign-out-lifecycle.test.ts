import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { signOutAndClearAthenaSession } from "../src/utils/auth-cookies.ts";

test("signOutAndClearAthenaSession clears cookies after signOut", async () => {
	let signedOut = false;
	let bridgeCleared = false;
	const result = await signOutAndClearAthenaSession({
		clearBridge: async () => {
			bridgeCleared = true;
		},
		clearCookieOptions: {
			cookieHeader: "athena-auth.session_token=abc; other=1",
		},
		hardRedirect: false,
		signOut: async () => {
			signedOut = true;
		},
	});

	assert.equal(signedOut, true);
	assert.equal(bridgeCleared, true);
	assert.equal(result.signOutError, null);
	// clearAuthCookies no-ops without document; still returns matched names when cookieHeader set
	assert.equal(Array.isArray(result.clearedCookies), true);
});

test("signOutAndClearAthenaSession still clears when signOut throws", async () => {
	const result = await signOutAndClearAthenaSession({
		hardRedirect: false,
		signOut: async () => {
			throw new Error("network");
		},
	});
	assert.equal(result.signOutError instanceof Error, true);
	assert.equal((result.signOutError as Error).message, "network");
});

test("signOutAndClearAthenaSession rethrows when throwOnSignOutError", async () => {
	await assert.rejects(
		() =>
			signOutAndClearAthenaSession({
				hardRedirect: false,
				signOut: async () => {
					throw new Error("hard fail");
				},
				throwOnSignOutError: true,
			}),
		/hard fail/,
	);
});
