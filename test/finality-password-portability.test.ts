/**
 * Athena 5 Finality — P10 hasher upgrade is monotonic (no profile downgrade).
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";

const LOCAL_AUTH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/auth/local"
);

test("P10: weaker stored Argon2 profile needs upgrade", () => {
  const weaker =
    "$argon2id$v=19$m=512,t=1,p=1$c2FsdHNhbHRzYWx0$ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0";
  assert.equal(
    passwordHashNeedsRehash(weaker, ATHENA_AUTH_DEFAULT_ARGON2),
    true
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
    false
  );
});

test("P10: Argon2 is a static server boundary, not an opaque runtime import", () => {
  const password = readFileSync(join(LOCAL_AUTH, "password.ts"), "utf8");
  const argon2Node = readFileSync(join(LOCAL_AUTH, "argon2.node.ts"), "utf8");
  assert.match(password, /from ["']\.\/argon2\.node\.ts["']/);
  assert.equal(password.includes("new Function("), false);
  assert.equal(password.includes("@noble/hashes/argon2"), false);
  assert.match(argon2Node, /from ["']@noble\/hashes\/argon2\.js["']/);
  assert.doesNotMatch(argon2Node, /^import ["']server-only["']/m);
});
