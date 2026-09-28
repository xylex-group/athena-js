import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { parseAthenaCapabilityKey } from "../../src/capabilities/key.ts";
import { createAthenaCanonicalInspectionPort } from "../../src/devtools/server-ir.ts";
import { getAthenaAuthorizationRightsAuthority } from "../../src/runtime/authorization/catalog.ts";
import {
  ATHENA_BUILTIN_ROLE_DEFINITIONS,
  canonicalizeAthenaRolesIr,
  fingerprintAthenaRolesIr,
} from "../../src/roles/index.ts";
import { rolesIrFromAuthorizationGraph } from "../../src/runtime/authorization/state.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
  getAthenaClientInternals,
} from "../../src/runtime/client-internals.ts";

test("canonical inspection exposes the runtime-owned Capabilities IR", async () => {
  const root = {};
  const capabilitiesIr = {
    capabilities: [
      {
        domain: "billing" as const,
        implementation: "native" as const,
        key: parseAthenaCapabilityKey("billing.operation.payments.create"),
        kind: "operation" as const,
        maturity: "stable" as const,
        sources: [],
        status: "available" as const,
      },
    ],
    irVersion: 1 as const,
    kind: "athena.capabilities" as const,
    metadata: {},
  };
  attachAthenaClientInternals(
    root,
    createRootClientInternals({
      capabilitiesFingerprint: "capability-fingerprint",
      capabilitiesIr,
      config: {} as never,
      plan: {} as never,
    })
  );

  const inspection = createAthenaCanonicalInspectionPort(root as never);
  const artifact = await inspection.read("capabilities");

  assert.equal(artifact?.descriptor.available, true);
  assert.equal(artifact?.descriptor.fingerprint, "capability-fingerprint");
  assert.deepEqual(artifact?.document, capabilitiesIr);

  const internals = getAthenaClientInternals(root);
  assert.ok(internals);
  internals.capabilitiesIr = {
    ...capabilitiesIr,
    capabilities: [
      { ...capabilitiesIr.capabilities[0]!, status: "unavailable" },
    ],
  };
  internals.capabilitiesFingerprint = "refreshed-fingerprint";
  const refreshed = await inspection.read("capabilities");
  assert.ok(refreshed);
  assert.equal(refreshed?.descriptor.fingerprint, "refreshed-fingerprint");
  assert.equal(
    (refreshed.document as typeof capabilitiesIr).capabilities[0]?.status,
    "unavailable"
  );
});

test("canonical inspection exposes root-owned Rights and Roles IR", async () => {
  const first = {};
  const second = {};
  const rolesIr = {
    irVersion: 1 as const,
    kind: "athena.roles" as const,
    metadata: {},
    roles: ATHENA_BUILTIN_ROLE_DEFINITIONS,
  };
  attachAthenaClientInternals(
    first,
    createRootClientInternals({
      config: {} as never,
      plan: {} as never,
      rolesIr,
    })
  );
  attachAthenaClientInternals(
    second,
    createRootClientInternals({
      config: {} as never,
      plan: {} as never,
      rolesIr,
    })
  );

  const firstInternals = getAthenaClientInternals(first);
  const secondInternals = getAthenaClientInternals(second);
  assert.ok(firstInternals);
  assert.ok(secondInternals);
  const firstRolesIr = firstInternals.rolesIr;
  assert.ok(firstRolesIr);
  const firstInspection = createAthenaCanonicalInspectionPort(first as never);
  const secondInspection = createAthenaCanonicalInspectionPort(second as never);
  firstInternals.rolesIr = {
    ...firstRolesIr,
    roles: ATHENA_BUILTIN_ROLE_DEFINITIONS.slice(0, 1),
  };
  firstInternals.rolesFingerprint = "first-roles";

  const firstRoles = await firstInspection.read("roles");
  const secondRoles = await secondInspection.read("roles");
  const firstRights = await firstInspection.read("rights");

  assert.equal(firstRoles?.descriptor.fingerprint, "first-roles");
  assert.equal(firstRoles?.document, firstInternals.rolesIr);
  assert.notEqual(secondRoles?.descriptor.fingerprint, "first-roles");
  assert.equal(firstRights?.document, firstInternals.rightsIr);
  assert.equal(
    firstRights?.descriptor.fingerprint,
    firstInternals.rightsFingerprint
  );
});

test("root internals retain canonicalized supplied Roles IR", () => {
  const suppliedRoles = {
    irVersion: 1 as const,
    kind: "athena.roles" as const,
    metadata: { provenance: ["z-source", "z-source", "a-source"] },
    roles: ATHENA_BUILTIN_ROLE_DEFINITIONS.slice()
      .reverse()
      .map((role) => ({ ...role, rights: [...role.rights].reverse() })),
  };
  const root = {};
  attachAthenaClientInternals(
    root,
    createRootClientInternals({
      config: {} as never,
      plan: {} as never,
      rolesIr: suppliedRoles,
    })
  );

  const internals = getAthenaClientInternals(root);
  assert.ok(internals);
  assert.deepEqual(
    internals.rolesIr,
    canonicalizeAthenaRolesIr(suppliedRoles, internals.rightsAuthority)
  );
});

test("local authorization inspection projects persisted custom roles", async () => {
  const graph = {
    assignments: [],
    audit: [],
    revision: 2,
    roles: [
      {
        assignable: true,
        assignmentCount: 0,
        id: "custom_role",
        key: "custom_role",
        name: "Custom role",
        organizationId: null,
        protected: false,
        rightCount: 1,
        rights: ["authorization.platform.read" as const],
        scopeKind: "platform" as const,
        systemKind: null,
        version: 1,
      },
    ],
  };
  const root = {};
  const persistedRoles = rolesIrFromAuthorizationGraph(
    graph,
    getAthenaAuthorizationRightsAuthority()
  );
  attachAthenaClientInternals(
    root,
    createRootClientInternals({
      config: { auth: { mode: "local" } } as never,
      getRolesIr: async () => persistedRoles,
      plan: {} as never,
      rolesFingerprint: "stale-fingerprint",
    })
  );

  const artifact = await createAthenaCanonicalInspectionPort(
    root as never
  ).read("roles");

  assert.equal(artifact?.descriptor.available, true);
  assert.ok(artifact);
  assert.equal(
    (artifact.document as typeof persistedRoles).roles[0]?.key,
    "custom_role"
  );
  assert.equal(
    artifact.descriptor.fingerprint,
    fingerprintAthenaRolesIr(
      persistedRoles,
      getAthenaAuthorizationRightsAuthority()
    )
  );
});

test("disabled Auth does not advertise canonical Roles inspection", async () => {
  const root = {};
  attachAthenaClientInternals(
    root,
    createRootClientInternals({
      config: { auth: false } as never,
      plan: {} as never,
    })
  );

  const artifact = await createAthenaCanonicalInspectionPort(
    root as never
  ).read("roles");

  assert.equal(artifact?.descriptor.available, false);
  assert.equal(artifact?.descriptor.reason, "authorization-store-unavailable");
});
