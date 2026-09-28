import assert from "node:assert/strict";
import { test } from "node:test";

import { projectRemoteBillingCapabilities } from "../src/billing/runtime/remote/project-capabilities.ts";
import type { BillingOperationCapability } from "../src/billing/runtime/capabilities.ts";
import { getSelfSubscriptionChangeOperation } from "../src/billing/workflows/plan-change/change-operation.ts";

test("remote Billing capabilities preserve explicit workflow safety", () => {
  const capabilities = projectRemoteBillingCapabilities(
    {
      actionCapabilities: [
        {
          available: true,
          operation: "self.subscription.change",
          safety: "preview",
        },
        {
          available: true,
          operation: "self.subscription.enroll",
        },
      ],
      capabilities: {
        connected: true,
        diagnostics: {
          billingSchemaReady: true,
          planChangeSafety: "stable",
        },
        provider: "mollie",
      },
      ports: { self: true, subscriptions: true },
    },
    "connection-1"
  );
  assert.equal(
    capabilities.operations["self.subscription.change"]?.safety,
    "preview"
  );
  assert.equal(
    capabilities.operations["self.subscription.enroll"]?.safety,
    undefined
  );
  assert.equal(capabilities.diagnostics?.billingSchemaReady, true);
  assert.equal(capabilities.diagnostics?.planChangeSafety, "stable");
});

test("Billing operation capabilities expose the workflow safety contract", () => {
  const capability: BillingOperationCapability = {
    available: true,
    safety: "stable",
  };
  assert.equal(capability.safety, "stable");
});

test("self plan-change status is subject-scoped and exposes processing state", async () => {
  const sql = {
    async query() {
      return {
        rows: [
          {
            id: "operation-1",
            last_error: null,
            state: "provider_update_pending",
            subject_id: "user-1",
            subject_kind: "user",
            updated_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
  const operation = await getSelfSubscriptionChangeOperation({
    operationId: "operation-1",
    principal: {
      authenticated: true,
      grants: [],
      rights: [],
      userId: "user-1",
    },
    sql,
  });
  assert.equal(operation.status, "processing");
  assert.equal(operation.state, "provider_update_pending");
  await assert.rejects(() =>
    getSelfSubscriptionChangeOperation({
      operationId: "operation-1",
      principal: {
        authenticated: true,
        grants: [],
        rights: [],
        userId: "user-2",
      },
      sql,
    })
  );
});
