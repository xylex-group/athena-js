import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAthenaRightsAuthority } from "../../src/rights/authority.ts";
import { AUTHORIZATION_RIGHT_DEFINITIONS } from "../../src/rights/definitions.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { ATHENA_BUILTIN_ROLE_DEFINITIONS } from "../../src/roles/builtin.ts";
import {
  ATHENA_ROLES_IR_KIND,
  ATHENA_ROLES_IR_VERSION,
  type AthenaRoleDefinition,
  type AthenaRolesIr,
  canonicalizeAthenaRolesIr,
  fingerprintAthenaRolesIr,
  parseAthenaRoleId,
  parseAthenaRoleKey,
  projectAuthorizationSnapshotRole,
  tryHydrateAthenaRoleDefinition,
  validateAthenaRolesIr,
} from "../../src/roles/index.ts";
import { getAthenaAuthorizationRightsAuthority } from "../../src/runtime/authorization/catalog.ts";
import { authorizationRolesFingerprint } from "../../src/runtime/authorization/catalog-state.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";
import { parseAuthorizationSnapshot } from "../../src/runtime/authorization/parse-snapshot.ts";
import { resolveAthenaAuthorizationIrState } from "../../src/runtime/authorization/state.ts";

const platformRead = parseAthenaRightKey("authorization.platform.read");
const organizationRead = parseAthenaRightKey("organization.members.read");
const billingCatalogRead = parseAthenaRightKey("billing.catalog.read");
const defaultRightsAuthority = getAthenaAuthorizationRightsAuthority();

test("core organization rights retain organization scope across runtime projections", () => {
  const organizationKeys = new Set([
    "organization.members.read",
    "authorization.roles.read",
    "authorization.roles.write",
  ]);
  const definitions = AUTHORIZATION_RIGHT_DEFINITIONS.filter((definition) =>
    organizationKeys.has(definition.key),
  );

  assert.equal(definitions.length, organizationKeys.size);
  assert.ok(definitions.every((definition) => definition.scopeKind === "organization"));
});

function role(
  overrides: Partial<AthenaRoleDefinition> = {},
): AthenaRoleDefinition {
  return {
    assignable: true,
    description: "A custom role",
    displayName: "Custom role",
    id: parseAthenaRoleId("custom_role"),
    key: parseAthenaRoleKey("custom_role"),
    protected: false,
    rights: [platformRead],
    scope: { kind: "platform" },
    systemKind: null,
    ...overrides,
  };
}

function document(
  roles: readonly AthenaRoleDefinition[] = [role()],
): AthenaRolesIr {
  return {
    irVersion: ATHENA_ROLES_IR_VERSION,
    kind: ATHENA_ROLES_IR_KIND,
    metadata: { provenance: ["test"] },
    roles,
  };
}

test("role IDs and keys are distinct branded identities", () => {
  const id = parseAthenaRoleId("role_1");
  const key = parseAthenaRoleKey("role_1");

  assert.equal(id, key);
  assert.equal(typeof id, "string");
  assert.equal(typeof key, "string");
});

test("role key parsing trims edges and rejects aliases or invalid syntax", () => {
  assert.equal(parseAthenaRoleKey("  billing_admin "), "billing_admin");
  for (const value of ["", "Admin", "admin", "owner", "role-name", "1role"]) {
    assert.throws(() => parseAthenaRoleKey(value));
  }
});

test("session snapshot hydration skips persisted legacy role keys", () => {
  const skipped = tryHydrateAthenaRoleDefinition({
    record: {
      assignable: true,
      id: "legacy_owner",
      key: "owner",
      name: "Owner",
      organizationId: null,
      protected: true,
      scopeKind: "organization",
      systemKind: "owner",
    },
    rights: [],
  });
  assert.equal(skipped, undefined);

  const hydrated = tryHydrateAthenaRoleDefinition({
    record: {
      assignable: true,
      id: "organization_owner",
      key: "organization_owner",
      name: "Owner",
      organizationId: null,
      protected: true,
      scopeKind: "organization",
      systemKind: "owner",
    },
    rights: [organizationRead],
  });
  assert.equal(hydrated?.key, "organization_owner");
});

test("role validation rejects unknown fields, duplicate identities, and invalid scopes", () => {
  assert.throws(() =>
    validateAthenaRolesIr({
      ...document(),
      roles: [{ ...role(), unexpected: true } as AthenaRoleDefinition],
    }),
  );
  assert.throws(() =>
    validateAthenaRolesIr(
      document([role(), role({ id: parseAthenaRoleId("other") })]),
    ),
  );
  assert.throws(() =>
    validateAthenaRolesIr(
      document([
        role({
          rights: [organizationRead],
          scope: { kind: "organization", organizationId: "" },
        }),
      ]),
    ),
  );
});

test("role validation enforces right catalog and scope compatibility", () => {
  assert.doesNotThrow(() => validateAthenaRolesIr(document()));
  assert.doesNotThrow(() =>
    validateAthenaRolesIr(
      document([
        role({
          rights: [organizationRead, billingCatalogRead],
          scope: { kind: "organization", organizationId: "org-1" },
        }),
      ]),
    ),
  );
  assert.throws(() =>
    validateAthenaRolesIr(document([role({ rights: [organizationRead] })])),
  );
});

test("role validation uses the supplied Rights authority", () => {
  const customRight = parseAthenaRightKey("data.records.read");
  const authority = createAthenaRightsAuthority({
    irVersion: 1,
    kind: "athena.rights",
    metadata: {},
    rights: [
      {
        assignable: true,
        description: "Read records",
        displayName: "Read records",
        domain: "data",
        key: customRight,
        riskLevel: "low",
        scopeKind: "self",
      },
    ],
  });

  assert.doesNotThrow(() =>
    validateAthenaRolesIr(
      document([role({ rights: [customRight] })]),
      authority,
    ),
  );
  assert.doesNotThrow(() =>
    fingerprintAthenaRolesIr(
      document([role({ rights: [customRight] })]),
      authority,
    ),
  );
  const state = resolveAthenaAuthorizationIrState({
    rightsIr: authority.document,
  });
  assert.equal(state.rolesIr, undefined);
  assert.equal(state.rolesFingerprint, undefined);
});

test("canonicalization is deterministic, idempotent, and non-mutating", () => {
  const input = document([
    role({
      id: parseAthenaRoleId("z"),
      key: parseAthenaRoleKey("z_role"),
      rights: [platformRead, billingCatalogRead],
    }),
    role({
      id: parseAthenaRoleId("a"),
      key: parseAthenaRoleKey("a_role"),
      rights: [billingCatalogRead, platformRead],
    }),
  ]);
  const before = JSON.stringify(input);
  const canonical = canonicalizeAthenaRolesIr(input);

  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    canonical.roles.map((entry) => entry.key),
    ["a_role", "z_role"],
  );
  assert.deepEqual(canonical.roles[0]?.rights, [
    platformRead,
    billingCatalogRead,
  ]);
  assert.deepEqual(canonicalizeAthenaRolesIr(canonical), canonical);
});

test("semantic fingerprint ignores metadata and input order but tracks meaning", () => {
  const first = document([
    role({
      id: parseAthenaRoleId("a"),
      key: parseAthenaRoleKey("a_role"),
    }),
  ]);
  const reordered = {
    ...first,
    metadata: { provenance: ["different", "metadata"] },
    roles: [...first.roles].reverse(),
  };

  assert.equal(
    fingerprintAthenaRolesIr(first, defaultRightsAuthority),
    fingerprintAthenaRolesIr(reordered, defaultRightsAuthority),
  );
  assert.notEqual(
    fingerprintAthenaRolesIr(first, defaultRightsAuthority),
    fingerprintAthenaRolesIr(
      {
        ...first,
        roles: [
          role({
            displayName: "Renamed role",
            id: parseAthenaRoleId("a"),
            key: parseAthenaRoleKey("a_role"),
          }),
        ],
      },
      defaultRightsAuthority,
    ),
  );
});

test("built-in role definitions are canonical organization templates", () => {
  const owner = ATHENA_BUILTIN_ROLE_DEFINITIONS.find(
    (entry) => entry.key === "organization_owner",
  );
  assert.ok(owner);
  assert.deepEqual(owner.scope, { kind: "organization-template" });
  assert.equal(owner.systemKind, "owner");
  assert.doesNotThrow(() =>
    validateAthenaRolesIr({
      ...document(),
      roles: ATHENA_BUILTIN_ROLE_DEFINITIONS,
    }),
  );
});

test("authorization catalog state uses the canonical semantic role fingerprint", () => {
  assert.equal(
    authorizationRolesFingerprint(),
    fingerprintAthenaRolesIr(
      {
        irVersion: ATHENA_ROLES_IR_VERSION,
        kind: ATHENA_ROLES_IR_KIND,
        metadata: {},
        roles: ATHENA_BUILTIN_ROLE_DEFINITIONS,
      },
      defaultRightsAuthority,
    ),
  );
});

test("PostgreSQL snapshot hydration loads role Rights in one query", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const source = readFileSync(
    join(packageRoot, "src", "runtime", "authorization", "postgres.ts"),
    "utf8",
  );
  assert.match(source, /array_agg\(rr\.right_key ORDER BY rr\.right_key\)/i);
  assert.doesNotMatch(
    source,
    /rights:\s*await this\.listRoleRights\(record\.id\)/,
  );
});

test("snapshot projection contextualizes templates without changing canonical scope", () => {
  const owner = ATHENA_BUILTIN_ROLE_DEFINITIONS.find(
    (entry) => entry.key === "organization_owner",
  );
  assert.ok(owner);
  const projected = projectAuthorizationSnapshotRole(owner, {
    activeOrganizationId: "org-1",
    assignmentCount: 0,
    version: 1,
  });
  assert.equal(projected?.scopeKind, "organization");
  assert.equal(projected?.organizationId, "org-1");

  assert.equal(
    projectAuthorizationSnapshotRole(owner, {
      assignmentCount: 0,
      version: 1,
    }),
    undefined,
  );
});

test("Roles IR consumes, but does not own, runtime authorization catalog", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const builtin = readFileSync(
    join(packageRoot, "src", "roles", "builtin.ts"),
    "utf8",
  );
  const validator = readFileSync(
    join(packageRoot, "src", "roles", "ir", "validate.ts"),
    "utf8",
  );

  assert.doesNotMatch(
    builtin,
    /resolveAthenaRightsIr|BILLING_RIGHT_DEFINITIONS/,
  );
  assert.doesNotMatch(
    validator,
    /resolveAthenaRightsIr|BILLING_RIGHT_DEFINITIONS/,
  );
});

test("memory snapshots round-trip organization template roles for the active organization", async () => {
  const store = new MemoryAuthorizationStore();
  const member = {
    created_at: "2026-01-01T00:00:00.000Z",
    id: "member-1",
    organization_id: "org-1",
    role: "owner",
    user_id: "user-1",
  };
  await store.assignMemberRole(
    member.id,
    "organization_owner",
    undefined,
    "org-1",
    member.user_id,
  );
  const snapshot = await store.readSnapshot({
    activeOrganizationId: "org-1",
    foundingOwnerUserId: null,
    getMember: async () => member,
    listMembers: async () => [member],
    userId: "user-1",
  });

  const owner = snapshot.assignableRoles.find(
    (entry) => entry.key === "organization_owner",
  );

  assert.equal(owner?.scopeKind, "organization");
  assert.equal(owner?.organizationId, "org-1");
  assert.equal(
    parseAuthorizationSnapshot(snapshot).assignableRoles.find(
      (entry) => entry.key === "organization_owner",
    )?.organizationId,
    "org-1",
  );
});
