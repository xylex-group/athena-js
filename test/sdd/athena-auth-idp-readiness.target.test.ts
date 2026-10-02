import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseProtocolScopes } from "../../src/auth/authorization-server/scopes.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../src/auth/contract/operations.generated.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../src/auth/schema/generation.ts";

const packageRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  ".."
);

test("Embedded Auth schema generation 48 is allocated", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 48);
});

test("IdP readiness: identity scopes require openid", () => {
  const parsed = parseProtocolScopes("openid profile email files:read");
  assert.equal(parsed.identity.includes("openid"), true);
  assert.equal(parsed.resource.includes("openid"), false);
  assert.deepEqual(parsed.resource, ["files:read"]);
  assert.deepEqual(parseProtocolScopes("email files:read").resource, [
    "email",
    "files:read",
  ]);
  assert.deepEqual(parseProtocolScopes("email files:read").identity, []);
});

test("IdP readiness: implemented OpenID Provider capability is advertised", () => {
  assert.equal(
    ATHENA_AUTH_OPERATIONS.some((operation) => operation.capability === "oidc"),
    true
  );
  const discovery = ATHENA_AUTH_OPERATIONS.find(
    (operation) => operation.path === "/.well-known/openid-configuration"
  );
  assert.equal(discovery?.capability, "oidc");
});

test("IdP readiness: protocol identity never reads request Host", () => {
  const identity = readFileSync(
    join(packageRoot, "src/auth/protocol-identity.ts"),
    "utf8"
  );
  assert.doesNotMatch(identity, /request\.headers|request\.url/);
  assert.doesNotMatch(identity, /uniqueTrustedOrigin|trustedOrigins/);
  const router = readFileSync(
    join(packageRoot, "src/auth/local/router.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    router,
    /createLocalTokenAuthority\(\{[\s\S]*issuer:\s*origin/
  );
});

test("IdP readiness: mutation composition does not mutate token-key variables", () => {
  const deps = readFileSync(
    join(packageRoot, "src/auth/local/runtime-dependencies.ts"),
    "utf8"
  );
  assert.doesNotMatch(deps, /mutationTokenKeyStore|mutationTokenKeyOptions/);
  assert.match(deps, /ATHENA_AUTH_TOKEN_STORE_REQUIRED/);
});

test("IdP readiness: generic OIDC uses the discovery resolver", () => {
  const generic = readFileSync(
    join(packageRoot, "src/auth/social/server/generic-oidc-provider.ts"),
    "utf8"
  );
  assert.match(generic, /resolveOidcProviderEndpoints/);
  assert.doesNotMatch(generic, /\$\{issuer\(\)\}\/oauth\//);
});
