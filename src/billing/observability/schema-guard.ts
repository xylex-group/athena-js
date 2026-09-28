import type { BillingSqlExecutor } from "../subject/repository.ts";

export const BILLING_WEBHOOK_INGRESS_STAGES_RELATION =
  "billing.billing_webhook_ingress_stages";
export const BILLING_WEBHOOK_INGRESS_REJECTIONS_RELATION =
  "billing.billing_webhook_ingress_rejections";

export const BILLING_WEBHOOK_OBSERVABILITY_LEDGER_VERSION = 22;

export function isUndefinedSqlRelation(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /relation ".*?" does not exist/i.test(message);
}

export function billingWebhookObservabilitySchemaMessage(
  missingRelation?: string
): string {
  const relation =
    missingRelation ?? BILLING_WEBHOOK_INGRESS_REJECTIONS_RELATION;
  return `Embedded Billing schema is behind the runtime. Run \`athena migrate\` (v${BILLING_WEBHOOK_OBSERVABILITY_LEDGER_VERSION} creates ${relation}).`;
}

export function rewriteMissingBillingObservabilityRelation(
  error: unknown
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const quoted = message.match(/relation "([^"]+)" does not exist/i);
  const missing = quoted?.[1];
  const wrapped = new Error(
    `${billingWebhookObservabilitySchemaMessage(missingRelationFromQuote(missing))} ${message}`
  );
  if (typeof error === "object" && error !== null && "code" in error) {
    (wrapped as { code?: string }).code = (error as { code?: string }).code;
  }
  return wrapped;
}

function missingRelationFromQuote(
  quoted: string | undefined
): string | undefined {
  if (quoted == null) {
    return;
  }
  if (quoted.includes("ingress_rejections")) {
    return BILLING_WEBHOOK_INGRESS_REJECTIONS_RELATION;
  }
  if (quoted.includes("ingress_stages")) {
    return BILLING_WEBHOOK_INGRESS_STAGES_RELATION;
  }
  return quoted.includes(".") ? quoted : `billing.${quoted}`;
}

export async function assertBillingWebhookObservabilitySchema(
  sql: BillingSqlExecutor
): Promise<void> {
  for (const relation of [
    BILLING_WEBHOOK_INGRESS_STAGES_RELATION,
    BILLING_WEBHOOK_INGRESS_REJECTIONS_RELATION,
  ] as const) {
    const result = await sql.query("SELECT to_regclass($1) AS oid", [relation]);
    const oid = result.rows[0]?.oid;
    if (oid == null || String(oid).length === 0) {
      throw new Error(billingWebhookObservabilitySchemaMessage(relation));
    }
  }
}

export function throwIfMissingBillingObservabilityRelation(
  error: unknown
): never {
  if (isUndefinedSqlRelation(error)) {
    throw rewriteMissingBillingObservabilityRelation(error);
  }
  throw error;
}

export function withBillingObservabilitySchemaGuard(
  sql: BillingSqlExecutor
): BillingSqlExecutor {
  return {
    async query(text, values) {
      try {
        return await sql.query(text, values);
      } catch (error) {
        throwIfMissingBillingObservabilityRelation(error);
      }
    },
  };
}
