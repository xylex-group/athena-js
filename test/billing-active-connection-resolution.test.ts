import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AthenaBillingCapabilityError } from "../src/billing/errors.ts";
import {
  requireReadyBillingConnectionId,
  resolveActiveBillingConnection,
} from "../src/billing/subject/sole-connection.ts";

test("resolveActiveBillingConnection distinguishes none, ready, and ambiguous", async () => {
  const none = await resolveActiveBillingConnection({
    async query() {
      return { rows: [] };
    },
  });
  assert.deepEqual(none, { status: "none" });

  const ready = await resolveActiveBillingConnection({
    async query() {
      return { rows: [{ id: "conn_1" }] };
    },
  });
  assert.deepEqual(ready, { connectionId: "conn_1", status: "ready" });

  const ambiguous = await resolveActiveBillingConnection({
    async query() {
      return { rows: [{ id: "a" }, { id: "b" }] };
    },
  });
  assert.deepEqual(ambiguous, { status: "ambiguous" });
});

test("requireReadyBillingConnectionId fails closed for none and ambiguous", () => {
  assert.throws(
    () =>
      requireReadyBillingConnectionId({ status: "none" }, "customers.create"),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_missing"
  );
  assert.throws(
    () =>
      requireReadyBillingConnectionId(
        { status: "ambiguous" },
        "customers.create"
      ),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_ambiguous"
  );
  assert.equal(
    requireReadyBillingConnectionId(
      { connectionId: "c1", status: "ready" },
      "customers.create"
    ),
    "c1"
  );
});
