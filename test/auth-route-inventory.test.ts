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
  ".."
);

const KNOWN_MISSING_IN_LOCAL = new Set([
  "DELETE /delete-user",
  "GET /delete-user/callback",
]);

test("public operation definitions remain source compatible", () => {
  const legacy: AthenaAuthOperationDefinition = {
    auth: "session",
    capability: "organizations",
    embedded: "supported",
    id: "legacy.list",
    method: "GET",
    mutation: false,
    path: "/organization/list",
    rust: "supported",
  };
  assert.equal(legacy.path, "/organization/list");
});

test("mechanical auth route inventory keeps JWT routes on both runtimes", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/auth-route-parity.mjs"],
    {
      cwd: packageRoot,
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const inventory = JSON.parse(
    readFileSync(
      path.join(packageRoot, "contracts/auth/routes.generated.json"),
      "utf8"
    )
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
      true
    );
    assert.equal(
      operation.embedded === "supported" ||
        operation.embedded === "unsupported",
      true
    );
    assert.equal(
      operation.auth === "public" ||
        operation.auth === "optional-session" ||
        operation.auth === "protocol" ||
        operation.auth === "session" ||
        operation.auth === "admin",
      true
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
      `rust missing ${required}`
    );
    assert.equal(
      inventory.missingInLocal.includes(required),
      false,
      `embedded local runtime missing ${required}`
    );
  }

  for (const required of [
    "GET /ok",
    "GET /health",
    "POST /update-user",
    "GET /.well-known/webauthn",
    "POST /admin/oauth-client/create",
    "GET /admin/oauth-client/list",
  ]) {
    assert.equal(
      inventory.rust.includes(required),
      true,
      `rust missing ${required}`
    );
    const [method, routePath] = required.split(" ");
    assert.equal(
      inventory.operations.find(
        (operation) =>
          operation.method === method && operation.path === routePath
      )?.rust,
      "supported",
      `inventory marks ${required} unsupported`
    );
  }

  assert.equal(
    inventory.operations.some(
      (operation) =>
        operation.path === "/admin/grant/list" &&
        operation.sdkEndpoint === "missing"
    ),
    true,
    "discovered routes report SDK endpoint knowledge independently"
  );
  const legacyOAuthClientCreate = inventory.operations.find(
    (operation) =>
      operation.method === "POST" &&
      operation.path === "/admin/oauth-client/create"
  );
  assert.equal(legacyOAuthClientCreate?.lifecycle, "compatibility");
  assert.equal(
    legacyOAuthClientCreate?.canonicalReplacement,
    "POST /admin/social-callback-registration/create"
  );
  assert.equal(legacyOAuthClientCreate?.sdkBindingRequired, false);
  assert.notEqual(legacyOAuthClientCreate?.nonportable, true);
  const legacyOAuthClientList = inventory.operations.find(
    (operation) =>
      operation.method === "GET" &&
      operation.path === "/admin/oauth-client/list"
  );
  assert.equal(legacyOAuthClientList?.lifecycle, "compatibility");
  assert.equal(
    legacyOAuthClientList?.canonicalReplacement,
    "GET /admin/social-callback-registration/list"
  );
  assert.deepEqual(
    inventory.operations.filter(
      (operation) =>
        operation.path.startsWith("/admin/") &&
        operation.availability === "portable" &&
        operation.nonportable === true
    ),
    []
  );
  assert.equal(
    inventory.sdkMissing.includes("/admin/oauth-client/create"),
    false
  );

  for (const [method, routePath] of [
    ["POST", "/admin/authorization-server/client/create"],
    ["GET", "/admin/authorization-server/client/get"],
    ["GET", "/admin/authorization-server/client/list"],
    ["POST", "/admin/authorization-server/client/update"],
    ["POST", "/admin/authorization-server/client/disable"],
    ["GET", "/admin/authorization-server/grant/list"],
    ["POST", "/admin/authorization-server/grant/revoke"],
  ]) {
    const operation = inventory.operations.find(
      (candidate) => candidate.method === method && candidate.path === routePath
    );
    assert.equal(operation?.runtimes.dedicated, "unsupported", routePath);
    assert.equal(operation?.runtimes.embedded, "supported", routePath);
    assert.equal(operation?.sdkEndpoint, "known", routePath);
    assert.equal(operation?.availability, "embedded-only", routePath);
    assert.equal(operation?.lifecycle, "canonical", routePath);
  }
  for (const [method, routePath] of [
    ["POST", "/admin/identity-connection/create"],
    ["GET", "/admin/identity-connection/get"],
    ["GET", "/admin/identity-connection/list"],
    ["POST", "/admin/identity-connection/update"],
    ["POST", "/admin/identity-connection/disable"],
  ]) {
    const operation = inventory.operations.find(
      (candidate) => candidate.method === method && candidate.path === routePath
    );
    assert.equal(operation?.runtimes.dedicated, "unsupported", routePath);
    assert.equal(operation?.runtimes.embedded, "supported", routePath);
    assert.equal(operation?.sdkEndpoint, "known", routePath);
    assert.equal(operation?.sdkBindingRequired, true, routePath);
    assert.equal(operation?.availability, "embedded-only", routePath);
    assert.equal(operation?.lifecycle, "canonical", routePath);
  }
  const authenticationPosture = inventory.operations.find(
    (operation) =>
      operation.method === "GET" &&
      operation.path === "/organization/list-authentication-posture"
  );
  assert.equal(
    authenticationPosture?.operation,
    "organization.authenticationPosture.list"
  );
  assert.equal(authenticationPosture?.runtimes.dedicated, "unsupported");
  assert.equal(authenticationPosture?.runtimes.embedded, "supported");
  assert.equal(authenticationPosture?.availability, "embedded-only");
  assert.equal(authenticationPosture?.lifecycle, "canonical");
  assert.equal(authenticationPosture?.sdkEndpoint, "known");
  assert.equal(authenticationPosture?.sdkBindingRequired, true);
  const lifecycleEvents = inventory.operations.find(
    (operation) =>
      operation.method === "GET" &&
      operation.path === "/organization/list-lifecycle-events"
  );
  assert.equal(lifecycleEvents?.operation, "organization.lifecycleEvents.list");
  assert.equal(lifecycleEvents?.runtimes.dedicated, "unsupported");
  assert.equal(lifecycleEvents?.runtimes.embedded, "supported");
  assert.equal(lifecycleEvents?.availability, "embedded-only");
  assert.equal(lifecycleEvents?.lifecycle, "canonical");
  assert.equal(lifecycleEvents?.sdkEndpoint, "known");
  assert.equal(lifecycleEvents?.sdkBindingRequired, true);
  for (const [method, routePath] of [
    ["POST", "/admin/social-callback-registration/create"],
    ["GET", "/admin/social-callback-registration/list"],
  ]) {
    const operation = inventory.operations.find(
      (candidate) => candidate.method === method && candidate.path === routePath
    );
    assert.equal(operation?.runtimes.dedicated, "supported", routePath);
    assert.equal(operation?.runtimes.embedded, "unsupported", routePath);
    assert.equal(operation?.availability, "dedicated-only", routePath);
    assert.equal(operation?.sdkBindingRequired, false, routePath);
  }

  const unexpected = inventory.missingInLocal.filter(
    (route) => !KNOWN_MISSING_IN_LOCAL.has(route)
  );
  assert.deepEqual(
    unexpected,
    [],
    `new Rust auth routes are missing from the Node local runtime: ${unexpected.join(", ")}`
  );

  const resolved = [...KNOWN_MISSING_IN_LOCAL].filter(
    (route) => !inventory.missingInLocal.includes(route)
  );
  assert.deepEqual(
    resolved,
    [],
    `allowlisted gaps were implemented — remove them from KNOWN_MISSING_IN_LOCAL: ${resolved.join(", ")}`
  );

  const catalogGaps = listMissingEmbeddedOperations(inventory.operations);
  assert.deepEqual(
    catalogGaps,
    [...KNOWN_MISSING_IN_LOCAL].sort(),
    "generated operations must be the SSOT behind KNOWN_MISSING_IN_LOCAL"
  );
});

test("embedded capability snapshot matches generated operation support", () => {
  const advertised = deriveEmbeddedCapabilityAdvertisement(
    ATHENA_AUTH_OPERATIONS
  );
  assert.equal(advertised.passkeys, true);
  assert.equal(advertised.socialProvidersAdvertised, true);
  assert.equal(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.passkeys, false);
  assert.equal(
    createEmbeddedCapabilitySnapshot({ passkeyEnabled: true }).passkeys,
    advertised.passkeys
  );
  assert.deepEqual(
    ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT.social?.providers,
    []
  );
});

test("passkey related origins and optional-session are in the operation catalog", () => {
  const related = ATHENA_AUTH_OPERATIONS.find(
    (operation) =>
      operation.method === "GET" && operation.path === "/.well-known/webauthn"
  );
  assert.ok(related);
  assert.equal(related?.id, "passkey.relatedOrigins");
  assert.equal(related?.capability, "passkeys");
  assert.equal(related?.rust, "supported");
  assert.equal(related?.embedded, "supported");
  assert.equal(related?.availability, "portable");
  assert.equal(related?.auth, "public");
  assert.equal(related?.mutation, false);

  const authenticateOptions = ATHENA_AUTH_OPERATIONS.find(
    (operation) =>
      operation.method === "POST" &&
      operation.path === "/passkey/generate-authenticate-options"
  );
  assert.ok(authenticateOptions);
  assert.equal(authenticateOptions?.auth, "optional-session");
  assert.equal(authenticateOptions?.capability, "passkeys");
});
