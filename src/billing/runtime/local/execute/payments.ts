import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCancelPaymentInput,
  BillingCreatePaymentInput,
  BillingGetPaymentInput,
  BillingListPaymentsInput,
  BillingPayment,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import type { BillingProviderCreatePaymentInput } from "../providers/types.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import {
  rejectUnsupportedListOffset,
  rejectUnsupportedLocalPaymentListSource,
} from "./shared.ts";

type BillingLocalPaymentCreatePayload = BillingCreatePaymentInput & {
  cancelUrl?: string | null;
};

export async function executeLocalBillingPaymentCreate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingLocalPaymentCreatePayload;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPayment> {
  return executeLocalBillingOperation({
    invoke: (payments, context, payload) => {
      const providerInput: BillingProviderCreatePaymentInput = {
        amount: payload.amount,
        cancelUrl: payload.cancelUrl,
        customerId: payload.customerId,
        description: payload.description,
        idempotencyKey: payload.idempotencyKey,
        metadata: payload.metadata,
        redirectUrl: payload.redirectUrl,
        sequenceType: payload.sequenceType,
      };
      return payments.create(context, providerInput);
    },
    operation: "payments.create",
    port: "payments",
    request: input,
    safety: "defer-then-finalize",
  });
}

export async function executeLocalBillingPaymentGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetPaymentInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPayment> {
  return executeLocalBillingOperation({
    invoke: (payments, context, payload) =>
      payments.get(context, { id: payload.id }),
    operation: "payments.get",
    port: "payments",
    request: input,
  });
}

export async function executeLocalBillingPaymentCancel(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCancelPaymentInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPayment> {
  return executeLocalBillingOperation({
    invoke: (payments, context, payload) =>
      payments.cancel(context, { id: payload.id }),
    operation: "payments.cancel",
    port: "payments",
    request: input,
  });
}

export async function executeLocalBillingPaymentList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListPaymentsInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingPayment>> {
  return executeLocalBillingOperation({
    before: (payload) => {
      rejectUnsupportedListOffset("payments.list", payload.offset);
      rejectUnsupportedLocalPaymentListSource(payload.source);
    },
    invoke: (payments, context, payload) =>
      payments.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "payments.list",
    port: "payments",
    request: input,
  });
}
