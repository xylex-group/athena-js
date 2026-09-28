import assert from "node:assert/strict";
import { test } from "node:test";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import type {
  AuthMemberRow,
  AuthOrganizationRow,
} from "../src/auth/local/models.ts";
import {
  assertFoundingOwnerMutationAllowed,
  assertLastOwnerMutationAllowed,
  assertMemberRoleAssignmentAllowed,
  FOUNDING_OWNER_LEAVE_FORBIDDEN,
  FOUNDING_OWNER_REMOVE_FORBIDDEN,
  FOUNDING_OWNER_ROLE_LOCKED,
  GRANT_HIGHER_ROLE_FORBIDDEN,
  GRANT_OWNER_FORBIDDEN,
  LAST_OWNER_LEAVE_FORBIDDEN,
  normalizeSessionActiveOrganization,
  resolveFoundingOwnerUserId,
  SELF_ELEVATION_FORBIDDEN,
} from "../src/auth/local/organization-invariants.ts";

function member(input: {
  createdAt: string;
  id: string;
  role: string;
  userId: string;
}): AuthMemberRow {
  return {
    created_at: input.createdAt,
    id: input.id,
    organization_id: "org-1",
    role: input.role,
    user_id: input.userId,
  };
}

const founderOrg: AuthOrganizationRow = {
  created_at: "2026-01-01T00:00:00.000Z",
  created_by_user_id: "founder",
  id: "org-1",
  logo: null,
  metadata: "{}",
  name: "Acme",
  slug: "acme",
  updated_at: "2026-01-01T00:00:00.000Z",
};

test("resolveFoundingOwnerUserId prefers organization.created_by_user_id", () => {
  const members = [
    member({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m-early-owner",
      role: "owner",
      userId: "delegated-early",
    }),
    member({
      createdAt: "2026-02-01T00:00:00.000Z",
      id: "m-founder",
      role: "owner",
      userId: "founder",
    }),
  ];
  assert.equal(resolveFoundingOwnerUserId(founderOrg, members), "founder");
});

test("resolveFoundingOwnerUserId falls back to earliest owner membership", () => {
  const members = [
    member({
      createdAt: "2026-02-01T00:00:00.000Z",
      id: "m-b",
      role: "owner",
      userId: "later",
    }),
    member({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m-a",
      role: "owner",
      userId: "earliest",
    }),
  ];
  assert.equal(
    resolveFoundingOwnerUserId(
      { ...founderOrg, created_by_user_id: null },
      members
    ),
    "earliest"
  );
});

test("assertFoundingOwnerMutationAllowed blocks remove, leave, and role downgrade", () => {
  const members = [
    member({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m-founder",
      role: "owner",
      userId: "founder",
    }),
  ];
  assert.throws(
    () =>
      assertFoundingOwnerMutationAllowed({
        kind: "remove",
        members,
        organization: founderOrg,
        targetUserId: "founder",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.publicMessage === FOUNDING_OWNER_REMOVE_FORBIDDEN
  );
  assert.throws(
    () =>
      assertFoundingOwnerMutationAllowed({
        kind: "leave",
        members,
        organization: founderOrg,
        targetUserId: "founder",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.publicMessage === FOUNDING_OWNER_LEAVE_FORBIDDEN
  );
  assert.throws(
    () =>
      assertFoundingOwnerMutationAllowed({
        kind: "role",
        members,
        nextRole: "admin",
        organization: founderOrg,
        targetUserId: "founder",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.publicMessage === FOUNDING_OWNER_ROLE_LOCKED
  );
  assert.doesNotThrow(() =>
    assertFoundingOwnerMutationAllowed({
      kind: "role",
      members,
      nextRole: "owner",
      organization: founderOrg,
      targetUserId: "founder",
    })
  );
  assert.doesNotThrow(() =>
    assertFoundingOwnerMutationAllowed({
      kind: "remove",
      members,
      organization: founderOrg,
      targetUserId: "other",
    })
  );
});

test("assertLastOwnerMutationAllowed blocks the sole owner from leaving", () => {
  const members = [
    member({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m-owner",
      role: "owner",
      userId: "owner-1",
    }),
    member({
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "m-member",
      role: "member",
      userId: "member-1",
    }),
  ];
  assert.throws(
    () =>
      assertLastOwnerMutationAllowed({
        kind: "leave",
        members,
        targetUserId: "owner-1",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.publicMessage === LAST_OWNER_LEAVE_FORBIDDEN
  );
  assert.doesNotThrow(() =>
    assertLastOwnerMutationAllowed({
      kind: "leave",
      members,
      targetUserId: "member-1",
    })
  );
});

test("assertMemberRoleAssignmentAllowed blocks self-elevation and owner grants", () => {
  assert.throws(
    () =>
      assertMemberRoleAssignmentAllowed({
        actorCanAssignOwner: false,
        actorRole: "admin",
        actorUserId: "admin-1",
        nextRole: "owner",
        targetRole: "admin",
        targetUserId: "admin-1",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.publicMessage === SELF_ELEVATION_FORBIDDEN
  );
  assert.throws(
    () =>
      assertMemberRoleAssignmentAllowed({
        actorCanAssignOwner: false,
        actorRole: "admin",
        actorUserId: "admin-1",
        nextRole: "owner",
        targetRole: "member",
        targetUserId: "other",
      }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      (error.publicMessage === GRANT_HIGHER_ROLE_FORBIDDEN ||
        error.publicMessage === GRANT_OWNER_FORBIDDEN)
  );
  assert.doesNotThrow(() =>
    assertMemberRoleAssignmentAllowed({
      actorCanAssignOwner: true,
      actorRole: "owner",
      actorUserId: "owner-1",
      nextRole: "admin",
      targetRole: "member",
      targetUserId: "other",
    })
  );
});

test("normalizeSessionActiveOrganization clears a stale org pointer", async () => {
  const stores = new MemoryAuthStores();
  const expiresAt = new Date(Date.now() + 60_000);
  const session = await stores.createSession({
    activeOrganizationId: "org-1",
    expiresAt,
    id: "s1",
    token: "token-1",
    userId: "user-1",
  });
  const healed = await normalizeSessionActiveOrganization(session, stores);
  assert.equal(healed.active_organization_id, null);
  const stored = await stores.getSessionByToken("token-1");
  assert.equal(stored?.active_organization_id, null);
});
