import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { NOTIFICATION_CATALOG } from "../src/notifications/catalog.ts";
import { createMemoryNotificationPreferenceStore } from "../src/notifications/memory-store.ts";
import { createEmbeddedNotificationsModule } from "../src/notifications/module.ts";

test("setChannel writes the channel in one upsertMany call", async () => {
  const store = createMemoryNotificationPreferenceStore();
  let upsertManyCalls = 0;
  const wrapped = {
    applyMany: store.applyMany.bind(store),
    delete: store.delete.bind(store),
    deleteMany: store.deleteMany.bind(store),
    list: store.list.bind(store),
    upsert: store.upsert.bind(store),
    upsertMany: async (inputs: Parameters<typeof store.upsertMany>[0]) => {
      upsertManyCalls += 1;
      return store.upsertMany(inputs);
    },
  };
  const ns = createEmbeddedNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-bulk",
    preferenceStore: wrapped,
  });
  const listed = await ns.preferences.list();
  const emailCount = listed.items.filter(
    (item) => item.channel === "email"
  ).length;
  assert.equal(emailCount > 1, true);
  await ns.preferences.setChannel({ channel: "email", enabled: false });
  assert.equal(upsertManyCalls, 1);
  const after = await ns.preferences.list();
  assert.equal(
    after.items
      .filter((item) => item.channel === "email")
      .every((item) => item.enabled === false),
    true
  );
});

test("preference overrides survive a new module on the same store", async () => {
  const store = createMemoryNotificationPreferenceStore();
  const first = createEmbeddedNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-persist",
    preferenceStore: store,
  });
  await first.preferences.update({
    channel: "email",
    enabled: false,
    topic: "security.login",
  });
  const second = createEmbeddedNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-persist",
    preferenceStore: store,
  });
  const listed = await second.preferences.list();
  const loginEmail = listed.items.find(
    (item) => item.topic === "security.login" && item.channel === "email"
  );
  assert.equal(loginEmail?.enabled, false);
  await second.preferences.reset({
    channel: "email",
    topic: "security.login",
  });
  const reset = await first.preferences.list();
  const restored = reset.items.find(
    (item) => item.topic === "security.login" && item.channel === "email"
  );
  assert.equal(restored?.enabled, true);
  assert.equal(restored?.source, "catalog");
});

test("postgres upsertMany issues a single INSERT", async () => {
  const { createPostgresNotificationPreferenceStore } = await import(
    "../src/notifications/postgres-store.ts"
  );
  let queries = 0;
  const store = createPostgresNotificationPreferenceStore({
    query: async (text) => {
      queries += 1;
      assert.match(text, /INSERT INTO/);
      assert.equal(text.includes("INSERT INTO"), true);
      return {
        rows: [
          {
            channel: "email",
            created_at: new Date(),
            digest: null,
            enabled: false,
            id: "pref_1",
            metadata: {},
            organization_id: null,
            topic: "security.login",
            updated_at: new Date(),
            user_id: "user-sql",
          },
          {
            channel: "email",
            created_at: new Date(),
            digest: null,
            enabled: false,
            id: "pref_2",
            metadata: {},
            organization_id: null,
            topic: "security.session",
            updated_at: new Date(),
            user_id: "user-sql",
          },
        ],
      };
    },
  });
  await store.upsertMany([
    {
      channel: "email",
      enabled: false,
      topic: "security.login",
      userId: "user-sql",
    },
    {
      channel: "email",
      enabled: false,
      topic: "security.session",
      userId: "user-sql",
    },
  ]);
  assert.equal(queries, 1);
});

test("applyMany collapses last write per pair into one store call", async () => {
  const store = createMemoryNotificationPreferenceStore();
  let applyManyCalls = 0;
  const wrapped = {
    applyMany: async (operations: Parameters<typeof store.applyMany>[0]) => {
      applyManyCalls += 1;
      return store.applyMany(operations);
    },
    delete: store.delete.bind(store),
    deleteMany: store.deleteMany.bind(store),
    list: store.list.bind(store),
    upsert: store.upsert.bind(store),
    upsertMany: store.upsertMany.bind(store),
  };
  const ns = createEmbeddedNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-apply",
    preferenceStore: wrapped,
  });
  await ns.preferences.applyMany({
    mutations: [
      {
        channel: "email",
        enabled: false,
        operation: "set",
        topic: "security.login",
      },
      {
        channel: "email",
        enabled: true,
        operation: "set",
        topic: "security.login",
      },
      {
        channel: "email",
        enabled: false,
        operation: "set",
        topic: "billing.invoice",
      },
    ],
  });
  assert.equal(applyManyCalls, 1);
  const listed = await ns.preferences.list();
  const login = listed.items.find(
    (item) => item.topic === "security.login" && item.channel === "email"
  );
  const invoice = listed.items.find(
    (item) => item.topic === "billing.invoice" && item.channel === "email"
  );
  assert.equal(login?.enabled, true);
  assert.equal(invoice?.enabled, false);
});

test("applyMany rejects mixed organization scopes", async () => {
  const ns = createEmbeddedNotificationsModule({
    catalog: NOTIFICATION_CATALOG,
    getUserId: () => "user-scope",
  });
  await assert.rejects(
    () =>
      ns.preferences.applyMany({
        mutations: [
          {
            channel: "email",
            enabled: false,
            operation: "set",
            topic: "security.login",
          },
          {
            channel: "email",
            enabled: false,
            operation: "set",
            organizationId: "org-other",
            topic: "billing.invoice",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof Error && error.message.includes("scope")
  );
});

test("memory applyMany rolls back mixed batches on failure", async () => {
  const store = createMemoryNotificationPreferenceStore();
  await store.upsert({
    channel: "email",
    enabled: false,
    topic: "security.login",
    userId: "user-atomic",
  });
  const wrapped = {
    applyMany: store.applyMany,
    delete: store.delete.bind(store),
    deleteMany: store.deleteMany.bind(store),
    list: store.list.bind(store),
    upsert: store.upsert.bind(store),
    upsertMany: async () => {
      throw new Error("upsert failed");
    },
  };
  await assert.rejects(() =>
    wrapped.applyMany([
      {
        channel: "email",
        operation: "reset",
        topic: "security.login",
        userId: "user-atomic",
      },
      {
        channel: "email",
        enabled: false,
        operation: "set",
        topic: "billing.invoice",
        userId: "user-atomic",
      },
    ])
  );
  const remaining = await store.list({ userId: "user-atomic" });
  assert.equal(
    remaining.some(
      (row) => row.topic === "security.login" && row.channel === "email"
    ),
    true
  );
});

test("postgres deleteMany issues a single DELETE", async () => {
  const { createPostgresNotificationPreferenceStore } = await import(
    "../src/notifications/postgres-store.ts"
  );
  let queries = 0;
  const store = createPostgresNotificationPreferenceStore({
    query: async (text) => {
      queries += 1;
      assert.match(text, /DELETE FROM/);
      assert.match(text, /USING \(VALUES/);
      return { rows: [{ id: "pref_1" }, { id: "pref_2" }] };
    },
  });
  const deleted = await store.deleteMany([
    {
      channel: "email",
      topic: "security.login",
      userId: "user-sql",
    },
    {
      channel: "email",
      topic: "security.session",
      userId: "user-sql",
    },
  ]);
  assert.equal(queries, 1);
  assert.equal(deleted, 2);
});

test("postgres mixed applyMany uses a pinned transaction", async () => {
  const { createPostgresNotificationPreferenceStore } = await import(
    "../src/notifications/postgres-store.ts"
  );
  let transactionCalls = 0;
  let innerQueries = 0;
  const store = createPostgresNotificationPreferenceStore({
    query: async () => ({ rows: [] }),
    transaction: async (fn) => {
      transactionCalls += 1;
      return fn({
        query: async (text) => {
          innerQueries += 1;
          if (String(text).includes("DELETE")) {
            return { rows: [{ id: "pref_1" }] };
          }
          return {
            rows: [
              {
                channel: "email",
                created_at: new Date(),
                digest: null,
                enabled: false,
                id: "pref_2",
                metadata: {},
                organization_id: null,
                topic: "billing.invoice",
                updated_at: new Date(),
                user_id: "user-sql",
              },
            ],
          };
        },
      });
    },
  });
  await store.applyMany([
    {
      channel: "email",
      operation: "reset",
      topic: "security.login",
      userId: "user-sql",
    },
    {
      channel: "email",
      enabled: false,
      operation: "set",
      topic: "billing.invoice",
      userId: "user-sql",
    },
  ]);
  assert.equal(transactionCalls, 1);
  assert.equal(innerQueries, 2);
});
