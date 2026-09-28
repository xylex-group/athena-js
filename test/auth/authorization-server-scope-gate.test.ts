import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeAndDispatchDataNucleusMutation,
  authorizeDataNucleusMutation,
} from "../../src/runtime/data/nucleus/authorize.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const oauthPrincipal: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  oauth: {
    clientId: "client",
    grantId: "grant",
    resource: "https://resource.example",
    scopes: ["invoice:read", "data:read", "rpc:invoke"],
  },
  rights: [],
  userId: "user",
};

const sessionPrincipal: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  rights: [],
  userId: "user",
};

function oauthWithout(scope: string): AthenaPrincipal {
  const current = oauthPrincipal.oauth;
  if (current == null) {
    return oauthPrincipal;
  }
  return {
    ...oauthPrincipal,
    oauth: {
      ...current,
      scopes: current.scopes.filter((entry) => entry !== scope),
    },
  };
}

test("OAuth resource scope policy gates writes independently of Athena Rights", () => {
  const denied = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      insert: ["invoice:write"],
    },
    principal: oauthPrincipal,
    request: {
      operation: "insert",
      payload: { table_name: "invoices", insert_body: { id: "1" } },
    },
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.response.status, 403);
  }
});

test("OAuth resource scope policy allows a delegated scope to reach Rights/policy authorization", () => {
  const allowed = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      insert: ["invoice:read"],
    },
    principal: oauthPrincipal,
    request: {
      operation: "insert",
      payload: { table_name: "invoices", insert_body: { id: "1" } },
    },
  });
  assert.equal(allowed.ok, true);
});

test("OAuth scope policy gates query independently of Policy CRUD mapping", () => {
  const denied = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      query: ["data:read"],
    },
    principal: oauthWithout("data:read"),
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.response.status, 403);
  }

  const allowed = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      query: ["data:read"],
    },
    principal: oauthPrincipal,
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(allowed.ok, true);
});

test("OAuth scope policy gates rpc independently of Policy CRUD mapping", () => {
  const denied = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      rpc: ["rpc:invoke"],
    },
    principal: oauthWithout("rpc:invoke"),
    request: { operation: "rpc", payload: { function: "invoice_total" } },
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.response.status, 403);
  }

  const allowed = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      rpc: ["rpc:invoke"],
    },
    principal: oauthPrincipal,
    request: { operation: "rpc", payload: { function: "invoice_total" } },
  });
  assert.equal(allowed.ok, true);
});

test("OAuth principals fail closed without a scope policy or operation entry", () => {
  const missingPolicy = authorizeDataNucleusMutation({
    principal: oauthPrincipal,
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(missingPolicy.ok, false);
  if (!missingPolicy.ok) {
    assert.equal(missingPolicy.response.status, 403);
  }

  const missingEntry = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      insert: ["invoice:read"],
    },
    principal: oauthPrincipal,
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(missingEntry.ok, false);
  if (!missingEntry.ok) {
    assert.equal(missingEntry.response.status, 403);
  }
});

test("explicit empty OAuth scope lists are unrestricted for that operation", () => {
  const allowed = authorizeDataNucleusMutation({
    oauthScopePolicy: {
      query: [],
    },
    principal: oauthWithout("data:read"),
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(allowed.ok, true);
});

test("session principals are unaffected by missing OAuth scope policy", () => {
  const allowed = authorizeDataNucleusMutation({
    principal: sessionPrincipal,
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(allowed.ok, true);
});

test("denied OAuth query and rpc requests do not dispatch", async () => {
  let dispatched = 0;
  const denied = await authorizeAndDispatchDataNucleusMutation({
    dispatch: async () => {
      dispatched += 1;
      return { data: null, ok: true, raw: null, status: 200 };
    },
    principal: oauthPrincipal,
    request: { operation: "query", payload: { sql: "select 1" } },
  });
  assert.equal(denied.authorization.ok, false);
  assert.equal(denied.response.status, 403);
  assert.equal(dispatched, 0);

  const rpcDenied = await authorizeAndDispatchDataNucleusMutation({
    dispatch: async () => {
      dispatched += 1;
      return { data: null, ok: true, raw: null, status: 200 };
    },
    oauthScopePolicy: {
      rpc: ["rpc:invoke"],
    },
    principal: oauthWithout("rpc:invoke"),
    request: { operation: "rpc", payload: { function: "invoice_total" } },
  });
  assert.equal(rpcDenied.authorization.ok, false);
  assert.equal(dispatched, 0);
});
