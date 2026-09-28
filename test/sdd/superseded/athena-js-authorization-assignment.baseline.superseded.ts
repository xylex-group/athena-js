/**
 * Characterization: authorization assignment found case (Phase 0 freeze).
 * GREEN on current HEAD defects. Must FAIL after cutover — then retire to superseded/.
 * See docs/sdd/xylex/athena-js-authorization-assignment/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BILLING_OPERATION_RIGHTS } from "../../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipalRightsProjection } from "../../src/runtime/data/principal.ts";
import {
  resolveAuthorizationMode,
  resolveStoredUserRightsResolution,
} from "../../src/runtime/data/rights-resolution.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const fixturePath = join(
  pkgRoot,
  "test",
  "fixtures",
  "authorization",
  "persona-effective-rights-v1.json"
);
const nextMinimalRoot = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "src",
  "lib",
  "athena",
  "root.ts"
);
const authSchema = join(srcRoot, "auth", "local", "schema.ts");
const orgInvariants = join(
  srcRoot,
  "auth",
  "local",
  "organization-invariants.ts"
);

type PersonaFixture = {
  defaultRole: string;
  operationNamesInAdminMap: readonly string[];
  personas: readonly {
    id: string;
    ok: boolean;
    reason?: string;
    selectedRole: string;
    source: string;
    userRole: string | null;
  }[];
  rightsByRole: Record<string, readonly string[]>;
};

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PersonaFixture;

function authorizationFromFixture(): AthenaPrincipalRightsProjection {
  return {
    defaultRole: fixture.defaultRole,
    mode: "role",
    rightsByRole: fixture.rightsByRole,
  };
}

test("P?: next-minimal owns rightsByRole", () => {
  const source = readFileSync(nextMinimalRoot, "utf8");
  assert.match(source, /rightsByRole/);
});

test("P?: admin map includes billing operation ids", () => {
  const admin = fixture.rightsByRole.admin ?? [];
  for (const operation of fixture.operationNamesInAdminMap) {
    assert.ok(
      admin.includes(operation),
      `admin map missing operation ${operation}`
    );
  }
  const source = readFileSync(nextMinimalRoot, "utf8");
  for (const operation of fixture.operationNamesInAdminMap) {
    assert.ok(source.includes(`"${operation}"`));
  }
});

test("P?: customer map includes billing.self.payments.read", () => {
  const customer = fixture.rightsByRole.customer ?? [];
  assert.ok(customer.includes("billing.self.payments.read"));
  assert.equal(customer.includes("self.payments.list"), false);
});

test("P?: resolver matches persona fixtures", () => {
  const authorization = authorizationFromFixture();
  for (const persona of fixture.personas) {
    const resolution = resolveStoredUserRightsResolution(
      { role: persona.userRole },
      authorization,
      { userId: persona.id }
    );
    assert.equal(resolution.ok, persona.ok, persona.id);
    assert.equal(resolution.source, persona.source, persona.id);
    if (resolution.ok) {
      assert.equal(resolution.role, persona.selectedRole, persona.id);
      const expected = fixture.rightsByRole[persona.selectedRole] ?? [];
      assert.deepEqual([...resolution.rights], [...expected], persona.id);
      continue;
    }
    assert.equal(resolution.reason, persona.reason, persona.id);
    assert.equal(resolution.role, persona.selectedRole, persona.id);
    assert.deepEqual([...resolution.rights], []);
  }
});

test("P?: self.payments.list is valid right-key syntax", () => {
  const key = parseAthenaRightKey("self.payments.list");
  assert.equal(key, "self.payments.list");
});

test("P?: self.payments.list maps to billing.self.payments.read", () => {
  const required = BILLING_OPERATION_RIGHTS["self.payments.list"];
  assert.deepEqual([...required], ["billing.self.payments.read"]);
});

test("P?: auth schema has no authorization_ relations", () => {
  const source = readFileSync(authSchema, "utf8");
  assert.equal(
    /CREATE TABLE IF NOT EXISTS athena\.authorization_/i.test(source),
    false
  );
});

test("P?: users.role is unconstrained TEXT", () => {
  const source = readFileSync(authSchema, "utf8");
  assert.match(
    source,
    /CREATE TABLE IF NOT EXISTS athena\.users \([\s\S]*?role TEXT,/
  );
  assert.equal(
    /users \([\s\S]*?role TEXT[^\n]*REFERENCES/i.test(source),
    false
  );
});

test("P?: member.role is unconstrained TEXT", () => {
  const source = readFileSync(authSchema, "utf8");
  assert.match(
    source,
    /CREATE TABLE IF NOT EXISTS athena\.member \([\s\S]*?role TEXT NOT NULL DEFAULT 'member',/
  );
});

test("P?: server founding-owner lock exists", () => {
  const source = readFileSync(orgInvariants, "utf8");
  assert.match(source, /FOUNDING_OWNER_ROLE_LOCKED/);
  assert.match(source, /assertFoundingOwnerMutationAllowed/);
});

test("P?: server has no last-owner invariant", () => {
  const source = readFileSync(orgInvariants, "utf8");
  assert.equal(/sole owner/i.test(source), false);
  assert.equal(/last remaining owner/i.test(source), false);
  assert.equal(/ownerCount/i.test(source), false);
});

test("P?: stored resolution mode exists", () => {
  assert.equal(resolveAuthorizationMode({ mode: "stored" }), "stored");
  assert.equal(resolveAuthorizationMode({ mode: "role" }), "role");
  assert.equal(resolveAuthorizationMode({}), "role");
});

test("P?: no AuthorizationManager", () => {
  const rightsIndex = readFileSync(join(srcRoot, "rights", "index.ts"), "utf8");
  assert.equal(rightsIndex.includes("AuthorizationManager"), false);
  const resolution = readFileSync(
    join(srcRoot, "runtime", "data", "rights-resolution.ts"),
    "utf8"
  );
  assert.equal(resolution.includes("AuthorizationManager"), false);
});

test("P?: no NATIVE_RIGHTS dump", () => {
  const key = readFileSync(join(srcRoot, "rights", "key.ts"), "utf8");
  assert.equal(key.includes("NATIVE_RIGHTS"), false);
});

test("P?: no createRightsClient", () => {
  const index = readFileSync(join(srcRoot, "rights", "index.ts"), "utf8");
  assert.equal(index.includes("createRightsClient"), false);
});
