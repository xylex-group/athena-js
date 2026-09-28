import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  ORGANIZATION_OWNER_ROLE,
} from "../../../src/runtime/authorization/templates.ts";

test("superseded baseline: compatibility built-ins retain the legacy organization shape", () => {
  const owner = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === ORGANIZATION_OWNER_ROLE
  );
  assert.equal(owner?.scopeKind, "organization");
  assert.equal(owner?.id, ORGANIZATION_OWNER_ROLE);
});

test("superseded baseline: compatibility descriptors retain runtime state fields", () => {
  const owner = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === ORGANIZATION_OWNER_ROLE
  );
  assert.ok(owner);
  assert.equal(typeof owner.assignable, "boolean");
  assert.equal(typeof owner.protected, "boolean");
  assert.ok(Array.isArray(owner.rights));
});
