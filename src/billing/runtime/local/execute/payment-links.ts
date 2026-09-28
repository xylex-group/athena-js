import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCreatePaymentLinkInput,
  BillingDeletePaymentLinkInput,
  BillingGetPaymentLinkInput,
  BillingListPaymentLinksInput,
  BillingPaymentLink,
  BillingUpdatePaymentLinkInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingPaymentLinkCreate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCreatePaymentLinkInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPaymentLink> {
  return executeLocalBillingOperation({
    invoke: (paymentLinks, context, payload) =>
      paymentLinks.create(context, {
        amount: payload.amount,
        description: payload.description,
        idempotencyKey: payload.idempotencyKey,
        redirectUrl: payload.redirectUrl,
      }),
    operation: "paymentLinks.create",
    port: "paymentLinks",
    request: input,
    safety: "defer-then-finalize",
  });
}

export async function executeLocalBillingPaymentLinkGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetPaymentLinkInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPaymentLink> {
  return executeLocalBillingOperation({
    invoke: (paymentLinks, context, payload) =>
      paymentLinks.get(context, { id: payload.id }),
    operation: "paymentLinks.get",
    port: "paymentLinks",
    request: input,
  });
}

export async function executeLocalBillingPaymentLinkList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListPaymentLinksInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingPaymentLink>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("paymentLinks.list", payload.offset),
    invoke: (paymentLinks, context, payload) =>
      paymentLinks.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "paymentLinks.list",
    port: "paymentLinks",
    request: input,
  });
}

export async function executeLocalBillingPaymentLinkUpdate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingUpdatePaymentLinkInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPaymentLink> {
  return executeLocalBillingOperation({
    invoke: (paymentLinks, context, payload) =>
      paymentLinks.update(context, {
        description: payload.description,
        id: payload.id,
      }),
    operation: "paymentLinks.update",
    port: "paymentLinks",
    request: input,
  });
}

export async function executeLocalBillingPaymentLinkDelete(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingDeletePaymentLinkInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<void> {
  return executeLocalBillingOperation({
    invoke: async (paymentLinks, context, payload) => {
      await paymentLinks.delete(context, { id: payload.id });
    },
    operation: "paymentLinks.delete",
    port: "paymentLinks",
    request: input,
  });
}
