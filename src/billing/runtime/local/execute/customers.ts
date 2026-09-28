import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCreateCustomerInput,
  BillingCustomer,
  BillingDeleteCustomerInput,
  BillingGetCustomerInput,
  BillingListCustomersInput,
  BillingUpdateCustomerInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset } from "./shared.ts";

export async function executeLocalBillingCustomerCreate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCreateCustomerInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingCustomer> {
  return executeLocalBillingOperation({
    invoke: (customers, context, payload) =>
      customers.create(context, {
        ...(payload.email == null ? {} : { email: payload.email }),
        idempotencyKey: payload.idempotencyKey,
        metadata: payload.metadata,
        name: payload.name,
      }),
    operation: "customers.create",
    port: "customers",
    request: input,
    safety: "defer-then-finalize",
  });
}

export async function executeLocalBillingCustomerGet(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingGetCustomerInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingCustomer> {
  return executeLocalBillingOperation({
    invoke: (customers, context, payload) =>
      customers.get(context, { id: payload.id }),
    operation: "customers.get",
    port: "customers",
    request: input,
  });
}

export async function executeLocalBillingCustomerList(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListCustomersInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingCustomer>> {
  return executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("customers.list", payload.offset),
    invoke: (customers, context, payload) =>
      customers.list(context, {
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    operation: "customers.list",
    port: "customers",
    request: input,
  });
}

export async function executeLocalBillingCustomerUpdate(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingUpdateCustomerInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingCustomer> {
  return executeLocalBillingOperation({
    invoke: (customers, context, payload) =>
      customers.update(context, {
        email: payload.email,
        id: payload.id,
        name: payload.name,
      }),
    operation: "customers.update",
    port: "customers",
    request: input,
  });
}

export async function executeLocalBillingCustomerDelete(input: {
  authority: import("../../invocation-authority.ts").BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingDeleteCustomerInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<void> {
  return executeLocalBillingOperation({
    invoke: async (customers, context, payload) => {
      await customers.delete(context, { id: payload.id });
    },
    operation: "customers.delete",
    port: "customers",
    request: input,
  });
}
