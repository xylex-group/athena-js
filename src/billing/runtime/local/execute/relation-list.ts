import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCatalogRelation,
  BillingListRelationsInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingRelationList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListRelationsInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingCatalogRelation>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("relations.list", payload.offset),
    invoke: (relations, context, payload) =>
      relations.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
        sourceProductId: payload.sourceProductId,
      }),
    operation: "relations.list",
    port: "relations",
    request: input,
  });
}
