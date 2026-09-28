import { fingerprintBillingSigningSecret } from "../ownership.ts";
import type {
  BillingWebhookSecretStore,
  BillingWebhookSigningSecretSet,
} from "./types.ts";

interface MemorySecretRow {
  fingerprint: string;
  secret: string;
  status: "current" | "previous" | "retired";
}

export function createMemoryBillingWebhookSecretStore(): BillingWebhookSecretStore {
  const rows = new Map<string, MemorySecretRow[]>();
  return {
    async resolve(connectionId) {
      return toSet(rows.get(connectionId) ?? []);
    },
    async rotate(input) {
      const previous = input.previous.map((secret) => ({
        fingerprint: fingerprintBillingSigningSecret(secret),
        secret,
        status: "previous" as const,
      }));
      rows.set(input.connectionId, [
        {
          fingerprint: fingerprintBillingSigningSecret(input.current),
          secret: input.current,
          status: "current",
        },
        ...previous,
      ]);
    },
    async storeCurrent(input) {
      const existing = rows.get(input.connectionId) ?? [];
      const next: MemorySecretRow[] = [];
      for (const row of existing) {
        if (row.fingerprint === input.fingerprint) {
          continue;
        }
        if (row.status === "current") {
          next.push({ ...row, status: "previous" });
          continue;
        }
        if (row.status === "previous") {
          next.push({ ...row, status: "retired" });
        }
      }
      next.unshift({
        fingerprint: input.fingerprint,
        secret: input.secret,
        status: "current",
      });
      rows.set(input.connectionId, next);
    },
  };
}

function toSet(
  rows: readonly MemorySecretRow[]
): BillingWebhookSigningSecretSet {
  const current = rows.find((row) => row.status === "current")?.secret;
  const previous = rows
    .filter((row) => row.status === "previous")
    .map((row) => row.secret);
  return {
    previous,
    ...(current ? { current } : {}),
  };
}
