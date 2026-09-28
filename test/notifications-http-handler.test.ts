import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { createAthenaNotificationsHandlers } from "../src/next/notifications-handlers.ts";
import { NOTIFICATION_CATALOG } from "../src/notifications/catalog.ts";
import { NOTIFICATION_OPERATIONS } from "../src/notifications/contract/operations.ts";
import { createNotificationsEmbeddedHttpRequest } from "../src/notifications/http-adapter.ts";
import { createRemoteNotificationsModule } from "../src/notifications/module.ts";
import { createClient } from "../src/v3-client.ts";
import { createSddMockR2 } from "./sdd/sdd-mocks.ts";

function discoveryDocument() {
  return {
    athena: true,
    capabilities: {
      auth: { available: false },
      delete: true,
      fetch: true,
      insert: true,
      models: "off" as const,
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      update: true,
    },
    endpoints: { data: "/api/athena" },
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
  };
}

function signedInHandlers(
  client: ReturnType<typeof createClient>,
  userId = "user-http"
) {
  return createAthenaNotificationsHandlers({
    auth: {
      mode: "custom",
      resolvePrincipal: () => ({
        authority: "custom-trusted",
        principal: {
          authenticated: true,
          grants: [],
          rights: [],
          userId,
        },
      }),
    },
    client,
    discoveryDocument: discoveryDocument(),
    security: { mode: "trusted" },
  });
}

test("embedded notifications handler setChannel is one operation", async () => {
  const client = createClient({
    notifications: { catalog: NOTIFICATION_CATALOG },
    storage: { prefix: "np-http/", r2: createSddMockR2() },
  });
  const handlers = signedInHandlers(client);
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/notifications", {
      body: JSON.stringify({
        operation: NOTIFICATION_OPERATIONS.preferencesSetChannel,
        payload: { channel: "email", enabled: false },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data?: { items?: Array<{ channel: string; enabled: boolean }> };
    ok?: boolean;
  };
  assert.equal(body.ok, true);
  assert.equal(
    (body.data?.items ?? [])
      .filter((item) => item.channel === "email")
      .every((item) => item.enabled === false),
    true
  );
});

test("embedded notifications handler applyMany is one operation", async () => {
  const client = createClient({
    notifications: { catalog: NOTIFICATION_CATALOG },
    storage: { prefix: "np-http-apply/", r2: createSddMockR2() },
  });
  const handlers = signedInHandlers(client);
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/notifications", {
      body: JSON.stringify({
        operation: NOTIFICATION_OPERATIONS.preferencesApplyMany,
        payload: {
          mutations: [
            {
              channel: "email",
              enabled: false,
              operation: "set",
              topic: "security.login",
            },
            {
              channel: "email",
              operation: "reset",
              topic: "security.session",
            },
          ],
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok?: boolean };
  assert.equal(body.ok, true);
});

test("browser remote module hits embedded Next notifications envelope", async () => {
  const root = createClient({
    notifications: { catalog: NOTIFICATION_CATALOG },
    storage: { prefix: "np-http-browser/", r2: createSddMockR2() },
  });
  const handlers = signedInHandlers(root, "user-browser");
  const browser = createRemoteNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    remoteDialect: "embedded-http",
    request: createNotificationsEmbeddedHttpRequest({
      fetch: async (_input, init) =>
        handlers.POST(
          new Request("http://localhost/api/athena/notifications", {
            body: init?.body,
            headers: init?.headers,
            method: "POST",
          })
        ),
    }),
  });
  const before = await browser.preferences.list();
  assert.equal(
    before.items.some(
      (item) => item.topic === "security.login" && item.channel === "email"
    ),
    true
  );
  await browser.preferences.update({
    channel: "email",
    enabled: false,
    topic: "security.login",
  });
  const afterUpdate = await browser.preferences.list();
  const loginEmail = afterUpdate.items.find(
    (item) => item.topic === "security.login" && item.channel === "email"
  );
  assert.equal(loginEmail?.enabled, false);

  await browser.preferences.setChannel({
    channel: "email",
    enabled: false,
  });
  const afterChannel = await browser.preferences.list();
  assert.equal(
    afterChannel.items
      .filter((item) => item.channel === "email")
      .every((item) => item.enabled === false),
    true
  );
});
