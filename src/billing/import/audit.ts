import type { BillingSqlExecutor } from "../subject/repository.ts";
import type { BillingImportPlan, BillingImportRunReport } from "./types.ts";

export interface BillingImportAuditStore {
  completeRun(input: {
    id: string;
    report: BillingImportRunReport;
  }): Promise<void>;
  failRun(input: { id: string; error: string }): Promise<void>;
  recordCandidate(input: {
    bindingId?: string;
    correlationId?: string;
    plan: BillingImportPlan;
    runId: string;
    traceId?: string;
  }): Promise<void>;
  startRun(input: {
    causationId?: string;
    connectionId: string;
    correlationId?: string;
    cursorBefore?: string | null;
    provider: string;
    status: "running" | "dry_run";
    traceId?: string;
    trigger?: string;
  }): Promise<{ id: string }>;
}

let nextAuditId = 1;

export function createMemoryBillingImportAuditStore(): BillingImportAuditStore & {
  candidates: BillingImportPlan[];
  runs: Array<{
    completed?: BillingImportRunReport;
    error?: string;
    id: string;
    status: string;
  }>;
} {
  const runs: Array<{
    completed?: BillingImportRunReport;
    error?: string;
    id: string;
    status: string;
  }> = [];
  const candidates: BillingImportPlan[] = [];
  return {
    candidates,
    async completeRun(input) {
      const row = runs.find((item) => item.id === input.id);
      if (!row) {
        return;
      }
      row.status =
        input.report.status ?? (input.report.dryRun ? "dry_run" : "completed");
      row.completed = input.report;
    },
    async failRun(input) {
      const row = runs.find((item) => item.id === input.id);
      if (!row) {
        return;
      }
      row.status = "failed";
      row.error = input.error;
    },
    async recordCandidate(input) {
      candidates.push(input.plan);
    },
    runs,
    async startRun(input) {
      nextAuditId += 1;
      const id = `run_${nextAuditId}`;
      runs.push({ id, status: input.status });
      return { id };
    },
  };
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function createPostgresBillingImportAuditStore(
  sql: BillingSqlExecutor
): BillingImportAuditStore {
  return {
    async completeRun(input) {
      const { report } = input;
      await sql.query(
        `UPDATE billing.billing_import_runs SET
					status = $2,
					completed_at = now(),
					customers_scanned = $3,
					bindings_created = $4,
					bindings_activated = $5,
					conflicts = $6,
					skipped = $7,
					errors = $8,
					cursor_after = $9,
					pages_processed = $10,
					has_more = $11
				WHERE id = $1::uuid`,
        [
          input.id,
          report.dryRun ? "dry_run" : (report.status ?? "completed"),
          report.customersScanned,
          report.bindingsCreated,
          report.bindingsActivated,
          report.conflicts,
          report.skipped,
          report.errors,
          report.cursorAfter ?? null,
          report.pagesProcessed ?? 1,
          report.hasMore ?? false,
        ]
      );
      await sql.query(
        `INSERT INTO billing.billing_import_state (
					connection_id, resource_kind, cursor, last_completed_at, last_success_at, last_error
				) VALUES ($1::uuid, 'customers', $2, now(), now(), NULL)
				ON CONFLICT (connection_id, resource_kind) DO UPDATE SET
					cursor = COALESCE(EXCLUDED.cursor, billing.billing_import_state.cursor),
					last_completed_at = now(),
					last_success_at = now(),
					last_error = NULL`,
        [report.connectionId, report.cursorAfter ?? null]
      );
    },
    async failRun(input) {
      await sql.query(
        `UPDATE billing.billing_import_runs SET
					status = 'failed',
					completed_at = now(),
					errors = GREATEST(errors, 1),
					metadata = metadata || jsonb_build_object('last_error', $2::text)
				WHERE id = $1::uuid`,
        [input.id, input.error]
      );
      await sql.query(
        `UPDATE billing.billing_import_state SET
					last_completed_at = now(),
					last_error = $2
				WHERE connection_id = (
					SELECT connection_id FROM billing.billing_import_runs WHERE id = $1::uuid
				)
				AND resource_kind = 'customers'`,
        [input.id, input.error]
      );
    },
    async recordCandidate(input) {
      await sql.query(
        `INSERT INTO billing.billing_import_candidates (
					import_run_id,
					connection_id,
					provider_customer_id,
					subject_kind,
					subject_id,
					confidence,
					decision,
					evidence,
					reason,
					resolved_at,
					trace_id,
					correlation_id,
					binding_id
				) VALUES (
					$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9,
					CASE WHEN $10 THEN now() ELSE NULL END,
					$11, $12, $13::uuid
				)`,
        [
          input.runId,
          input.plan.connectionId,
          input.plan.providerCustomerId,
          input.plan.subject?.kind ?? null,
          input.plan.subject?.id ?? null,
          input.plan.confidence,
          input.plan.decision,
          jsonValue(input.plan.evidence),
          input.plan.reason,
          input.plan.decision === "bind",
          input.traceId ?? null,
          input.correlationId ?? null,
          input.bindingId ?? null,
        ]
      );
    },
    async startRun(input) {
      const result = await sql.query(
        `INSERT INTO billing.billing_import_runs (
					connection_id, provider, status, cursor_before, metadata,
					trace_id, correlation_id, causation_id, trigger
				) VALUES ($1::uuid, $2, $3, $4, '{}'::jsonb, $5, $6, $7, $8)
				RETURNING id`,
        [
          input.connectionId,
          input.provider,
          input.status,
          input.cursorBefore ?? null,
          input.traceId ?? null,
          input.correlationId ?? null,
          input.causationId ?? null,
          input.trigger ?? null,
        ]
      );
      const id = result.rows[0]?.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("Failed to start billing import run.");
      }
      await sql.query(
        `INSERT INTO billing.billing_import_state (
					connection_id, resource_kind, last_started_at, last_error
				) VALUES ($1::uuid, 'customers', now(), NULL)
				ON CONFLICT (connection_id, resource_kind) DO UPDATE SET
					last_started_at = now(),
					last_error = NULL`,
        [input.connectionId]
      );
      return { id };
    },
  };
}
