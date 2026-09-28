import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCancelRefundInput,
  BillingCreateRefundInput,
  BillingGetRefundInput,
  BillingListRefundsInput,
  BillingRefund,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingRefundCreate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCreateRefundInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingRefund> {
  return executeLocalBillingOperation({
    invoke: (refunds, context, payload) =>
      refunds.create(context, {
        amount: payload.amount,
        description: payload.description,
        idempotencyKey: payload.idempotencyKey,
        paymentId: payload.paymentId,
      }),
    operation: "refunds.create",
    port: "refunds",
    request: input,
    safety: "defer-then-finalize",
  });
}

export async function executeLocalBillingRefundGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetRefundInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingRefund> {
  return executeLocalBillingOperation({
    invoke: (refunds, context, payload) =>
      refunds.get(context, {
        paymentId: payload.paymentId,
        refundId: payload.refundId,
      }),
    operation: "refunds.get",
    port: "refunds",
    request: input,
  });
}

export async function executeLocalBillingRefundCancel(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCancelRefundInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingRefund> {
  return executeLocalBillingOperation({
    invoke: (refunds, context, payload) =>
      refunds.cancel(context, {
        ...(typeof payload.idempotencyKey === "string"
          ? { idempotencyKey: payload.idempotencyKey }
          : {}),
        paymentId: payload.paymentId,
        refundId: payload.refundId,
      }),
    operation: "refunds.cancel",
    port: "refunds",
    request: input,
  });
}

export async function executeLocalBillingRefundList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListRefundsInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingRefund>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("refunds.list", payload.offset),
    invoke: (refunds, context, payload) =>
      refunds.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "refunds.list",
    port: "refunds",
    request: input,
  });
}
