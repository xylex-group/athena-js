import { isAthenaBillingCredentialError } from "../errors.ts";
import { shouldAutomaticallyImportBillingCustomers } from "../import/automatic.ts";
import { AthenaBillingReconciliationError } from "./retry.ts";

export type BillingImportExecutionMode = "embedded" | "external";

export interface BillingReconciliationSchedule {
  intervalMs: number;
  jitterMs: number;
}

export interface BillingSchedulerHandle {
  cancel(): void;
  drain(): Promise<void>;
  runNow(trigger?: "bootstrap" | "scheduled"): Promise<void>;
}

export interface BillingDesiredScheduler {
  readonly enabled: boolean;
  readonly execution?: BillingImportExecutionMode;
  readonly isCurrent?: () => boolean;
  readonly key: string;
  readonly run: (trigger: "bootstrap" | "scheduled") => Promise<void>;
  readonly schedule?: Partial<BillingReconciliationSchedule>;
}

export interface BillingSchedulerSet {
  list(): readonly BillingSchedulerHandle[];
  reconcile(desired: readonly BillingDesiredScheduler[]): void;
  stop(key?: string): void;
}

export function createBillingSchedulerSet(): BillingSchedulerSet {
  const handles = new Map<string, BillingSchedulerHandle>();
  return {
    list() {
      return Object.freeze([...handles.values()]);
    },
    reconcile(desired) {
      const desiredKeys = new Set(
        desired.filter((entry) => entry.enabled).map((entry) => entry.key)
      );
      for (const [key, handle] of handles) {
        if (!desiredKeys.has(key)) {
          handle.cancel();
          handles.delete(key);
        }
      }
      for (const entry of desired) {
        if (!entry.enabled || handles.has(entry.key)) {
          continue;
        }
        const handle = registerEmbeddedBillingScheduler(entry);
        if (handle) {
          handles.set(entry.key, handle);
        }
      }
    },
    stop(key) {
      if (key == null) {
        for (const handle of handles.values()) {
          handle.cancel();
        }
        handles.clear();
        return;
      }
      const handle = handles.get(key);
      if (handle) {
        handle.cancel();
        handles.delete(key);
      }
    },
  };
}

export const DEFAULT_BILLING_RECONCILIATION_SCHEDULE: BillingReconciliationSchedule =
  {
    intervalMs: 600_000,
    jitterMs: 60_000,
  };

export const DEFAULT_BILLING_WEBHOOK_RECONCILIATION_SCHEDULE: BillingReconciliationSchedule =
  {
    intervalMs: 10_800_000,
    jitterMs: 300_000,
  };

export const DEFAULT_BILLING_PLAN_CHANGE_RECOVERY_SCHEDULE: BillingReconciliationSchedule =
  {
    intervalMs: 30_000,
    jitterMs: 1_000,
  };

function jitterDelay(jitterMs: number): number {
  if (jitterMs <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * jitterMs);
}

export function logEmbeddedBillingSchedulerError(error: unknown): void {
  const payload = {
    error: error instanceof Error ? error.message : String(error),
  };
  if (isAthenaBillingCredentialError(error)) {
    console.warn("[athena-billing] skipping scheduled reconciliation", payload);
    return;
  }
  if (
    error instanceof AthenaBillingReconciliationError &&
    error.kind === "lease_lost"
  ) {
    console.warn("[athena-billing] skipping scheduled reconciliation", payload);
    return;
  }
  console.error("[athena-billing] scheduled reconciliation failed", payload);
}

export function registerEmbeddedBillingScheduler(input: {
  enabled: boolean;
  execution?: BillingImportExecutionMode;
  isCurrent?: () => boolean;
  onError?: (error: unknown) => void;
  run: (trigger: "bootstrap" | "scheduled") => Promise<void>;
  schedule?: Partial<BillingReconciliationSchedule>;
}): BillingSchedulerHandle | null {
  if (!input.enabled) {
    return null;
  }
  if ((input.execution ?? "embedded") !== "embedded") {
    return null;
  }
  const intervalMs =
    input.schedule?.intervalMs ??
    DEFAULT_BILLING_RECONCILIATION_SCHEDULE.intervalMs;
  const jitterMs =
    input.schedule?.jitterMs ??
    DEFAULT_BILLING_RECONCILIATION_SCHEDULE.jitterMs;
  const onError = input.onError ?? logEmbeddedBillingSchedulerError;
  let cancelled = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  const runOnce = (trigger: "bootstrap" | "scheduled"): Promise<void> => {
    if (cancelled || running) {
      return running ?? Promise.resolve();
    }
    if (input.isCurrent && !input.isCurrent()) {
      return Promise.resolve();
    }
    const started = Promise.resolve().then(() => input.run(trigger));
    const tracked = started
      .catch((error) => {
        onError(error);
      })
      .finally(() => {
        running = undefined;
      });
    running = tracked;
    return tracked;
  };
  const runSafe = (trigger: "bootstrap" | "scheduled"): void => {
    void runOnce(trigger);
  };
  const bootstrap = setTimeout(() => {
    if (cancelled) {
      return;
    }
    runSafe("bootstrap");
    interval = setInterval(() => {
      if (!cancelled) {
        runSafe("scheduled");
      }
    }, intervalMs);
    interval.unref?.();
  }, jitterDelay(jitterMs));
  bootstrap.unref?.();
  return {
    cancel() {
      cancelled = true;
      clearTimeout(bootstrap);
      if (interval) {
        clearInterval(interval);
      }
    },
    async drain() {
      while (running) {
        await running;
      }
    },
    runNow(trigger = "scheduled") {
      return runOnce(trigger);
    },
  };
}

export function registerBillingReconciliationScheduler(input: {
  enabled: boolean;
  execution?: BillingImportExecutionMode;
  mode?: "automatic" | "manual";
  onError?: (error: unknown) => void;
  run: () => Promise<void>;
  schedule?: Partial<BillingReconciliationSchedule>;
}): BillingSchedulerHandle | null {
  if (!shouldAutomaticallyImportBillingCustomers(input)) {
    return null;
  }
  return registerEmbeddedBillingScheduler({
    enabled: true,
    execution: input.execution,
    onError: input.onError,
    run: () => input.run(),
    schedule: input.schedule,
  });
}
