import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";
import { PostgresAuthorizationStore } from "../../src/runtime/authorization/postgres.ts";
import { createAccessGrantAuthorityVersion } from "../../src/runtime/authorization/access-grants.ts";
import {
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
  AUTHORIZATION_CATALOG_VERSION,
} from "../../src/runtime/authorization/catalog-state.ts";
import { canonicalGrantId } from "../../src/runtime/authorization/grant-identity.ts";
import {
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
} from "../../src/runtime/authorization/templates.ts";

interface AccessGrant {
  authorityVersion: {
    assignmentRevision: number;
    catalogVersion: number;
    rightsFingerprint: string;
    rolesFingerprint: string;
  };
  id: string;
  organizationId: string | null;
  provenance: {
    assignedAt: string;
    assignedBy: string | null;
    sourceId?: string;
    sourceKind?: string;
  };
  rights: readonly string[];
  riskLevel: "low" | "elevated" | "critical";
  role: { id: string; key: string };
  subject: { kind: "user" | "member"; memberId?: string; userId: string };
}

function listAccessGrants(
  store: unknown
): Promise<readonly AccessGrant[]> {
  return (store as { listAccessGrants(): Promise<readonly AccessGrant[]> })
    .listAccessGrants();
}

test("Memory access grant inventory is immutable and carries identity, provenance, risk, and authority version", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("user-1", PLATFORM_ADMIN_ROLE, "grantor-1");
  await store.assignMemberRole(
    "member-1",
    ORGANIZATION_OWNER_ROLE,
    "grantor-2",
    "org-1",
    "user-1",
    {
      sourceId: "connection-1",
      sourceKind: "identity_connection",
    }
  );

  const grants = await listAccessGrants(store);
  assert.equal(grants.length, 2);
  const platformGrant = grants.find((grant) => grant.subject.kind === "user");
  const organizationGrant = grants.find(
    (grant) => grant.subject.kind === "member"
  );
  assert.ok(platformGrant);
  assert.ok(organizationGrant);
  assert.equal(
    platformGrant.id,
    canonicalGrantId({
      organizationId: null,
      roleId: platformGrant.role.id,
      scopeKind: "platform",
      subjectId: "user-1",
      subjectKind: "user",
    })
  );
  assert.deepEqual(organizationGrant.subject, {
    kind: "member",
    memberId: "member-1",
    userId: "user-1",
  });
  assert.equal(organizationGrant.organizationId, "org-1");
  assert.deepEqual(organizationGrant.provenance, {
    assignedAt: organizationGrant.provenance.assignedAt,
    assignedBy: "grantor-2",
    sourceId: "connection-1",
    sourceKind: "identity_connection",
  });
  assert.equal(organizationGrant.riskLevel, "critical");
  assert.deepEqual(organizationGrant.authorityVersion, {
    assignmentRevision: 2,
    catalogVersion: AUTHORIZATION_CATALOG_VERSION,
    rightsFingerprint: authorizationRightsFingerprint(),
    rolesFingerprint: createAccessGrantAuthorityVersion({
      assignmentRevision: 2,
      roleAssignments: [
        {
          organizationId: "org-1",
          rightKeys: organizationGrant.rights,
          roleId: organizationGrant.role.id,
          roleKey: organizationGrant.role.key,
          scopeKind: "organization",
        },
      ],
    }).rolesFingerprint,
  });
  assert.equal(Object.isFrozen(grants), true);
  assert.equal(Object.isFrozen(organizationGrant), true);
  assert.equal(Object.isFrozen(organizationGrant.subject), true);
  assert.equal(Object.isFrozen(organizationGrant.provenance), true);
  assert.equal(Object.isFrozen(organizationGrant.rights), true);
  assert.throws(() => {
    (organizationGrant.rights as string[]).push("organization.members.read");
  });
});

test("Postgres access grant inventory projects assignment rows and complete versions", async () => {
  const timestamp = "2026-10-03T08:00:00.000Z";
  const rows = [
    {
      assigned_at: new Date(timestamp),
      assigned_by: "grantor-2",
      assignment_revision: "9",
      member_id: "member-pg",
      organization_id: "org-pg",
      role_id: "role-org",
      role_key: ORGANIZATION_OWNER_ROLE,
      right_key: "organization.members.read",
      scope_kind: "organization",
      source_id: "connection-pg",
      source_kind: "identity_connection",
      user_id: "user-pg",
    },
    {
      assigned_at: new Date(timestamp),
      assigned_by: "grantor-2",
      assignment_revision: "9",
      member_id: "member-pg",
      organization_id: "org-pg",
      role_id: "role-org",
      role_key: ORGANIZATION_OWNER_ROLE,
      right_key: "organization.owners.assign",
      scope_kind: "organization",
      source_id: "connection-pg",
      source_kind: "identity_connection",
      user_id: "user-pg",
    },
  ];
  let inventoryReads = 0;
  const database: AthenaAuthDatabase = {
    inTransaction: false,
    async query<T>(sql: string) {
      if (sql.includes("to_regclass")) {
        return { rowCount: 1, rows: [{ oid: "authorization_catalog_state" }] as T[] };
      }
      if (sql.includes("FROM athena.authorization_catalog_state")) {
        return {
          rowCount: 1,
          rows: [
            {
              catalog_version: AUTHORIZATION_CATALOG_VERSION,
              rights_fingerprint: authorizationRightsFingerprint(),
              roles_fingerprint: authorizationRolesFingerprint(),
            },
          ] as T[],
        };
      }
      inventoryReads += 1;
      return { rowCount: rows.length, rows: rows as T[] };
    },
    async transaction<T>(fn: (tx: AthenaAuthDatabase) => Promise<T>) {
      return fn(database);
    },
  };
  const grants = await listAccessGrants(new PostgresAuthorizationStore(database));

  assert.equal(inventoryReads, 1);
  assert.equal(grants.length, 1);
  assert.equal(grants[0]?.role.id, "role-org");
  assert.deepEqual(grants[0]?.rights, [
    "organization.members.read",
    "organization.owners.assign",
  ]);
  assert.equal(grants[0]?.riskLevel, "critical");
  assert.equal(grants[0]?.provenance.assignedAt, timestamp);
  assert.deepEqual(grants[0]?.authorityVersion, {
    assignmentRevision: 9,
    catalogVersion: AUTHORIZATION_CATALOG_VERSION,
    rightsFingerprint: authorizationRightsFingerprint(),
    rolesFingerprint: createAccessGrantAuthorityVersion({
      assignmentRevision: 9,
      roleAssignments: [
        {
          organizationId: "org-pg",
          rightKeys: [
            "organization.members.read",
            "organization.owners.assign",
          ],
          roleId: "role-org",
          roleKey: ORGANIZATION_OWNER_ROLE,
          scopeKind: "organization",
        },
      ],
    }).rolesFingerprint,
  });
});

test("access grant authority version changes when assigned role Rights change", () => {
  const base = {
    assignmentRevision: 7,
    roleAssignments: [
      {
        organizationId: "org-1",
        rightKeys: ["organization.members.read"],
        roleId: "custom-role-1",
        roleKey: "custom_reviewer",
        scopeKind: "organization" as const,
      },
    ],
  };
  const before = createAccessGrantAuthorityVersion(base);
  const after = createAccessGrantAuthorityVersion({
    ...base,
    roleAssignments: [
      {
        ...base.roleAssignments[0],
        rightKeys: ["organization.members.read", "organization.owners.assign"],
      },
    ],
  });
  assert.equal(before.assignmentRevision, after.assignmentRevision);
  assert.notEqual(before.rolesFingerprint, after.rolesFingerprint);
});
