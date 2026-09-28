import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
} from "../src/billing/ingestion/urls.ts";
import { mollieSdkClientOptions } from "../src/billing/runtime/local/providers/mollie/sdk/client-factory.ts";
import { mollieOperationScopeFor } from "../src/billing/runtime/local/providers/operation-scope.ts";

const credential = {
  environment: "test" as const,
  revealForProviderRuntime: () => "access_org_token",
};

const config = {
  apiBaseUrl: "https://api.mollie.com",
  credentialKind: "advanced_access_token" as const,
  defaultProfileId: "pfl_default",
  profileId: "pfl_default",
  sdk: class {},
} as never;

test("webhook control-plane operations are organization scoped", () => {
  assert.equal(mollieOperationScopeFor("webhooks.create"), "organization");
  assert.equal(mollieOperationScopeFor("webhooks.list"), "organization");
  assert.equal(mollieOperationScopeFor("webhooks.delete"), "organization");
  assert.equal(mollieOperationScopeFor("payments.create"), "profile");
  assert.equal(mollieOperationScopeFor("customers.create"), "organization");
});

test("organization scope omits defaultProfileId on the SDK client", () => {
  const options = mollieSdkClientOptions({
    config,
    credential: credential as never,
    operationScope: "organization",
    requestedProfileId: null,
  });
  assert.equal(options.profileId, undefined);
  assert.equal(options.security?.advancedAccessToken, "access_org_token");
});

test("profile scope applies defaultProfileId", () => {
  const options = mollieSdkClientOptions({
    config,
    credential: credential as never,
    operationScope: "profile",
    requestedProfileId: null,
  });
  assert.equal(options.profileId, "pfl_default");
});

test("Mollie webhook create encodes eventTypes as a comma-separated JSON string", async () => {
  const { mapCreateWebhookToMollieSdk } = await import(
    "../src/billing/runtime/local/providers/mollie/dialect/webhooks.ts"
  );
  const { CreateWebhookRequest$outboundSchema } = await import(
    "mollie-api-typescript/models/operations"
  );
  const mapped = mapCreateWebhookToMollieSdk({
    input: {
      eventTypes: ["payment.paid", "payment.failed"],
      idempotencyKey: "idemp",
      name: "athena",
      url: "https://example.test/api/athena/billing/webhook/mollie/events",
    },
    testMode: true,
  });
  assert.equal(
    (mapped.requestBody as { eventTypes: string }).eventTypes,
    "payment.paid,payment.failed"
  );
  assert.throws(() => CreateWebhookRequest$outboundSchema.parse(mapped));
});

test("classic webhook paths remain independent of next-gen events path", () => {
  assert.equal(
    BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
    "/api/athena/billing/webhook/mollie/classic"
  );
  assert.equal(
    BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
    "/api/athena/billing/webhook/mollie/events"
  );
  assert.notEqual(
    BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
    BILLING_MOLLIE_EVENTS_WEBHOOK_PATH
  );
});
