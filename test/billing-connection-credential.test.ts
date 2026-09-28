import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createPersistedProviderBinding } from "../src/billing/runtime/local/providers/connection-binding.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const SLOT_A = "test_connection_slot_a";
const SLOT_B = "test_connection_slot_b";

test("connection credential_reference selects named Mollie slots", () => {
  const configured = {
    mollie: {
      sdk: FetchMollieSdk,
      testKey: SLOT_A,
    },
    mollieAccounts: {
      org_b: {
        sdk: FetchMollieSdk,
        testKey: SLOT_B,
      },
    },
  };
  const defaultBinding = createPersistedProviderBinding({
    configuredProviders: configured,
    connectionId: "conn-a",
    credentialReference: "providers.mollie",
    provider: "mollie",
  });
  const namedBinding = createPersistedProviderBinding({
    configuredProviders: configured,
    connectionId: "conn-b",
    credentialReference: "providers.mollie:org_b",
    provider: "mollie",
  });
  assert.equal(defaultBinding.kind, "connection");
  assert.equal(defaultBinding.connectionId, "conn-a");
  assert.equal(
    defaultBinding.credentials.test?.secret.revealForProviderRuntime(),
    SLOT_A
  );
  assert.equal(
    namedBinding.credentials.test?.secret.revealForProviderRuntime(),
    SLOT_B
  );
  assert.notEqual(
    defaultBinding.credentials.test?.secret.revealForProviderRuntime(),
    namedBinding.credentials.test?.secret.revealForProviderRuntime()
  );
});

test("environment-suffixed default Mollie credential_reference uses billing.providers.mollie", () => {
  const configured = {
    mollie: {
      liveKey: "live_slot",
      sdk: FetchMollieSdk,
      testKey: SLOT_A,
    },
  };
  const liveBinding = createPersistedProviderBinding({
    configuredProviders: configured,
    connectionId: "conn-live",
    credentialReference: "providers.mollie-live",
    provider: "mollie",
  });
  assert.equal(
    liveBinding.credentials.live?.secret.revealForProviderRuntime(),
    "live_slot"
  );
});

test("missing named Mollie slot fails closed", () => {
  assert.throws(
    () =>
      createPersistedProviderBinding({
        configuredProviders: {
          mollie: { sdk: FetchMollieSdk, testKey: SLOT_A },
        },
        connectionId: "conn-b",
        credentialReference: "providers.mollie:org_b",
        provider: "mollie",
      }),
    (error: unknown) =>
      error instanceof Error && error.message.includes("providers.mollie:org_b")
  );
});
