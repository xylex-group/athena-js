/**
 * Packed createClient constructor typing must stay on the published
 * `/server` declaration surface, not only on package source.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("createClient config splits runtime, services, and models", () => {
  const core = readFileSync(
    join(packageRoot, "src", "client", "contracts.ts"),
    "utf8"
  );
  assert.match(core, /export interface AthenaClientRuntimeConfig/);
  assert.match(core, /export interface AthenaClientServicesConfig/);
  assert.match(
    core,
    /export interface AthenaClientConfig[\s\S]*extends AthenaClientRuntimeConfig,\s*AthenaClientServicesConfig/
  );
  assert.match(core, /models\?: TModels/);
  const servicesStart = core.indexOf(
    "export interface AthenaClientServicesConfig"
  );
  const clientStart = core.indexOf("export interface AthenaClientConfig");
  assert.ok(servicesStart >= 0 && clientStart > servicesStart);
  const services = core.slice(servicesStart, clientStart);
  assert.match(services, /auth\?: false \| AthenaAuthConfig/);
  assert.match(services, /billing\?:/);
  assert.match(services, /storage\?:/);
  assert.match(services, /email\?:/);
  assert.equal(/\bmodels\?:/.test(services), false);
});

test("packed type-surface fixture and tarball tsc gate exist", () => {
  const fixture = readFileSync(
    join(
      packageRoot,
      "test",
      "fixtures",
      "create-client-type-surface",
      "constructor.ts"
    ),
    "utf8"
  );
  assert.match(fixture, /from "@xylex-group\/athena\/server"/);
  assert.match(fixture, /createClient\(\{/);
  assert.match(fixture, /autoMigrate:\s*true/);
  assert.match(fixture, /passkey:/);
  assert.match(fixture, /social:/);

  const tarball = readFileSync(
    join(packageRoot, "scripts", "check-release-tarball.mjs"),
    "utf8"
  );
  assert.match(tarball, /create-client-type-surface/);
  assert.match(tarball, /packed-server-types:ok/);
});

test("published root declarations retain Auth API-key and passkey DTOs", () => {
  const rootIndex = readFileSync(
    join(packageRoot, "src", "index.ts"),
    "utf8"
  );
  const tarball = readFileSync(
    join(packageRoot, "scripts", "check-release-tarball.mjs"),
    "utf8"
  );

  assert.match(rootIndex, /AthenaApiKeyRecord/);
  assert.match(rootIndex, /AthenaPasskeyRecord/);
  assert.match(tarball, /AthenaApiKeyRecord/);
  assert.match(tarball, /AthenaPasskeyRecord/);
});
