/**
 * Mollie must satisfy the shared local billing provider contract.
 */
import { createMollieBillingProviderRuntime } from "../../../src/billing/runtime/local/providers/mollie/runtime.ts";
import { FetchMollieSdk } from "../../helpers/fetch-mollie-sdk.ts";
import { runBillingProviderConformance } from "./contract.ts";

runBillingProviderConformance({
  provider: "mollie",
  runtime: createMollieBillingProviderRuntime({
    sdk: FetchMollieSdk,
    testKey: "test_xxx",
  }),
});
