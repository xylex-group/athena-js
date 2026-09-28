import type {
  BillingProviderCreateCustomerInput,
  BillingProviderGetResourceInput,
  BillingProviderUpdateCustomerInput,
} from "../../types.ts";

export function mapCreateCustomerToMollieSdk(input: {
  body: Record<string, unknown>;
  idempotencyKey?: string;
}): Record<string, unknown> {
  return {
    customerRequest: input.body,
    idempotencyKey: input.idempotencyKey,
  };
}

export function customerCreateBody(
  input: BillingProviderCreateCustomerInput
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name != null) {
    body.name = input.name;
  }
  if (input.email != null) {
    body.email = input.email;
  }
  if (input.metadata != null) {
    body.metadata = input.metadata;
  }
  return body;
}

export function mapGetCustomerToMollieSdk(
  input: BillingProviderGetResourceInput
): Record<string, unknown> {
  return { customerId: input.id };
}

export function mapUpdateCustomerToMollieSdk(
  input: BillingProviderUpdateCustomerInput
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name != null) {
    body.name = input.name;
  }
  if (input.email != null) {
    body.email = input.email;
  }
  return {
    customerId: input.id,
    customerRequest: body,
  };
}
