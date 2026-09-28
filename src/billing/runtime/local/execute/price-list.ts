import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingListPricesInput, BillingPrice } from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingPriceList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListPricesInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingPrice>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("prices.list", payload.offset),
    invoke: (prices, context, payload) =>
      prices.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
        productId: payload.productId,
      }),
    operation: "prices.list",
    port: "prices",
    request: input,
  });
}
