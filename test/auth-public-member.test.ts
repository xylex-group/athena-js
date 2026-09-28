import assert from "node:assert/strict";
import test from "node:test";
import type { AuthMemberRow, AuthUserRow } from "../src/auth/local/models.ts";
import { toPublicMembersWithUsers } from "../src/auth/local/models.ts";

function userRow(id: string, email: string): AuthUserRow {
  return {
    ban_expires: null,
    ban_reason: null,
    banned: false,
    created_at: "2026-01-01T00:00:00.000Z",
    display_username: null,
    email,
    email_verified: true,
    id,
    image: null,
    last_sign_in_at: null,
    metadata: {},
    name: "Ada",
    role: null,
    two_factor_enabled: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    username: null,
  };
}

test("public members include email for snake_case and camelCase member rows", async () => {
  const snake: AuthMemberRow = {
    created_at: "2026-01-01T00:00:00.000Z",
    id: "member-snake",
    organization_id: "org-1",
    role: "owner",
    user_id: "user-snake",
  };
  const camel = {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "member-camel",
    organizationId: "org-1",
    role: "member",
    userId: "user-camel",
  } as unknown as AuthMemberRow;

  const listed = await toPublicMembersWithUsers([snake, camel], async (id) =>
    userRow(id, `${id}@example.com`)
  );

  assert.equal(listed[0]?.email, "user-snake@example.com");
  assert.equal(listed[0]?.user?.email, "user-snake@example.com");
  assert.equal(listed[1]?.email, "user-camel@example.com");
  assert.equal(listed[1]?.user?.email, "user-camel@example.com");
  assert.equal(listed[1]?.userId, "user-camel");
  assert.equal(listed[1]?.organizationId, "org-1");
});
