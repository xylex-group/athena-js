import { AsyncLocalStorage } from "node:async_hooks";
import type { BillingReconciliationContext } from "../observability/types.ts";

const storage = new AsyncLocalStorage<BillingReconciliationContext>();

export function currentBillingReconciliationContext():
  | BillingReconciliationContext
  | undefined {
  return storage.getStore();
}

export function runWithBillingReconciliationContext<T>(
  context: BillingReconciliationContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(context, fn);
}

export function mintManualBillingReconciliationContext(input: {
  connectionId: string;
  provider: string;
  runId?: string;
  trigger?: "bootstrap" | "manual";
}): BillingReconciliationContext {
  const runId = input.runId ?? crypto.randomUUID();
  return {
    connectionId: input.connectionId,
    correlationId: runId,
    provider: input.provider,
    traceId: crypto.randomUUID(),
    trigger: input.trigger ?? "manual",
  };
}

export function mintScheduledBillingReconciliationContext(input: {
  connectionId: string;
  provider: string;
  schedulerExecutionId: string;
  runId?: string;
}): BillingReconciliationContext {
  return {
    causationId: input.schedulerExecutionId,
    connectionId: input.connectionId,
    correlationId: input.runId ?? crypto.randomUUID(),
    provider: input.provider,
    traceId: crypto.randomUUID(),
    trigger: "scheduled",
  };
}

export function inheritWebhookBillingReconciliationContext(input: {
  causationId: string;
  connectionId: string;
  correlationId: string;
  provider: string;
  traceId: string;
}): BillingReconciliationContext {
  return {
    causationId: input.causationId,
    connectionId: input.connectionId,
    correlationId: input.correlationId,
    provider: input.provider,
    traceId: input.traceId,
    trigger: "webhook",
  };
}
