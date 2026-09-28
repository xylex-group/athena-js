/**
 * Shared OAuth deny corpus: JS runner. Rust athena-auth loads the same JSON.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const corpusPath = join(
  pkgRoot,
  "..",
  "..",
  "contracts",
  "auth",
  "oauth-deny-vectors.json"
);

const KNOWN_CODES = new Set([
  "ATHENA_AUTH_OAUTH_CALLBACK_INVALID",
  "ATHENA_AUTH_OAUTH_ID_TOKEN_INVALID",
  "ATHENA_AUTH_OAUTH_NONCE_MISMATCH",
  "ATHENA_AUTH_OAUTH_PKCE_S256_REQUIRED",
  "ATHENA_AUTH_OAUTH_PROVIDER_MIXUP",
  "ATHENA_AUTH_OAUTH_TRANSACTION_NOT_FOUND",
]);

test("shared OAuth deny corpus is consumed and codes exist in Embedded sources", () => {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
    vectors: Array<{ expectedDenyCode: string; id: string; kind: string }>;
  };
  assert.ok(corpus.vectors.length >= 6);
  const engine = readFileSync(
    join(pkgRoot, "src", "auth", "social", "server", "engine.ts"),
    "utf8"
  );
  const errors = readFileSync(
    join(pkgRoot, "src", "auth", "social", "server", "errors.ts"),
    "utf8"
  );
  const routes = readFileSync(
    join(pkgRoot, "src", "auth", "local", "social", "routes.ts"),
    "utf8"
  );
  const blob = `${engine}\n${errors}\n${routes}`;
  for (const vector of corpus.vectors) {
    assert.ok(KNOWN_CODES.has(vector.expectedDenyCode), vector.id);
    assert.match(
      blob,
      new RegExp(vector.expectedDenyCode.replaceAll(".", "\\.")),
      vector.id
    );
  }
});
