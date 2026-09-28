import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingSqlExecutor } from "./repository.ts";

export type ActiveBillingConnectionResolution =
  | { status: "none" }
  | { status: "ready"; connectionId: string }
  | { status: "ambiguous" };

/**
 * Active billing connection when exactly one row exists.
 * Zero and many active rows are distinct outcomes — never collapsed.
 */
export async function resolveActiveBillingConnection(
  sql: BillingSqlExecutor
): Promise<ActiveBillingConnectionResolution> {
  const result = await sql.query(
    `SELECT id::text AS id
			 FROM billing.billing_provider_connections
			 WHERE status = 'active'
			 LIMIT 2`
  );
  if (result.rows.length === 0) {
    return { status: "none" };
  }
  if (result.rows.length > 1) {
    return { status: "ambiguous" };
  }
  const id = result.rows[0]?.id;
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "none" };
  }
  return { connectionId: id, status: "ready" };
}

export function requireReadyBillingConnectionId(
  resolution: ActiveBillingConnectionResolution,
  operation: string
): string {
  if (resolution.status === "ready") {
    return resolution.connectionId;
  }
  if (resolution.status === "ambiguous") {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "provider_connection_ambiguous",
    });
  }
  throw new AthenaBillingCapabilityError({
    operation,
    reason: "provider_connection_missing",
  });
}
