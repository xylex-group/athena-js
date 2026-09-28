import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { produceAthenaDevtoolsAuthorizationInspector } from "../src/devtools/produce/authorization.ts";
import { produceAthenaDevtoolsSnapshot } from "../src/devtools/produce/index.ts";
import {
  explainAthenaAuthorization,
  simulateAthenaAuthorizationWhatIf,
} from "../src/devtools/protocol/authorization-explain.ts";
import { ATHENA_DEVTOOLS_PROTOCOL_VERSION } from "../src/devtools/protocol/index.ts";
import { MemoryAuthorizationStore } from "../src/runtime/authorization/memory.ts";

test("protocol v3 authorization inspector is never null", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({});
  assert.equal(ATHENA_DEVTOOLS_PROTOCOL_VERSION, 3);
  assert.equal(snapshot.protocolVersion, 3);
  assert.equal(typeof snapshot.authorization.status, "string");
  assert.notEqual(snapshot.authorization, null);
  assert.ok(snapshot.authorization.catalog.rights.length > 0);
  assert.ok(snapshot.panels.some((panel) => panel.panelId === "authorization"));
  const athenaJs = snapshot.packages.find(
    (entry) => entry.name === "@xylex-group/athena"
  );
  assert.ok(athenaJs);
  assert.equal(typeof athenaJs.version, "string");
  assert.equal(typeof athenaJs.buildTimestamp, "string");
  assert.equal(typeof athenaJs.dirty, "boolean");
  assert.deepEqual(snapshot.overview.packages, snapshot.packages);
});

test("explain uses canonical rightMatches", () => {
  const denied = explainAthenaAuthorization({
    held: ["billing.catalog.read"],
    required: ["billing.payments.write"],
  });
  assert.equal(denied.outcome, "deny");
  assert.deepEqual([...denied.missing], ["billing.payments.write"]);
  const allowed = explainAthenaAuthorization({
    held: ["billing.payments.write"],
    required: ["billing.payments.write"],
  });
  assert.equal(allowed.outcome, "allow");
  assert.equal(allowed.matched[0]?.matchKind, "exact");
});

test("what-if role diff uses catalog role rights without mutation", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  const graph = await store.inspectGraph();
  const customer = graph.roles.find((role) => role.key === "platform_customer");
  const admin = graph.roles.find((role) => role.key === "platform_admin");
  assert.ok(customer);
  assert.ok(admin);
  const diff = simulateAthenaAuthorizationWhatIf({
    addRoleKeys: ["platform_admin"],
    held: [...customer.rights],
    roles: graph.roles.map((role) => ({ key: role.key, rights: role.rights })),
  });
  assert.ok(diff.added.length > 0);
  assert.equal(diff.removed.length, 0);
});

test("store-backed producer is ready with inspectGraph", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () => ({ authorization: store }) as never,
    } as never,
  });
  assert.equal(inspector.status, "ready");
  assert.ok(inspector.roles.length > 0);
  assert.ok(inspector.inventory.grants.length >= 0);
  assert.equal(inspector.source, "memory");
  assert.equal(typeof inspector.revision, "number");
  assert.equal(inspector.capabilities, null);
  assert.ok(inspector.catalogState.rightCount > 0);
});

test("HTTP authorization client is not treated as a persisted store", async () => {
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () =>
        ({
          authorization: {
            getSnapshot: async () => ({}),
            listRoles: async () => [],
          },
        }) as never,
    } as never,
  });
  assert.equal(inspector.status, "not-configured");
  assert.equal(
    inspector.diagnostics.some((entry) => entry.code === "inspect-failed"),
    false
  );
});

test("stale store missing inspectGraph is unsupported, not inspect-failed", async () => {
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () =>
        ({
          authorization: {
            hasUserAssignment: async () => false,
            readSnapshot: async () => ({}),
            resolveEffectiveRights: async () => [],
          },
        }) as never,
    } as never,
  });
  assert.equal(inspector.status, "ready");
  assert.equal(
    inspector.diagnostics.some((entry) => entry.code === "inspect-failed"),
    false
  );
  assert.equal(
    inspector.diagnostics.some(
      (entry) => entry.code === "inspector-unsupported"
    ),
    true
  );
});

test("HTTP module plus postgres runtime inspects with the current store class", async () => {
  const empty = { rowCount: 0, rows: [] };
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () =>
        ({
          authorization: {
            getSnapshot: async () => ({}),
            listRoles: async () => [],
          },
        }) as never,
      postgresRuntime: {
        inspectPool: async () => ({
          idleCount: 1,
          totalCount: 1,
          waitingCount: 0,
        }),
        query: async () => empty,
        transaction: async (fn: (runtime: unknown) => Promise<unknown>) =>
          fn({
            inspectPool: async () => ({
              idleCount: 1,
              totalCount: 1,
              waitingCount: 0,
            }),
            query: async () => empty,
            transaction: async () => empty,
          }),
      },
    } as never,
  });
  assert.equal(inspector.status, "ready");
  assert.equal(inspector.subject.kind, "runtime");
});

test("unbound inspector does not treat every assignment as the subject", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  await store.assignUserRole("admin-1", "platform_admin");
  await store.assignUserRole("customer-1", "platform_customer");
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () => ({ authorization: store }) as never,
    } as never,
  });
  assert.equal(inspector.subject.kind, "runtime");
  assert.equal(inspector.subject.userId, null);
  assert.equal(inspector.roleResolution.effective.length, 0);
  assert.equal(inspector.rights.effective.length, 0);
  assert.equal(inspector.capabilities, null);
  assert.ok(inspector.inventory.grants.length >= 2);
  assert.equal(inspector.grants.length, inspector.inventory.grants.length);
  assert.ok(
    inspector.diagnostics.some(
      (entry) => entry.code === "inspector-unbound-subject"
    )
  );
});

test("authenticated session without subject is degraded, not OK", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  await store.assignUserRole("admin-1", "platform_admin");
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () => ({ authorization: store }) as never,
    } as never,
    sessionAuthenticated: true,
    subject: { userId: null },
  });
  assert.equal(inspector.status, "degraded");
  const unbound = inspector.diagnostics.find(
    (entry) => entry.code === "inspector-unbound-subject"
  );
  assert.ok(unbound);
  assert.equal(unbound.severity, "error");
  assert.equal(inspector.rights.effective.length, 0);
});

test("bound inspector projects effective rights for the subject", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  await store.assignUserRole("admin-1", "platform_admin");
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () => ({ authorization: store }) as never,
    } as never,
    subject: { userId: "admin-1" },
  });
  assert.equal(inspector.subject.kind, "user");
  assert.equal(inspector.subject.userId, "admin-1");
  assert.equal(inspector.subject.userId, inspector.subject.userId);
  assert.ok(
    inspector.roleResolution.effective.some(
      (role) => role.key === "platform_admin"
    )
  );
  assert.ok(inspector.rights.effective.length > 0);
  assert.equal(
    inspector.subject.rights.effective.length,
    inspector.rights.effective.length
  );
  assert.equal(inspector.capabilities?.canManagePlatformRoles, true);
  assert.ok(
    inspector.inventory.grants.some(
      (grant) => grant.subject.userId === "admin-1"
    )
  );
});
