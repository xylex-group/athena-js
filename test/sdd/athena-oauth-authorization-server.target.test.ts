import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../src/auth/schema/generation.ts";

const packageRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  ".."
);

const source = (relativePath: string): string =>
  readFileSync(join(packageRoot, relativePath), "utf8");

test("OAuth finality: Embedded Auth schema is allocated through migration 45", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 45);
  const manifest = source("src/auth/local/schema-manifest.ts");
  for (const version of [39, 40, 41, 42, 43, 44, 45]) {
    assert.match(manifest, new RegExp(`\\b${version}\\s*:`));
  }
});

test("OAuth finality: protocol operations are generated and explicit", () => {
  const expected = [
    "GET /.well-known/oauth-authorization-server",
    "GET /oauth/authorize",
    "POST /oauth/authorize",
    "POST /oauth/token",
    "POST /oauth/revoke",
  ];
  const actual = new Set(
    ATHENA_AUTH_OPERATIONS.map(
      (operation) => `${operation.method} ${operation.path}`
    )
  );
  for (const operation of expected) {
    assert.equal(actual.has(operation), true, operation);
  }
});

test("OAuth finality: one authority and one signing-key store remain", () => {
  const localSource = [
    source("src/auth/local/token-authority.ts"),
    source("src/auth/local/token-key-store.ts"),
  ].join("\n");
  const authoritySource = source("src/runtime/authority/resolve.ts");
  assert.match(authoritySource, /authority:\s*"jwt"/);
  assert.doesNotMatch(localSource, /OAuthSigningKeyStore|McpPrincipal|OAuthPrincipal/);
});

test("OAuth finality: authorization-server modules exist behind local Auth", () => {
  for (const relativePath of [
    "src/auth/authorization-server/types.ts",
    "src/auth/authorization-server/pkce.ts",
    "src/auth/authorization-server/redirect-uri.ts",
    "src/auth/authorization-server/resource.ts",
    "src/auth/authorization-server/scopes.ts",
    "src/auth/local/authorization-server/routes.ts",
    "src/auth/local/authorization-server/service.ts",
    "src/runtime/authority/oauth-verifier.ts",
  ]) {
    assert.equal(existsSync(join(packageRoot, relativePath)), true, relativePath);
  }
});
