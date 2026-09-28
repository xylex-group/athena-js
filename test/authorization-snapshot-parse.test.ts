import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ATHENA_AUTHORIZATION_SNAPSHOT_INVALID,
  AuthorizationSnapshotInvalidError,
  parseAuthorizationSnapshot,
} from "../src/runtime/authorization/parse-snapshot.ts";

const valid = {
  assignableRoles: [
    {
      assignable: true,
      assignmentCount: 1,
      displayName: "Platform administrator",
      id: "platform_admin",
      key: "platform_admin",
      organizationId: null,
      protected: true,
      rightCount: 33,
      scopeKind: "platform" as const,
      systemKind: "admin" as const,
      version: 1,
    },
  ],
  capabilities: {
    canChangeMemberRole: true,
    canDeleteOrganization: false,
    canInviteMembers: true,
    canManageOrganizationRoles: true,
    canManagePlatformRoles: true,
    canRemoveMember: true,
  },
  effectiveRights: [
    "authorization.platform.read",
    "authorization.platform.write",
  ],
  revision: 3,
  roles: [
    {
      displayName: "Platform administrator",
      key: "platform_admin",
      scopeKind: "platform" as const,
    },
  ],
};

function expectInvalid(value: unknown): void {
  assert.throws(
    () => parseAuthorizationSnapshot(value),
    (error: unknown) =>
      error instanceof AuthorizationSnapshotInvalidError &&
      error.code === ATHENA_AUTHORIZATION_SNAPSHOT_INVALID
  );
}

test("parseAuthorizationSnapshot accepts a complete platform-admin snapshot", () => {
  const snapshot = parseAuthorizationSnapshot(valid);
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.assignableRoles[0]?.id, "platform_admin");
  assert.equal(snapshot.capabilities.canManagePlatformRoles, true);
});

test("parseAuthorizationSnapshot rejects a capabilities-only payload", () => {
  expectInvalid({ capabilities: { canManagePlatformRoles: true } });
});

test("parseAuthorizationSnapshot rejects assignable roles that omit id", () => {
  expectInvalid({
    ...valid,
    assignableRoles: [
      {
        assignmentCount: 1,
        displayName: "Platform administrator",
        key: "platform_admin",
        protected: true,
        rightCount: 33,
        scopeKind: "platform",
      },
    ],
  });
});

test("parseAuthorizationSnapshot rejects a missing revision", () => {
  const { revision: _revision, ...withoutRevision } = valid;
  expectInvalid(withoutRevision);
});

test("parseAuthorizationSnapshot rejects a malformed right", () => {
  expectInvalid({
    ...valid,
    capabilities: {
      ...valid.capabilities,
      canManagePlatformRoles: false,
    },
    effectiveRights: ["not a right"],
  });
});

test("parseAuthorizationSnapshot rejects a stale capability projection", () => {
  expectInvalid({
    ...valid,
    effectiveRights: ["authorization.platform.read"],
  });
});

test("parseAuthorizationSnapshot rejects non-integer role version and counts", () => {
  for (const patch of [
    { version: Number.NaN },
    { version: 1.5 },
    { version: 0 },
    { assignmentCount: -1 },
    { rightCount: Number.NaN },
  ]) {
    expectInvalid({
      ...valid,
      assignableRoles: [{ ...valid.assignableRoles[0], ...patch }],
    });
  }
});

test("parseAuthorizationSnapshot rejects an empty active organization id", () => {
  expectInvalid({
    ...valid,
    activeOrganizationId: "",
  });
});

test("parseAuthorizationSnapshot is exported from the browser entry", async () => {
  const browser = await import("../src/browser.ts");
  assert.equal(typeof browser.parseAuthorizationSnapshot, "function");
  assert.equal(typeof browser.capabilitiesFromRights, "function");
});

test("capability projection stays off the authorization catalog module", () => {
  const capabilities = readFileSync(
    new URL("../src/runtime/authorization/capabilities.ts", import.meta.url),
    "utf8"
  );
  const parseSnapshot = readFileSync(
    new URL("../src/runtime/authorization/parse-snapshot.ts", import.meta.url),
    "utf8"
  );
  assert.equal(capabilities.includes("./catalog.ts"), false);
  assert.equal(parseSnapshot.includes("./catalog.ts"), false);
  assert.equal(parseSnapshot.includes("./postgres.ts"), false);
  assert.equal(parseSnapshot.includes("./memory.ts"), false);
});
