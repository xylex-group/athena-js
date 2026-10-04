import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { fingerprintAthenaRightsIr } from "../src/rights/ir/fingerprint.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";
import { ATHENA_BUILTIN_ROLE_DEFINITIONS } from "../src/roles/builtin.ts";
import { parseAthenaRoleId } from "../src/roles/id.ts";
import { parseAthenaRoleKey } from "../src/roles/key.ts";
import { getAthenaAuthorizationRightsIr } from "../src/runtime/authorization/catalog.ts";
import { authorizationRolesFingerprint } from "../src/runtime/authorization/catalog-state.ts";
import { canonicalGrantId } from "../src/runtime/authorization/grant-identity.ts";
import {
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND,
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION,
  canonicalizeAthenaAuthorizationSnapshotIr,
  fingerprintAthenaAuthorizationSnapshotIr,
  projectAthenaAccessGrantsFromAuthorizationSnapshot,
  validateAthenaAuthorizationSnapshotIr,
} from "../src/runtime/authorization/snapshot-ir/index.ts";
import type { AthenaAuthorizationSnapshotIr } from "../src/runtime/authorization/snapshot-ir/types.ts";

function snapshot(): AthenaAuthorizationSnapshotIr {
  const rights = getAthenaAuthorizationRightsIr();
  const platformRights = rights.rights
    .filter((item) => item.scopeKind === "platform" && item.assignable)
    .slice(0, 2);
  assert.equal(platformRights.length, 2);
  const roleId = parseAthenaRoleId("platform_admin");
  const scope = { kind: "platform" as const };
  const subject = { kind: "user" as const, userId: "user_1" };
  return {
    assignments: [
      {
        id: "grant:platform:user:user_1:platform_admin",
        provenance: {
          assignedAt: "2026-10-04T10:00:00+02:00",
          assignedBy: null,
        },
        roleId,
        subject,
      },
    ],
    irVersion: ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION,
    kind: ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND,
    metadata: {
      assignmentRevision: 1,
      capturedAt: "2026-10-04T08:00:00Z",
      catalogVersion: 5,
      provenance: ["authorization-store"],
      rightsFingerprint: fingerprintAthenaRightsIr(rights),
      rolesFingerprint: authorizationRolesFingerprint(),
    },
    rights,
    roles: {
      irVersion: 1,
      kind: "athena.roles" as const,
      metadata: {},
      roles: [
        {
          assignable: true,
          displayName: "Platform administrator",
          id: roleId,
          key: parseAthenaRoleKey("platform_admin"),
          protected: false,
          rights: platformRights.map((right) => parseAthenaRightKey(right.key)),
          scope,
          systemKind: null,
        },
      ],
    },
    scope,
  };
}

function reverseObjectKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeyOrder);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeyOrder(entry)])
    );
  }
  return value;
}

function organizationSnapshot() {
  const value = snapshot();
  const role = ATHENA_BUILTIN_ROLE_DEFINITIONS.find(
    (item) => item.id === "organization_admin"
  );
  assert.ok(role);
  const organizationId = "org_1";
  const subject = {
    kind: "member" as const,
    memberId: "member_1",
    userId: "user_1",
  };
  return {
    ...value,
    assignments: [
      {
        id: canonicalGrantId({
          organizationId,
          roleId: role.id,
          scopeKind: "organization",
          subjectId: subject.memberId,
          subjectKind: subject.kind,
        }),
        provenance: { assignedAt: "2026-10-04T08:00:00Z", assignedBy: null },
        roleId: role.id,
        subject,
      },
    ],
    roles: { ...value.roles, roles: [role] },
    scope: { kind: "organization" as const, organizationId },
  };
}

test("authorization snapshot IR validates the exact document shape and canonical grant identity", () => {
  const value = snapshot();
  assert.equal(
    validateAthenaAuthorizationSnapshotIr(value).assignments.length,
    1
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({ ...value, extra: true })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [{ ...value.assignments[0], id: "grant:wrong" }],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({ ...value, kind: "wrong" })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({ ...value, irVersion: 2 })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          subject: { ...value.assignments[0].subject, memberId: "member_1" },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [value.assignments[0], value.assignments[0]],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          provenance: {
            ...value.assignments[0].provenance,
            sourceId: "connection_1",
          },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [{ ...value.assignments[0], unexpected: true }],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          provenance: {
            ...value.assignments[0].provenance,
            sourceId: undefined,
            sourceKind: undefined,
          },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      metadata: { ...value.metadata, provenance: undefined },
    })
  );
});

test("authorization snapshot canonicalization normalizes ordering and timestamps without mutation", () => {
  const value = snapshot();
  const canonical = canonicalizeAthenaAuthorizationSnapshotIr(value);
  assert.equal(
    canonical.assignments[0].provenance.assignedAt,
    "2026-10-04T08:00:00.000Z"
  );
  assert.deepEqual(
    canonicalizeAthenaAuthorizationSnapshotIr(canonical),
    canonical
  );
  assert.equal(
    value.assignments[0].provenance.assignedAt,
    "2026-10-04T10:00:00+02:00"
  );
});

test("authorization snapshot preserves omitted optional metadata provenance", () => {
  const value = snapshot();
  const canonical = canonicalizeAthenaAuthorizationSnapshotIr({
    ...value,
    metadata: {
      assignmentRevision: value.metadata.assignmentRevision,
      capturedAt: value.metadata.capturedAt,
      catalogVersion: value.metadata.catalogVersion,
      rightsFingerprint: value.metadata.rightsFingerprint,
      rolesFingerprint: value.metadata.rolesFingerprint,
    },
  });
  assert.equal(Object.hasOwn(canonical.metadata, "provenance"), false);
});

test("authorization snapshot fingerprint excludes capture metadata but includes authority semantics", () => {
  const value = snapshot();
  const fingerprint = fingerprintAthenaAuthorizationSnapshotIr(value);
  assert.equal(
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      metadata: {
        ...value.metadata,
        assignmentRevision: 99,
        capturedAt: "2027-01-01T00:00:00Z",
      },
    }),
    fingerprint
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          provenance: {
            ...value.assignments[0].provenance,
            assignedBy: "user_2",
          },
        },
      ],
    }),
    fingerprint
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      roles: {
        ...value.roles,
        roles: [{ ...value.roles.roles[0], displayName: "Renamed role" }],
      },
    }),
    fingerprint
  );
});

test("authorization snapshot validates historical roles against embedded Rights IR", () => {
  const value = snapshot();
  const historicalRole = {
    ...value.roles.roles[0],
    rights: [parseAthenaRightKey("data.records.read")],
  };
  const rights = {
    irVersion: 1 as const,
    kind: "athena.rights" as const,
    metadata: {},
    rights: [
      {
        assignable: true,
        description: "Read records",
        displayName: "Read records",
        domain: "data",
        key: parseAthenaRightKey("data.records.read"),
        riskLevel: "low" as const,
        scopeKind: "self" as const,
      },
    ],
  };
  const historical = {
    ...value,
    metadata: {
      ...value.metadata,
      rightsFingerprint: fingerprintAthenaRightsIr(rights),
    },
    rights,
    roles: { ...value.roles, roles: [historicalRole] },
  };
  assert.doesNotThrow(() => {
    validateAthenaAuthorizationSnapshotIr(historical);
  });
});

test("authorization snapshot rejects scope, role-reference, and provenance mismatches", () => {
  const value = snapshot();
  const organization = organizationSnapshot();
  const assignment = value.assignments[0];
  assert.ok(assignment);
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...assignment,
          subject: { kind: "member", memberId: "member_1", userId: "user_1" },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...organization,
      assignments: [
        {
          ...organization.assignments[0],
          subject: { kind: "user", userId: "user_1" },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        { ...assignment, roleId: parseAthenaRoleId("missing_role") },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      roles: {
        ...value.roles,
        roles: [{ ...value.roles.roles[0], assignable: false }],
      },
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...organization,
      roles: {
        ...organization.roles,
        roles: [
          {
            ...organization.roles.roles[0],
            scope: { kind: "organization", organizationId: "org_other" },
            systemKind: null,
          },
        ],
      },
    })
  );
  const platformRole = value.roles.roles[0];
  assert.ok(platformRole);
  const organizationId = "org_1";
  const memberSubject = {
    kind: "member" as const,
    memberId: "member_1",
    userId: "user_1",
  };
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...organization,
      assignments: [
        {
          ...organization.assignments[0],
          id: canonicalGrantId({
            organizationId,
            roleId: platformRole.id,
            scopeKind: "organization",
            subjectId: memberSubject.memberId,
            subjectKind: memberSubject.kind,
          }),
          roleId: platformRole.id,
        },
      ],
      roles: { ...organization.roles, roles: [platformRole] },
    })
  );
  const organizationRole = organization.roles.roles[0];
  assert.ok(organizationRole);
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          id: canonicalGrantId({
            organizationId: null,
            roleId: organizationRole.id,
            scopeKind: "platform",
            subjectId: "user_1",
            subjectKind: "user",
          }),
          roleId: organizationRole.id,
        },
      ],
      roles: { ...value.roles, roles: [organizationRole] },
    })
  );
  for (const provenance of [
    { assignedAt: "yesterday", assignedBy: null },
    { assignedAt: "2026-10-04T08:00:00Z", assignedBy: null, sourceId: "id" },
    {
      assignedAt: "2026-10-04T08:00:00Z",
      assignedBy: null,
      sourceKind: "identity_connection",
    },
    {
      assignedAt: "2026-10-04T08:00:00Z",
      assignedBy: null,
      sourceId: "id",
      sourceKind: "other",
    },
    {
      assignedAt: "2026-10-04T08:00:00Z",
      assignedBy: null,
      sourceId: "id",
      sourceKind: "identity_connection",
    },
  ]) {
    assert.throws(() =>
      validateAthenaAuthorizationSnapshotIr({
        ...value,
        assignments: [{ ...assignment, provenance }],
      })
    );
  }
  assert.doesNotThrow(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...organization,
      assignments: [
        {
          ...organization.assignments[0],
          provenance: {
            assignedAt: "2026-10-04T08:00:00Z",
            assignedBy: null,
            sourceId: "connection_1",
            sourceKind: "identity_connection",
          },
        },
      ],
    })
  );
  assert.throws(() =>
    validateAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...assignment,
          provenance: {
            assignedAt: "2026-10-04T08:00:00Z",
            assignedBy: null,
            sourceId: "connection_1",
            sourceKind: "identity_connection",
          },
        },
      ],
    })
  );
});

test("authorization snapshot canonicalization and fingerprint follow semantic content", () => {
  const value = snapshot();
  const secondAssignment = {
    ...value.assignments[0],
    id: "grant:platform:user:user_2:platform_admin",
    subject: { kind: "user" as const, userId: "user_2" },
  };
  const withTwoAssignments = {
    ...value,
    assignments: [...value.assignments, secondAssignment],
    metadata: { ...value.metadata, provenance: ["a-source", "z-source"] },
  };
  const reversedRights = {
    ...value,
    metadata: { ...value.metadata, provenance: ["z-source", "a-source"] },
    rights: { ...value.rights, rights: [...value.rights.rights].reverse() },
    roles: {
      ...value.roles,
      roles: [
        {
          ...value.roles.roles[0],
          rights: [...value.roles.roles[0].rights].reverse(),
        },
      ],
    },
  };
  const canonical =
    canonicalizeAthenaAuthorizationSnapshotIr(withTwoAssignments);
  assert.deepEqual(
    canonicalizeAthenaAuthorizationSnapshotIr({
      ...withTwoAssignments,
      assignments: [...withTwoAssignments.assignments].reverse(),
      metadata: {
        ...withTwoAssignments.metadata,
        provenance: ["z-source", "a-source"],
      },
    }),
    canonical
  );
  assert.equal(
    fingerprintAthenaAuthorizationSnapshotIr(withTwoAssignments),
    fingerprintAthenaAuthorizationSnapshotIr({
      ...withTwoAssignments,
      assignments: [...withTwoAssignments.assignments].reverse(),
    })
  );
  const alternateRole = ATHENA_BUILTIN_ROLE_DEFINITIONS.find(
    (role) => role.id === "platform_customer"
  );
  assert.ok(alternateRole);
  const multipleRoles = {
    ...value,
    roles: {
      ...value.roles,
      roles: [...value.roles.roles, alternateRole],
    },
  };
  const canonicalRoles =
    canonicalizeAthenaAuthorizationSnapshotIr(multipleRoles);
  assert.deepEqual(
    canonicalizeAthenaAuthorizationSnapshotIr({
      ...multipleRoles,
      roles: {
        ...multipleRoles.roles,
        roles: [...multipleRoles.roles.roles].reverse(),
      },
    }),
    canonicalRoles
  );
  assert.deepEqual(
    canonicalizeAthenaAuthorizationSnapshotIr(
      JSON.parse(JSON.stringify(canonical))
    ),
    canonical
  );
  const metadataVariant = {
    ...value,
    metadata: {
      assignmentRevision: 2,
      capturedAt: "2027-01-01T00:00:00Z",
      catalogVersion: 6,
      provenance: ["other-source"],
      rightsFingerprint: value.metadata.rightsFingerprint,
      rolesFingerprint: "b".repeat(64),
    },
  };
  assert.equal(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr(metadataVariant)
  );
  assert.equal(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr(reverseObjectKeyOrder(value))
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr(organizationSnapshot())
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [],
    })
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr(withTwoAssignments)
  );
  const updatedRights = {
    ...value.rights,
    rights: value.rights.rights.map((right, index) =>
      index === 0 ? { ...right, description: "Updated meaning" } : right
    ),
  };
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      metadata: {
        ...value.metadata,
        rightsFingerprint: fingerprintAthenaRightsIr(updatedRights),
      },
      rights: updatedRights,
    })
  );
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(value),
    fingerprintAthenaAuthorizationSnapshotIr({
      ...value,
      assignments: [
        {
          ...value.assignments[0],
          provenance: {
            ...value.assignments[0].provenance,
            assignedAt: "2026-10-05T08:00:00Z",
          },
        },
      ],
    })
  );
  const organization = organizationSnapshot();
  assert.notEqual(
    fingerprintAthenaAuthorizationSnapshotIr(organization),
    fingerprintAthenaAuthorizationSnapshotIr({
      ...organization,
      assignments: [
        {
          ...organization.assignments[0],
          provenance: {
            ...organization.assignments[0].provenance,
            sourceId: "connection_1",
            sourceKind: "identity_connection",
          },
        },
      ],
    })
  );
  assert.deepEqual(
    canonicalizeAthenaAuthorizationSnapshotIr(reversedRights).rights,
    canonicalizeAthenaAuthorizationSnapshotIr(value).rights
  );
});

test("access grant projection uses the snapshot historical authority", () => {
  const current = snapshot();
  const changedRight = current.rights.rights.find(
    (right) =>
      right.scopeKind === "platform" &&
      right.assignable &&
      right.riskLevel !== "low"
  );
  assert.ok(changedRight);
  const historicalRights = {
    ...current.rights,
    rights: current.rights.rights.map((right) =>
      right.key === changedRight.key
        ? { ...right, riskLevel: "low" as const }
        : right
    ),
  };
  const historical = {
    ...current,
    metadata: {
      ...current.metadata,
      catalogVersion: 4,
      rightsFingerprint: fingerprintAthenaRightsIr(historicalRights),
      rolesFingerprint: "a".repeat(64),
    },
    rights: historicalRights,
    roles: {
      ...current.roles,
      roles: [
        {
          ...current.roles.roles[0],
          rights: [parseAthenaRightKey(changedRight.key)],
        },
      ],
    },
  };
  const grant =
    projectAthenaAccessGrantsFromAuthorizationSnapshot(historical)[0];
  assert.ok(grant);
  assert.equal(grant.authorityVersion.catalogVersion, 4);
  assert.equal(
    grant.authorityVersion.rightsFingerprint,
    fingerprintAthenaRightsIr(historicalRights)
  );
  assert.equal(grant.riskLevel, "low");
  assert.notEqual(changedRight.riskLevel, grant.riskLevel);
  assert.equal(
    grant.authorityVersion.rolesFingerprint,
    bytesToHex(
      sha256(
        utf8ToBytes(
          JSON.stringify({
            catalogFingerprint: historical.metadata.rolesFingerprint,
            roles: [
              {
                organizationId: null,
                rightKeys: [parseAthenaRightKey(changedRight.key)],
                roleId: historical.roles.roles[0]?.id,
                roleKey: historical.roles.roles[0]?.key,
                scopeKind: "platform",
              },
            ],
          })
        )
      )
    )
  );
});

test("access grant projection derives role rights and snapshot revision", () => {
  const value = snapshot();
  const grants = projectAthenaAccessGrantsFromAuthorizationSnapshot(value);
  assert.equal(grants.length, 1);
  const grant = grants[0];
  assert.ok(grant);
  assert.deepEqual(grant.rights, value.roles.roles[0]?.rights);
  assert.equal(
    grant.authorityVersion.assignmentRevision,
    value.metadata.assignmentRevision
  );
  assert.equal(
    grant.authorityVersion.catalogVersion,
    value.metadata.catalogVersion
  );
  assert.deepEqual(grant.authorityVersion, {
    assignmentRevision: value.metadata.assignmentRevision,
    catalogVersion: value.metadata.catalogVersion,
    rightsFingerprint: fingerprintAthenaRightsIr(value.rights),
    rolesFingerprint: bytesToHex(
      sha256(
        utf8ToBytes(
          JSON.stringify({
            catalogFingerprint: value.metadata.rolesFingerprint,
            roles: [
              {
                organizationId: null,
                rightKeys: [...(value.roles.roles[0]?.rights ?? [])].sort(),
                roleId: value.roles.roles[0]?.id,
                roleKey: value.roles.roles[0]?.key,
                scopeKind: "platform",
              },
            ],
          })
        )
      )
    ),
  });
  assert.equal(grant.id, value.assignments[0]?.id);
  assert.equal(grant.role.id, value.assignments[0]?.roleId);
  assert.equal(grant.role.key, value.roles.roles[0]?.key);
  assert.equal(grant.provenance.assignedAt, "2026-10-04T08:00:00.000Z");
  assert.equal(
    grant.provenance.assignedBy,
    value.assignments[0]?.provenance.assignedBy
  );
  assert.equal(grant.organizationId, null);
  assert.deepEqual(grant.subject, {
    kind: "user",
    userId: "user_1",
  });
  const riskRank: Record<typeof grant.riskLevel, number> = {
    critical: 2,
    elevated: 1,
    low: 0,
  };
  const expectedRisk = grant.rights.reduce<typeof grant.riskLevel>(
    (highest, key) => {
      const risk = value.rights.rights.find(
        (right) => right.key === key
      )?.riskLevel;
      return risk && riskRank[risk] > riskRank[highest] ? risk : highest;
    },
    "low"
  );
  assert.equal(grant.riskLevel, expectedRisk);
  assert.ok(Object.isFrozen(grants));
  assert.ok(Object.isFrozen(grant));

  const organization = organizationSnapshot();
  const organizationWithConnectionProvenance = {
    ...organization,
    assignments: organization.assignments.map((assignment) => ({
      ...assignment,
      provenance: {
        ...assignment.provenance,
        sourceId: "connection_1",
        sourceKind: "identity_connection" as const,
      },
    })),
  };
  const organizationGrant = projectAthenaAccessGrantsFromAuthorizationSnapshot(
    organizationWithConnectionProvenance
  )[0];
  assert.ok(organizationGrant);
  assert.deepEqual(organizationGrant.subject, {
    kind: "member",
    memberId: "member_1",
    userId: "user_1",
  });
  assert.equal(organizationGrant.organizationId, "org_1");
  assert.deepEqual(organizationGrant.provenance, {
    assignedAt: "2026-10-04T08:00:00.000Z",
    assignedBy: null,
    sourceId: "connection_1",
    sourceKind: "identity_connection",
  });
});
