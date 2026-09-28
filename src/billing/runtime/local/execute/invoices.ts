import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingGetInvoiceInput,
  BillingInvoice,
  BillingListInvoicesInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingInvoiceGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetInvoiceInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingInvoice> {
  return executeLocalBillingOperation({
    invoke: (invoices, context, payload) =>
      invoices.get(context, { invoiceId: payload.invoiceId }),
    operation: "invoices.get",
    port: "invoices",
    request: input,
  });
}

export async function executeLocalBillingInvoiceList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListInvoicesInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingInvoice>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("invoices.list", payload.offset),
    invoke: (invoices, context, payload) =>
      invoices.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "invoices.list",
    port: "invoices",
    request: input,
  });
}
