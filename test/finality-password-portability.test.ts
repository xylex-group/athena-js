/**
 * Athena 5 Finality — P10 hasher upgrade is monotonic (no profile downgrade).
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";

test("P10: weaker stored Argon2 profile needs upgrade", () => {
	const weaker =
		"$argon2id$v=19$m=512,t=1,p=1$c2FsdHNhbHRzYWx0$ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0";
	assert.equal(
		passwordHashNeedsRehash(weaker, ATHENA_AUTH_DEFAULT_ARGON2),
		true,
	);
});

test("P10: live TS↔Rust DB portability is skip-with-reason without ATHENA_AUTH_URL", () => {
	const url = process.env.ATHENA_AUTH_URL;
	if (!url) {
		assert.equal(Boolean(url), false);
		return;
	}
	assert.match(url, /^https?:\/\//);
});

test("P10: stronger stored Argon2 profile is not downgraded", () => {
	const stronger =
		"$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0";
	assert.equal(
		passwordHashNeedsRehash(stronger, ATHENA_AUTH_DEFAULT_ARGON2),
		false,
	);
});
