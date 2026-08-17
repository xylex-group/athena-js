import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { getServerSession } from "../../../src/next/get-server-session.ts";
import { createServerSessionResolver } from "../../../src/next/server-session-resolver.ts";
import { ATHENA_SESSION_DATA_HEADER } from "../../../src/utils/athena-auth-url.ts";
import {
  bindResolver,
  mapServerSession,
} from "./session-api.ts";

const sample = {
  session: { activeOrganizationId: "org_1", id: "s_1" },
  user: { email: "a@b.c", id: "u_1" },
};

test("speedrun consumer maps authenticated server session", async () => {
  const result = await getServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sample),
    },
  });
  const data = mapServerSession(result);
  assert.equal(data?.user.id, "u_1");
  assert.equal(data?.organization.activeId, "org_1");
});

test("speedrun consumer binds resolver surface", async () => {
  const resolver = createServerSessionResolver({
    client: {},
    request: "none",
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sample),
    },
  });
  const app = bindResolver(resolver);
  const required = await app.requireSession();
  assert.equal(required.user.id, "u_1");
});
