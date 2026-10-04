import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  type AthenaSessionData,
  toSessionData,
} from "../src/auth/session-data.ts";
import {
  AthenaUnauthenticatedError,
  isAbortError,
  toAthenaSessionError,
} from "../src/auth/session-errors.ts";
import { deriveSessionView } from "../src/auth/session-view.ts";
import type { AthenaAuthSessionResponse } from "../src/auth/types.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";

const platformRead = parseAthenaRightKey("authorization.platform.read");
const platformWrite = parseAthenaRightKey("authorization.platform.write");

const transport = {
  grants: [],
  rights: [],
  session: { activeOrganizationId: "org_raw", id: "s1" },
  user: { email: "a@b.c", id: "u1" },
};

const authorizedTransport = {
  authorization: {
    activeOrganizationId: "org_raw",
    assignableRoles: [],
    capabilities: {
      canChangeMemberRole: true,
      canDeleteOrganization: false,
      canInviteMembers: true,
      canManageOrganizationRoles: true,
      canManagePlatformRoles: true,
      canRemoveMember: true,
    },
    effectiveRights: [platformRead, platformWrite],
    revision: 1,
    roles: [
      {
        displayName: "Customer",
        key: "platform_customer",
        scopeKind: "platform" as const,
      },
      {
        displayName: "Organization owner",
        key: "organization_owner",
        scopeKind: "organization" as const,
      },
    ],
  },
  grants: ["legacy:session"],
  rights: [platformRead, platformWrite],
  session: { activeOrganizationId: "org_raw", id: "s1" },
  user: { email: "a@b.c", id: "u1" },
};

function assertAuthorizationSnapshotIsReadonly(
  authorization: NonNullable<AthenaSessionData["authorization"]>
) {
  // @ts-expect-error application session roles are readonly
  authorization.roles.push({
    displayName: "Other",
    key: "other",
    scopeKind: "platform",
  });
  // @ts-expect-error application session assignable roles are readonly
  authorization.assignableRoles.push({
    assignable: true,
    assignmentCount: 0,
    displayName: "Other",
    id: "role_other",
    key: "other",
    organizationId: null,
    protected: false,
    rightCount: 0,
    scopeKind: "organization",
    systemKind: null,
    version: 1,
  });
  const firstRole = authorization.roles[0];
  if (firstRole) {
    // @ts-expect-error role summaries in app snapshots are readonly
    firstRole.displayName = "Changed";
  }
  // @ts-expect-error application session capabilities are readonly
  authorization.capabilities.canRemoveMember = false;
}
void assertAuthorizationSnapshotIsReadonly;

test("toSessionData freezes snapshot and maps org ids", () => {
  const data = toSessionData(transport, { activeId: "org_fixed" });
  assert.equal(data.organization.activeId, "org_fixed");
  assert.equal(data.organization.rawActiveId, "org_raw");
  assert.throws(() => {
    (data as { user: { id: string } }).user = { email: "", id: "x" } as never;
  });
  assert.throws(() => {
    (data.user as { name?: string }).name = "mutated";
  });
});

test("toSessionData clears authorization when resolved organization changes scope", () => {
  const data = toSessionData(authorizedTransport, {
    activeId: "org_next",
  });

  assert.equal(data.organization.rawActiveId, "org_raw");
  assert.equal(data.organization.activeId, "org_next");
  assert.equal(data.authorization, undefined);
  assert.deepEqual(data.rights, []);
});

test("toSessionData defaults legacy rights and grants to empty arrays", () => {
  const { grants: _grants, rights: _rights, ...legacyTransport } = transport;
  const data = toSessionData(
    legacyTransport as unknown as AthenaAuthSessionResponse
  );
  assert.deepEqual(data.rights, []);
  assert.deepEqual(data.grants, []);
  assert.equal(data.authorization, undefined);
  assert.ok(Object.isFrozen(data.rights));
  assert.ok(Object.isFrozen(data.grants));
});

test("deriveSessionView browser path keeps active===raw", () => {
  const view = deriveSessionView(transport);
  assert.equal(view.isAuthenticated, true);
  assert.equal(view.organizationId, "org_raw");
  assert.equal(view.organization?.activeId, view.organization?.rawActiveId);
});

test("toAthenaSessionError maps kinds", () => {
  const err = toAthenaSessionError("unauthenticated");
  assert.ok(err instanceof AthenaUnauthenticatedError);
  assert.equal(err.code, "ATHENA_SESSION_UNAUTHENTICATED");
});

test("isAbortError detects AbortError name", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(new Error("x")), false);
});

test("isAbortError detects Chrome abort-without-reason strings", () => {
  assert.equal(
    isAbortError(
      "Network error while calling GET /get-session: signal is aborted without reason"
    ),
    true
  );
  assert.equal(
    isAbortError({
      message:
        "Network error while calling GET /get-session: signal is aborted without reason",
    }),
    true
  );
});

test("toSessionData freezes session fields", () => {
  const data = toSessionData(transport);
  assert.throws(() => {
    (
      data.session as { activeOrganizationId?: string | null }
    ).activeOrganizationId = "mutated";
  });
});

test("toSessionData preserves and freezes authorization state", () => {
  const mutableTransport = structuredClone(authorizedTransport);
  const data = toSessionData(mutableTransport);

  assert.deepEqual(
    data.authorization?.roles,
    authorizedTransport.authorization.roles
  );
  assert.deepEqual(
    data.authorization?.effectiveRights,
    authorizedTransport.authorization.effectiveRights
  );
  assert.deepEqual(data.rights, authorizedTransport.rights);
  assert.deepEqual(data.grants, authorizedTransport.grants);

  assert.throws(() => {
    Reflect.apply(Array.prototype.push, data.authorization?.roles, [
      { displayName: "Other", key: "other", scopeKind: "platform" },
    ]);
  });
  assert.throws(() => {
    Reflect.apply(Array.prototype.push, data.authorization?.assignableRoles, [
      {},
    ]);
  });
  assert.throws(() => {
    Reflect.apply(Array.prototype.push, data.authorization?.effectiveRights, [
      platformRead,
    ]);
  });
  assert.throws(() => {
    if (data.authorization) {
      Object.assign(data.authorization.capabilities, {
        canManagePlatformRoles: false,
      });
    }
  });
  assert.throws(() => {
    Reflect.apply(Array.prototype.push, data.rights, [platformRead]);
  });
  assert.throws(() => {
    Reflect.apply(Array.prototype.push, data.grants, ["changed"]);
  });

  mutableTransport.authorization.roles.push({
    displayName: "Mutated",
    key: "mutated",
    scopeKind: "platform",
  });
  mutableTransport.authorization.effectiveRights.push(platformRead);
  mutableTransport.rights.push(platformRead);
  mutableTransport.grants.push("mutated");

  assert.equal(data.authorization?.roles.length, 2);
  assert.equal(data.authorization?.effectiveRights.length, 2);
  assert.equal(data.rights.length, 2);
  assert.equal(data.grants.length, 1);
});

test("deriveSessionView keeps transport authorization in normalized data", () => {
  const view = deriveSessionView(authorizedTransport);
  assert.deepEqual(
    view.data?.authorization?.roles,
    authorizedTransport.authorization.roles.slice(0, 2)
  );
  assert.deepEqual(view.data?.rights, authorizedTransport.rights.slice(0, 2));
  assert.deepEqual(view.data?.grants, ["legacy:session"]);
});

test("toAthenaSessionError maps all kinds", () => {
  assert.equal(
    toAthenaSessionError("upstream").name,
    "AthenaAuthUpstreamError"
  );
  assert.equal(
    toAthenaSessionError("configuration").name,
    "AthenaAuthConfigurationError"
  );
  assert.equal(
    toAthenaSessionError("protocol").name,
    "AthenaAuthProtocolError"
  );
  assert.equal(
    toAthenaSessionError("no_organization").name,
    "AthenaSessionOrganizationError"
  );
});

test("isAbortError detects TimeoutError", () => {
  const t = new Error("timeout");
  t.name = "TimeoutError";
  assert.equal(isAbortError(t), true);
});
