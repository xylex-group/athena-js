import type { BillingSqlExecutor } from "../subject/repository.ts";

export const BILLING_RECONCILIATION_RESOURCE_CUSTOMERS = "customers" as const;
export const BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS =
  "webhook_registrations" as const;

export interface BillingReconciliationLease {
  connectionId: string;
  epoch: number;
  expiresAt: Date;
  ownerId: string;
  resourceKind: string;
}

export interface BillingReconciliationLeaseStore {
  acquire(input: {
    connectionId: string;
    ownerId: string;
    resourceKind?: string;
    ttlMs?: number;
  }): Promise<BillingReconciliationLease | null>;
  heartbeat(input: {
    connectionId: string;
    epoch?: number;
    ownerId: string;
    resourceKind?: string;
    ttlMs?: number;
  }): Promise<boolean>;
  release(input: {
    connectionId: string;
    ownerId: string;
    resourceKind?: string;
  }): Promise<void>;
}

const DEFAULT_TTL_MS = 120_000;
export const BILLING_RECONCILIATION_LEASE_TTL_BUFFER_MS = 30_000;

export function billingReconciliationLeaseTtlMs(maxDurationMs: number): number {
  return maxDurationMs + BILLING_RECONCILIATION_LEASE_TTL_BUFFER_MS;
}

export function createMemoryBillingReconciliationLeaseStore(now?: () => Date): {
  leases: Map<string, BillingReconciliationLease>;
  store: BillingReconciliationLeaseStore;
} {
  const clock = now ?? (() => new Date());
  const leases = new Map<string, BillingReconciliationLease>();
  const keyOf = (connectionId: string, resourceKind: string) =>
    `${connectionId}:${resourceKind}`;
  return {
    leases,
    store: {
      async acquire(input) {
        const resourceKind =
          input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
        const key = keyOf(input.connectionId, resourceKind);
        const existing = leases.get(key);
        const instant = clock();
        if (existing && existing.expiresAt > instant) {
          return null;
        }
        const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
        const nextEpoch = existing ? existing.epoch + 1 : 1;
        const lease: BillingReconciliationLease = {
          connectionId: input.connectionId,
          epoch: nextEpoch,
          expiresAt: new Date(instant.getTime() + ttlMs),
          ownerId: input.ownerId,
          resourceKind,
        };
        leases.set(key, lease);
        return lease;
      },
      async heartbeat(input) {
        const resourceKind =
          input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
        const key = keyOf(input.connectionId, resourceKind);
        const existing = leases.get(key);
        if (!existing || existing.ownerId !== input.ownerId) {
          return false;
        }
        if (input.epoch != null && existing.epoch !== input.epoch) {
          return false;
        }
        const instant = clock();
        if (existing.expiresAt <= instant) {
          return false;
        }
        const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
        existing.expiresAt = new Date(instant.getTime() + ttlMs);
        return true;
      },
      async release(input) {
        const resourceKind =
          input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
        const key = keyOf(input.connectionId, resourceKind);
        const existing = leases.get(key);
        if (existing && existing.ownerId === input.ownerId) {
          leases.delete(key);
        }
      },
    },
  };
}

export function createPostgresBillingReconciliationLeaseStore(
  sql: BillingSqlExecutor
): BillingReconciliationLeaseStore {
  return {
    async acquire(input) {
      const resourceKind =
        input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
      const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
      const result = await sql.query(
        `
INSERT INTO billing.billing_reconciliation_leases (
	connection_id, resource_kind, owner_id, acquired_at, heartbeat_at, expires_at, epoch
) VALUES (
	$1::uuid, $2, $3, now(), now(), now() + ($4::int * interval '1 millisecond'), 1
)
ON CONFLICT (connection_id, resource_kind) DO UPDATE SET
	owner_id = EXCLUDED.owner_id,
	acquired_at = now(),
	heartbeat_at = now(),
	expires_at = EXCLUDED.expires_at,
	epoch = billing.billing_reconciliation_leases.epoch + 1
WHERE billing.billing_reconciliation_leases.expires_at < now()
RETURNING connection_id::text AS connection_id, owner_id, resource_kind, expires_at, epoch
`,
        [input.connectionId, resourceKind, input.ownerId, ttlMs]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        connectionId: String(row.connection_id),
        epoch: Number(row.epoch ?? 0),
        expiresAt:
          row.expires_at instanceof Date
            ? row.expires_at
            : new Date(String(row.expires_at)),
        ownerId: String(row.owner_id),
        resourceKind: String(row.resource_kind),
      };
    },
    async heartbeat(input) {
      const resourceKind =
        input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
      const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
      const result = await sql.query(
        `
UPDATE billing.billing_reconciliation_leases SET
	heartbeat_at = now(),
	expires_at = now() + ($4::int * interval '1 millisecond')
WHERE connection_id = $1::uuid
  AND resource_kind = $2
  AND owner_id = $3
  AND expires_at > now()
  AND ($5::bigint IS NULL OR epoch = $5::bigint)
RETURNING owner_id
`,
        [
          input.connectionId,
          resourceKind,
          input.ownerId,
          ttlMs,
          input.epoch ?? null,
        ]
      );
      return result.rows.length > 0;
    },
    async release(input) {
      const resourceKind =
        input.resourceKind ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS;
      await sql.query(
        `
DELETE FROM billing.billing_reconciliation_leases
WHERE connection_id = $1::uuid
  AND resource_kind = $2
  AND owner_id = $3
`,
        [input.connectionId, resourceKind, input.ownerId]
      );
    },
  };
}
