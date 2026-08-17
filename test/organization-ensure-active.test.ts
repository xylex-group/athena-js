import assert from "node:assert/strict";
import test from "node:test";
import { ensureActiveOrganization } from "../src/organization/index.ts";

test("ensureActiveOrganization returns current active org without listing", async () => {
  let listCalls = 0;
  let setCalls = 0;

  const result = await ensureActiveOrganization({
    listOrganizations: async () => {
      listCalls += 1;
      return [{ id: "org-1" }];
    },
    session: {
      session: {
        activeOrganizationId: "org-active",
      },
    },
    setActiveOrganization: async () => {
      setCalls += 1;
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: "org-active",
    didSetActiveOrganization: false,
  });
  assert.equal(listCalls, 0);
  assert.equal(setCalls, 0);
});

test("ensureActiveOrganization sets the first organization when none is active", async () => {
  const setIds: string[] = [];

  const result = await ensureActiveOrganization({
    listOrganizations: async () => [{ id: "org-1" }, { id: "org-2" }],
    session: {
      session: {
        activeOrganizationId: null,
      },
    },
    setActiveOrganization: async (organizationId) => {
      setIds.push(organizationId);
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: "org-1",
    didSetActiveOrganization: true,
  });
  assert.deepEqual(setIds, ["org-1"]);
});

test("ensureActiveOrganization uses a custom organization selector", async () => {
  const setIds: string[] = [];

  const result = await ensureActiveOrganization({
    listOrganizations: async () => [{ id: "org-1" }, { id: "org-2" }],
    selectOrganizationId: (organizations) => organizations[1]?.id ?? null,
    session: {
      session: {
        activeOrganizationId: null,
      },
    },
    setActiveOrganization: async (organizationId) => {
      setIds.push(organizationId);
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: "org-2",
    didSetActiveOrganization: true,
  });
  assert.deepEqual(setIds, ["org-2"]);
});

test("ensureActiveOrganization does nothing when no organizations are available", async () => {
  let setCalls = 0;

  const result = await ensureActiveOrganization({
    listOrganizations: async () => [],
    session: {
      session: {
        activeOrganizationId: null,
      },
    },
    setActiveOrganization: async () => {
      setCalls += 1;
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: null,
    didSetActiveOrganization: false,
  });
  assert.equal(setCalls, 0);
});

test("ensureActiveOrganization surfaces list failures through onError", async () => {
  const errors: unknown[] = [];
  let setCalls = 0;

  const result = await ensureActiveOrganization({
    listOrganizations: async () => {
      throw new Error("list failed");
    },
    onError: (error) => {
      errors.push(error);
    },
    session: {
      session: {
        activeOrganizationId: null,
      },
    },
    setActiveOrganization: async () => {
      setCalls += 1;
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: null,
    didSetActiveOrganization: false,
  });
  assert.equal(errors.length, 1);
  assert.equal(setCalls, 0);
});

test("ensureActiveOrganization surfaces set-active failures through onError", async () => {
  const errors: unknown[] = [];

  const result = await ensureActiveOrganization({
    listOrganizations: async () => [{ id: "org-1" }],
    onError: (error) => {
      errors.push(error);
    },
    session: {
      session: {
        activeOrganizationId: null,
      },
    },
    setActiveOrganization: async () => {
      throw new Error("set-active failed");
    },
  });

  assert.deepEqual(result, {
    activeOrganizationId: null,
    didSetActiveOrganization: false,
  });
  assert.equal(errors.length, 1);
});

test("ensureActiveOrganization trims blank active organization ids", async () => {
  const result = await ensureActiveOrganization({
    listOrganizations: async () => [{ id: "  org-1  " }],
    session: {
      session: {
        activeOrganizationId: "   ",
      },
    },
    setActiveOrganization: async () => undefined,
  });

  assert.deepEqual(result, {
    activeOrganizationId: "org-1",
    didSetActiveOrganization: true,
  });
});
