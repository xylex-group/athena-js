import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AUTHORIZATION_CATALOG_VERSION } from "../src/runtime/authorization/catalog.ts";
import {
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
} from "../src/runtime/authorization/catalog-state.ts";

test("authorization catalog fingerprints are stable for the current catalog version", () => {
  assert.equal(AUTHORIZATION_CATALOG_VERSION, 3);
  const rights = authorizationRightsFingerprint();
  const roles = authorizationRolesFingerprint();
  assert.match(rights, /^[a-f0-9]{64}$/);
  assert.match(roles, /^[a-f0-9]{64}$/);
  assert.equal(rights, authorizationRightsFingerprint());
  assert.equal(roles, authorizationRolesFingerprint());
});
