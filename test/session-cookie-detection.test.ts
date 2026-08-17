import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthSessionCookie } from "../src/cookies/session-cookie-detection.ts";

test("hasAuthSessionCookie matches Better Auth and Athena hyphen/underscore forms", () => {
	assert.equal(hasAuthSessionCookie(null), false);
	assert.equal(hasAuthSessionCookie(""), false);
	assert.equal(hasAuthSessionCookie("better-auth.session_token=abc"), true);
	assert.equal(
		hasAuthSessionCookie("__Secure-better-auth.session_token=abc"),
		true,
	);
	assert.equal(hasAuthSessionCookie("athena-auth.session-token=abc"), true);
	assert.equal(hasAuthSessionCookie("athena-auth.session_token=abc"), true);
	assert.equal(
		hasAuthSessionCookie("__Secure-athena-auth.session_token=abc"),
		true,
	);
	assert.equal(hasAuthSessionCookie("athena-auth-session_token=abc"), true);
	assert.equal(
		hasAuthSessionCookie("foo=bar; athena-auth.session_token=xyz; other=1"),
		true,
	);
	assert.equal(hasAuthSessionCookie("athena-auth.other=1"), false);
});
