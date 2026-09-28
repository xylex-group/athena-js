import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCancelSubscriptionInput,
  BillingCreateSubscriptionInput,
  BillingGetSubscriptionInput,
  BillingListSubscriptionsInput,
  BillingSubscription,
  BillingUpdateSubscriptionInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingSubscriptionCreate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCreateSubscriptionInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  return executeLocalBillingOperation({
    invoke: (subscriptions, context, payload) =>
      subscriptions.create(context, {
        amount: payload.amount,
        customerId: payload.customerId,
        description: payload.description,
        idempotencyKey: payload.idempotencyKey,
        interval: payload.interval,
        metadata: payload.metadata,
      }),
    operation: "subscriptions.create",
    port: "subscriptions",
    request: input,
    safety: "defer-then-finalize",
  });
}

export async function executeLocalBillingSubscriptionGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetSubscriptionInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  return executeLocalBillingOperation({
    invoke: (subscriptions, context, payload) =>
      subscriptions.get(context, {
        customerId: payload.customerId,
        subscriptionId: payload.subscriptionId,
      }),
    operation: "subscriptions.get",
    port: "subscriptions",
    request: input,
  });
}

export async function executeLocalBillingSubscriptionList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListSubscriptionsInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingSubscription>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("subscriptions.list", payload.offset),
    invoke: (subscriptions, context, payload) =>
      subscriptions.list(context, {
        cursor: payload.cursor,
        customerId: payload.customerId,
        limit: payload.limit,
      }),
    operation: "subscriptions.list",
    port: "subscriptions",
    request: input,
  });
}

export async function executeLocalBillingSubscriptionUpdate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingUpdateSubscriptionInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  return executeLocalBillingOperation({
    invoke: (subscriptions, context, payload) =>
      subscriptions.update(context, {
        amount: payload.amount,
        customerId: payload.customerId,
        description: payload.description,
        interval: payload.interval,
        metadata: payload.metadata,
        subscriptionId: payload.subscriptionId,
      }),
    operation: "subscriptions.update",
    port: "subscriptions",
    request: input,
  });
}

export async function executeLocalBillingSubscriptionCancel(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCancelSubscriptionInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  return executeLocalBillingOperation({
    invoke: (subscriptions, context, payload) =>
      subscriptions.cancel(context, {
        customerId: payload.customerId,
        subscriptionId: payload.subscriptionId,
      }),
    operation: "subscriptions.cancel",
    port: "subscriptions",
    request: input,
  });
}
