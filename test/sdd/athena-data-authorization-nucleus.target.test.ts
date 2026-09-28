import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaGatewayResponse } from "../../src/gateway/types.ts";
import {
  createAthenaModelAuthorizationBindingRegistry,
} from "../../src/runtime/authorization/binding-registry.ts";
import {
  authorizeModel,
  organizationScope,
} from "../../src/runtime/authorization/model-binding.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import {
  authorizeAndDispatchDataNucleusMutation,
  authorizeDataNucleusMutation,
} from "../../src/runtime/data/nucleus/authorize.ts";
import { hasAuthorizedBrand } from "../../src/runtime/data/nucleus/types.ts";

function ok(data: unknown): AthenaGatewayResponse<unknown> {
  return {
    count: Array.isArray(data) ? data.length : 1,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw: { data },
    status: 200,
    statusText: "OK",
  };
}

function registry() {
  return createAthenaModelAuthorizationBindingRegistry([
    authorizeModel({
      identity: { column: "id" },
      resource: {
        model: "Invoice",
        table: "billing.invoices",
      },
      rights: {
        delete: "data.invoice.delete",
        insert: "data.invoice.insert",
        select: "data.invoice.select",
        update: "data.invoice.update",
      },
      scope: organizationScope("organization_id"),
    }),
  ]);
}

function principal(rights: readonly string[], organizationId = "org_1") {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    organizationId,
    rights,
    userId: "user_1",
  });
}

test("L04 seam: principal -> binding -> decision -> allow -> obligations -> brand", () => {
  const phases: string[] = [];
  const result = authorizeDataNucleusMutation({
    authorizationBindings: registry(),
    onPhase: (phase) => phases.push(phase),
    principal: principal(["data.invoice.select"]),
    request: {
      operation: "fetch",
      payload: {
        conditions: [{ column: "id", operator: "eq", value: "inv_1" }],
        table_name: "billing.invoices",
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(phases, [
    "principal",
    "binding",
    "decision",
    "allow",
    "obligations",
    "brand",
  ]);
  assert.equal(hasAuthorizedBrand(result.authorized), true);
});

test("L04 seam: SELECT and DELETE add authoritative scope filters", async () => {
  const calls: unknown[] = [];
  const runFetch = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok([{ id: "inv_1" }]);
    },
    principal: principal(["data.invoice.select"]),
    request: {
      operation: "fetch",
      payload: {
        conditions: [{ column: "id", operator: "eq", value: "inv_1" }],
        table_name: "billing.invoices",
      },
    },
  });
  assert.equal(runFetch.response.ok, true);
  assert.equal(calls.length, 1);
  const fetchPayload = calls[0] as {
    conditions?: Array<{ column?: string; operator?: string; value?: unknown }>;
  };
  assert.ok(fetchPayload.conditions);
  assert.ok(
    fetchPayload.conditions?.some(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1"
    )
  );

  const runDelete = authorizeDataNucleusMutation({
    authorizationBindings: registry(),
    principal: principal(["data.invoice.delete"]),
    request: {
      operation: "delete",
      payload: {
        conditions: [{ column: "id", operator: "eq", value: "inv_2" }],
        table_name: "billing.invoices",
      },
    },
  });
  assert.equal(runDelete.ok, true);
  const deletePayload = runDelete.authorized.payload as {
    conditions?: Array<{ column?: string; operator?: string; value?: unknown }>;
  };
  assert.ok(
    deletePayload.conditions?.some(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1"
    )
  );
});

test("L04 seam: INSERT binds trusted scope when missing", () => {
  const result = authorizeDataNucleusMutation({
    authorizationBindings: registry(),
    principal: principal(["data.invoice.insert"]),
    request: {
      operation: "insert",
      payload: {
        insert_body: { amount: 10, id: "inv_1" },
        table_name: "billing.invoices",
      },
    },
  });
  assert.equal(result.ok, true);
  const payload = result.authorized.payload as {
    insert_body?: { organization_id?: string };
  };
  assert.equal(payload.insert_body?.organization_id, "org_1");
});

test("L04 seam: UPDATE filters target and enforces immutable scope", () => {
  const allowed = authorizeDataNucleusMutation({
    authorizationBindings: registry(),
    principal: principal(["data.invoice.update"]),
    request: {
      operation: "update",
      payload: {
        conditions: [{ column: "id", operator: "eq", value: "inv_1" }],
        table_name: "billing.invoices",
        update_body: { status: "paid" },
      },
    },
  });
  assert.equal(allowed.ok, true);
  const payload = allowed.authorized.payload as {
    conditions?: Array<{ column?: string; operator?: string; value?: unknown }>;
  };
  assert.ok(
    payload.conditions?.some(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1"
    )
  );
});

test("L04 seam: UPDATE scope reassignment is denied before transport", async () => {
  const calls: unknown[] = [];
  const denied = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.update"]),
    request: {
      operation: "update",
      payload: {
        conditions: [{ column: "id", operator: "eq", value: "inv_1" }],
        table_name: "billing.invoices",
        update_body: { organization_id: "org_foreign", status: "paid" },
      },
    },
  });
  assert.equal(denied.response.ok, false);
  assert.equal(readRuntimeErrorCode(denied.response), "ATHENA_MODEL_NOT_EXPOSED");
  assert.equal(calls.length, 0);
});

test("L04 seam: conflicting caller scope denies before transport (no pre-read)", async () => {
  const calls: unknown[] = [];
  const denied = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.insert"]),
    request: {
      operation: "insert",
      payload: {
        insert_body: {
          id: "inv_foreign",
          organization_id: "org_foreign",
          status: "draft",
        },
        table_name: "billing.invoices",
      },
    },
  });
  assert.equal(denied.response.ok, false);
  assert.equal(readRuntimeErrorCode(denied.response), "ATHENA_MODEL_NOT_EXPOSED");
  assert.equal(calls.length, 0);
});

test("L04 seam: deny mode rejects unbound resources before transport", async () => {
  const calls: unknown[] = [];
  const denied = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.select"]),
    request: {
      operation: "fetch",
      payload: {
        conditions: [],
        table_name: "billing.unbound",
      },
    },
    unmatchedResources: "deny",
  });

  assert.equal(denied.response.ok, false);
  assert.equal(
    readRuntimeErrorCode(denied.response),
    "ATHENA_MODEL_NOT_EXPOSED",
  );
  assert.equal(calls.length, 0);
});

test("L04 seam: upsert authorizes insert and conflict-update images", async () => {
  const request = {
    operation: "insert" as const,
    payload: {
      insert_body: { id: "inv_1", status: "draft" },
      table_name: "billing.invoices",
      update_body: { status: "paid" },
    },
    semanticOperation: "upsert" as const,
  };

  const missingUpdate = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async () => ok([]),
    principal: principal(["data.invoice.insert"]),
    request,
  });
  assert.equal(missingUpdate.response.ok, false);
  assert.equal(readRuntimeErrorCode(missingUpdate.response), "ATHENA_POLICY_DENIED");

  const calls: unknown[] = [];
  const allowed = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.insert", "data.invoice.update"]),
    request,
  });
  assert.equal(allowed.response.ok, true);
  assert.equal(calls.length, 1);
  const payload = calls[0] as {
    conditions?: Array<{ column?: string; operator?: string; value?: unknown }>;
    insert_body?: { organization_id?: string };
  };
  assert.equal(payload.insert_body?.organization_id, "org_1");
  assert.ok(
    payload.conditions?.some(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1"
    )
  );
});

test("L04 seam: multi-row upsert binds every insert row and scopes the conflict update", async () => {
  const calls: unknown[] = [];
  const result = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.insert", "data.invoice.update"]),
    request: {
      operation: "insert",
      payload: {
        insert_body: [
          { id: "inv_1", status: "draft" },
          { id: "inv_2", organization_id: "org_1", status: "draft" },
        ],
        table_name: "billing.invoices",
        update_body: { status: "paid" },
      },
      semanticOperation: "upsert",
    },
  });

  assert.equal(result.response.ok, true);
  assert.equal(calls.length, 1);
  const payload = calls[0] as {
    conditions?: Array<{ column?: string; operator?: string; value?: unknown }>;
    insert_body?: Array<{ organization_id?: string }>;
  };
  assert.deepEqual(
    payload.insert_body?.map((row) => row.organization_id),
    ["org_1", "org_1"],
  );
  assert.ok(
    payload.conditions?.some(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1",
    ),
  );
});

test("L04 seam: upsert scope disagreement between images denies before transport", async () => {
  const calls: unknown[] = [];
  const result = await authorizeAndDispatchDataNucleusMutation({
    authorizationBindings: registry(),
    dispatch: async (payload) => {
      calls.push(payload);
      return ok(payload);
    },
    principal: principal(["data.invoice.insert", "data.invoice.update"]),
    request: {
      operation: "insert",
      payload: {
        insert_body: { id: "inv_1", organization_id: "org_1" },
        table_name: "billing.invoices",
        update_body: { organization_id: "org_foreign", status: "paid" },
      },
      semanticOperation: "upsert",
    },
  });

  assert.equal(result.response.ok, false);
  assert.equal(
    readRuntimeErrorCode(result.response),
    "ATHENA_MODEL_NOT_EXPOSED",
  );
  assert.equal(calls.length, 0);
});
