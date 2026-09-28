export function shouldAutomaticallyImportBillingCustomers(input?: {
  enabled?: boolean;
  mode?: "automatic" | "manual";
}): boolean {
  if (input?.enabled !== true) {
    return false;
  }
  return input.mode !== "manual";
}

export function scheduleDeferredBillingCustomerImport(input: {
  delayMs?: number;
  enabled: boolean;
  mode?: "automatic" | "manual";
  run: () => Promise<void>;
}): { cancel(): void } | null {
  if (!shouldAutomaticallyImportBillingCustomers(input)) {
    return null;
  }
  const delayMs = input.delayMs ?? 60_000;
  const timer = setTimeout(() => {
    void input.run();
  }, delayMs);
  timer.unref?.();
  return {
    cancel() {
      clearTimeout(timer);
    },
  };
}
