import type { BillingSqlExecutor } from "../subject/repository.ts";
import { throwIfMissingBillingObservabilityRelation } from "./schema-guard.ts";
import type { NormalizedAthenaBillingObservability } from "./types.ts";

export async function purgeBillingObservability(input: {
  now?: Date;
  observability: NormalizedAthenaBillingObservability;
  sql: BillingSqlExecutor;
}): Promise<void> {
  const now = input.now ?? new Date();
  const traceDays = input.observability.traces.retentionDays ?? 30;
  const auditDays = input.observability.auditRetentionDays;
  try {
    await input.sql.query(
      "DELETE FROM athena.traces_billing WHERE completed_at < $1::timestamptz",
      [new Date(now.getTime() - traceDays * 24 * 60 * 60 * 1000)]
    );
    await input.sql.query(
      "DELETE FROM billing.billing_import_runs WHERE started_at < $1::timestamptz",
      [new Date(now.getTime() - traceDays * 24 * 60 * 60 * 1000)]
    );
    await input.sql.query(
      `DELETE FROM billing.billing_import_candidates
			 WHERE created_at < $1::timestamptz`,
      [new Date(now.getTime() - traceDays * 24 * 60 * 60 * 1000)]
    );
    await input.sql.query(
      "DELETE FROM billing.billing_webhook_ingress_stages WHERE occurred_at < $1::timestamptz",
      [
        new Date(
          now.getTime() -
            input.observability.webhookIngressRetentionDays *
              24 *
              60 *
              60 *
              1000
        ),
      ]
    );
    await input.sql.query(
      "DELETE FROM billing.billing_webhook_ingress_rejections WHERE occurred_at < $1::timestamptz",
      [
        new Date(
          now.getTime() -
            input.observability.webhookIngressRetentionDays *
              24 *
              60 *
              60 *
              1000
        ),
      ]
    );
    if (auditDays != null) {
      await input.sql.query(
        "DELETE FROM athena.audit_log_billing WHERE created_at < $1::timestamptz",
        [new Date(now.getTime() - auditDays * 24 * 60 * 60 * 1000)]
      );
    }
  } catch (error) {
    throwIfMissingBillingObservabilityRelation(error);
  }
}
