/**
 * Official mollie-api-typescript Client contract (Phase 1).
 * Must compile against the real exported Client — not FetchMollieSdk.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { Client } from "mollie-api-typescript";
import type { MollieSdkConstructor } from "../../../src/billing/providers/types.ts";
import { assertMollieSdkClient } from "../../../src/billing/runtime/local/providers/mollie/sdk/assertions.ts";
import { createOfficialMollieAdapter } from "../../../src/billing/runtime/local/providers/mollie/sdk/official-adapter.ts";

const officialClientConstructor: MollieSdkConstructor = Client;

test("ACT-MOLLIE-SDK-001: official Client satisfies the Athena adapter", () => {
  const client = new Client({
    security: { apiKey: "test_conformance" },
  });
  const adapted = assertMollieSdkClient(client, "conformance.client");
  assert.ok(adapted.payments);
  assert.ok(adapted.customers);
  assert.ok(adapted.refunds);
  assert.ok(adapted.paymentLinks);
  assert.ok(adapted.subscriptions);
  assert.ok(adapted.salesInvoices);
});

test("ACT-MOLLIE-SDK-002: official Client accepts apiKey / advanced / OAuth", () => {
  const adapter = createOfficialMollieAdapter(officialClientConstructor);
  const apiKey = adapter({ security: { apiKey: "test_key" } });
  const advanced = adapter({
    security: { advancedAccessToken: "access_token_x" },
    testmode: true,
  });
  const oauth = adapter({
    profileId: "pfl_conformance",
    security: { oAuth: "access_oauth" },
  });
  assertMollieSdkClient(apiKey, "conformance.apiKey");
  assertMollieSdkClient(advanced, "conformance.advanced");
  assertMollieSdkClient(oauth, "conformance.oauth");
});
