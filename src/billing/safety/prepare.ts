import type { BillingOperation } from "../runtime/capabilities.ts";
import { resolveBillingEnvironment } from "./environment.ts";
import { BILLING_OPERATION_SAFETY } from "./registry.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";
import { validateBillingOperationPayload } from "./validators.ts";

export interface PrepareBillingCommandInput {
  /** Defer caller-owned idempotency until after capability gating. */
  idempotency?: "enforce" | "defer";
  operation: BillingOperation;
  payload: unknown;
  testMode?: boolean;
}

export interface BillingPreparedCommand {
  readonly environment: {
    readonly name: "test" | "live";
    readonly testMode: boolean;
  };
  readonly operation: BillingOperation;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly profile: BillingOperationSafetyProfile;
}

export function prepareBillingCommand(
  input: PrepareBillingCommandInput
): BillingPreparedCommand {
  const profile = BILLING_OPERATION_SAFETY[input.operation];
  if (profile == null) {
    throw new Error(`ATHENA_BILLING_OPERATION_UNKNOWN:${input.operation}`);
  }
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  });
  const payload = validateBillingOperationPayload({
    deferIdempotency: input.idempotency === "defer",
    operation: input.operation,
    payload: input.payload,
    profile,
  });
  return Object.freeze({
    environment: Object.freeze({
      name: environment.name,
      testMode: environment.testMode,
    }),
    operation: input.operation,
    payload: Object.freeze(payload),
    profile,
  });
}

/** Enforce deferred idempotency after capability and authority have been resolved. */
export function finalizeBillingCommand(
  input: Omit<PrepareBillingCommandInput, "idempotency">
): BillingPreparedCommand {
  return prepareBillingCommand({
    ...input,
    idempotency: "enforce",
  });
}
