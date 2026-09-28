import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingListProductsInput,
  BillingProduct,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingProductList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListProductsInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingProduct>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("products.list", payload.offset),
    invoke: (products, context, payload) =>
      products.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "products.list",
    port: "products",
    request: input,
  });
}
