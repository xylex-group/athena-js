import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { projectOidcClaims } from "../../src/auth/authorization-server/oidc-claims.ts";
import type { AuthUserRow } from "../../src/auth/local/models.ts";

const user: AuthUserRow = {
  ban_expires: null,
  ban_reason: null,
  banned: false,
  created_at: new Date("2026-01-01T00:00:00Z"),
  display_username: "oauth-user",
  email: "oauth@example.com",
  email_verified: true,
  id: "user-1",
  image: "https://cdn.example/avatar.png",
  last_sign_in_at: null,
  metadata: {},
  name: "OAuth User",
  role: null,
  two_factor_enabled: false,
  updated_at: new Date("2026-01-01T00:00:00Z"),
  username: "oauth-user",
};

test("OIDC identity claims are released only by granted identity scopes", () => {
  assert.deepEqual(
    projectOidcClaims({
      identityScopes: ["openid"],
      user,
    }),
    { sub: "user-1" }
  );
  assert.deepEqual(
    projectOidcClaims({
      identityScopes: ["openid", "email"],
      user,
    }),
    {
      email: "oauth@example.com",
      email_verified: true,
      sub: "user-1",
    }
  );
  assert.deepEqual(
    projectOidcClaims({
      identityScopes: ["openid", "profile"],
      user,
    }),
    {
      name: "OAuth User",
      picture: "https://cdn.example/avatar.png",
      preferred_username: "oauth-user",
      sub: "user-1",
    }
  );
});
