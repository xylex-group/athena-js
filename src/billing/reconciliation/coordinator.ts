import type { BillingImportCursorStore } from "../import/apply.ts";
import type { BillingImportAuditStore } from "../import/audit.ts";
import type { AthenaBillingAuditWriter } from "../observability/audit.ts";
import type { AthenaBillingTraceRecorder } from "../observability/traces.ts";
import { runWithBillingTrace } from "../observability/traces.ts";
import type { BillingReconciliationContext } from "../observability/types.ts";
import type { BillingSqlExecutor } from "../subject/repository.ts";
import { runWithBillingReconciliationContext } from "./context.ts";
import type { BillingReconciliationLeaseStore } from "./lease.ts";
import {
  BILLING_RECONCILIATION_RESOURCE_CUSTOMERS,
  billingReconciliationLeaseTtlMs,
} from "./lease.ts";
import {
  reconciliationBudgetExhausted,
  resolveBillingReconciliationLimits,
} from "./policy.ts";
import { BILLING_RECONCILIATION_RESOURCE_KINDS } from "./resources.ts";
import {
  AthenaBillingReconciliationError,
  classifyBillingReconciliationFailure,
} from "./retry.ts";
import { emitBillingAuditFailure } from "./semantic-audit.ts";
import type {
  BillingImportPageResult,
  BillingImportRunStatus,
  BillingReconciliationLimits,
  BillingReconciliationRunResult,
  ResolvedBillingProviderConnection,
} from "./types.ts";

export interface ReconcileBillingCustomersInput {
  audit?: BillingImportAuditStore;
  connection: ResolvedBillingProviderConnection;
  context: BillingReconciliationContext;
  cursors?: BillingImportCursorStore;
  dryRun?: boolean;
  lease?: BillingReconciliationLeaseStore;
  limits?: Partial<BillingReconciliationLimits>;
  ownerId?: string;
  rootSql: BillingSqlExecutor;
  runPage: (input: {
    cursor: string | null;
    limit: number;
    sql: BillingSqlExecutor;
  }) => Promise<BillingImportPageResult>;
  semanticAudit?: AthenaBillingAuditWriter;
  traces?: AthenaBillingTraceRecorder;
  transaction?: <T>(fn: (tx: BillingSqlExecutor) => Promise<T>) => Promise<T>;
}

export async function reconcileBillingCustomers(
  input: ReconcileBillingCustomersInput
): Promise<BillingReconciliationRunResult> {
  const limits = resolveBillingReconciliationLimits(input.limits);
  const dryRun = input.dryRun === true;
  const ownerId = input.ownerId ?? crypto.randomUUID();
  const startedMs = performance.now();
  const cursorBefore = (await input.cursors?.get(input.connection.id)) ?? null;
  const trace = input.traces?.start({
    causationId: input.context.causationId,
    connectionId: input.connection.id,
    correlationId: input.context.correlationId,
    operation: "customer.reconcile",
    provider: input.connection.provider,
    traceId: input.context.traceId,
    trigger: input.context.trigger,
  });

  const run = async (): Promise<BillingReconciliationRunResult> => {
    let leaseEpoch: number | undefined;
    if (!dryRun && input.lease) {
      const leasePhase = trace?.phase("lease");
      const acquired = await input.lease.acquire({
        connectionId: input.connection.id,
        ownerId,
        resourceKind:
          BILLING_RECONCILIATION_RESOURCE_KINDS.find(
            (kind) => kind === BILLING_RECONCILIATION_RESOURCE_CUSTOMERS
          ) ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS,
        ttlMs: billingReconciliationLeaseTtlMs(limits.maxDurationMs),
      });
      leasePhase?.finish();
      if (!acquired) {
        throw new AthenaBillingReconciliationError({
          kind: "lease_lost",
          message: "Another reconciler holds the customers lease.",
        });
      }
      leaseEpoch = acquired.epoch;
    }

    let runId: string | undefined;
    if (!dryRun && input.audit) {
      const started = await input.audit.startRun({
        causationId: input.context.causationId,
        connectionId: input.connection.id,
        correlationId: input.context.correlationId,
        cursorBefore,
        provider: input.connection.provider,
        status: "running",
        traceId: input.context.traceId,
        trigger: input.context.trigger,
      });
      runId = started.id;
    }

    let pagesProcessed = 0;
    let customersScanned = 0;
    let bindingsCreated = 0;
    let bindingsActivated = 0;
    let conflicts = 0;
    let skipped = 0;
    let cursor = cursorBefore;
    let cursorAfter = cursorBefore;
    let hasMore = true;
    const plans: BillingImportPageResult["plans"][number][] = [];
    let status: BillingImportRunStatus = "running";

    try {
      while (hasMore) {
        if (
          pagesProcessed > 0 &&
          reconciliationBudgetExhausted({
            customersScanned,
            elapsedMs: performance.now() - startedMs,
            limits,
            pagesProcessed,
          })
        ) {
          status = "checkpointed";
          hasMore = true;
          break;
        }

        const runOnce = async (sql: BillingSqlExecutor) => {
          if (!dryRun && input.lease) {
            const held = await input.lease.heartbeat({
              connectionId: input.connection.id,
              ...(leaseEpoch === null ? {} : { epoch: leaseEpoch }),
              ownerId,
              resourceKind:
                BILLING_RECONCILIATION_RESOURCE_KINDS.find(
                  (kind) => kind === BILLING_RECONCILIATION_RESOURCE_CUSTOMERS
                ) ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS,
              ttlMs: billingReconciliationLeaseTtlMs(limits.maxDurationMs),
            });
            if (!held) {
              throw new AthenaBillingReconciliationError({
                kind: "lease_lost",
                message: "Reconciliation lease was lost.",
              });
            }
          }
          return input.runPage({
            cursor,
            limit: limits.pageSize,
            sql,
          });
        };
        const page = input.transaction
          ? await input.transaction(runOnce)
          : await runOnce(input.rootSql);

        pagesProcessed += 1;
        customersScanned += page.customersScanned;
        bindingsCreated += page.bindingsCreated;
        bindingsActivated += page.bindingsActivated;
        conflicts += page.conflicts;
        skipped += page.skipped;
        plans.push(...page.plans);
        cursor = page.cursorAfter;
        cursorAfter = page.cursorAfter;
        hasMore = page.hasMore;
        trace?.setCounters({ customersScanned, pagesProcessed });

        if (!hasMore) {
          status = conflicts > 0 ? "completed_with_conflicts" : "completed";
          break;
        }
        if (
          reconciliationBudgetExhausted({
            customersScanned,
            elapsedMs: performance.now() - startedMs,
            limits,
            pagesProcessed,
          })
        ) {
          status = "checkpointed";
          break;
        }
      }

      const result: BillingReconciliationRunResult = {
        bindingsActivated,
        bindingsCreated,
        conflicts,
        connectionId: input.connection.id,
        correlationId: input.context.correlationId,
        cursorAfter,
        cursorBefore,
        customersScanned,
        dryRun,
        environment: input.connection.environment,
        errors: 0,
        hasMore: status === "checkpointed" ? true : hasMore,
        pagesProcessed,
        plans,
        provider: input.connection.provider,
        runId,
        skipped,
        status: dryRun ? "dry_run" : status,
        traceId: input.context.traceId,
      };
      if (!dryRun && input.audit && runId) {
        await input.audit.completeRun({
          id: runId,
          report: {
            bindingsActivated,
            bindingsCreated,
            conflicts,
            connectionId: input.connection.id,
            correlationId: input.context.correlationId,
            cursorAfter,
            cursorBefore,
            customersScanned,
            dryRun,
            errors: 0,
            hasMore: result.hasMore,
            pagesProcessed,
            plans,
            runId,
            skipped,
            status: result.status,
            traceId: input.context.traceId,
          },
        });
      }
      try {
        await trace?.success();
      } catch (error) {
        console.error("[athena-billing] trace persistence failed", {
          error: error instanceof Error ? error.message : String(error),
          traceId: input.context.traceId,
        });
      }
      return result;
    } catch (error) {
      if (!dryRun && input.audit && runId) {
        const message =
          error instanceof Error ? error.message : "reconciliation failed";
        await input.audit.failRun({ error: message, id: runId });
      }
      if (!dryRun && input.semanticAudit) {
        try {
          await emitBillingAuditFailure({
            context: input.context,
            error,
            writer: input.semanticAudit,
          });
        } catch (auditError) {
          console.error("[athena-billing] failure audit persistence failed", {
            error:
              auditError instanceof Error
                ? auditError.message
                : String(auditError),
            traceId: input.context.traceId,
          });
        }
      }
      const kind = classifyBillingReconciliationFailure(error);
      await trace?.failure(error, kind === "lease_lost" ? "lease" : "apply");
      throw error;
    } finally {
      if (!dryRun && input.lease) {
        await input.lease.release({
          connectionId: input.connection.id,
          ownerId,
          resourceKind:
            BILLING_RECONCILIATION_RESOURCE_KINDS.find(
              (kind) => kind === BILLING_RECONCILIATION_RESOURCE_CUSTOMERS
            ) ?? BILLING_RECONCILIATION_RESOURCE_CUSTOMERS,
        });
      }
    }
  };

  return runWithBillingReconciliationContext(input.context, () =>
    trace ? runWithBillingTrace(trace, run) : run()
  );
}

export async function reconcileBillingCustomer(input: {
  connection: ResolvedBillingProviderConnection;
  context: BillingReconciliationContext;
  dryRun?: boolean;
  lease?: BillingReconciliationLeaseStore;
  runTargetedPage: (
    sql: BillingSqlExecutor
  ) => Promise<BillingImportPageResult>;
  rootSql: BillingSqlExecutor;
  semanticAudit?: AthenaBillingAuditWriter;
  traces?: AthenaBillingTraceRecorder;
  transaction?: <T>(fn: (tx: BillingSqlExecutor) => Promise<T>) => Promise<T>;
}): Promise<BillingReconciliationRunResult> {
  return reconcileBillingCustomers({
    connection: input.connection,
    context: input.context,
    dryRun: input.dryRun,
    lease: input.lease,
    limits: {
      maxCustomers: 1,
      maxDurationMs: 30_000,
      maxPages: 1,
      pageSize: 1,
    },
    rootSql: input.rootSql,
    runPage: async ({ sql }) => input.runTargetedPage(sql),
    semanticAudit: input.semanticAudit,
    traces: input.traces,
    transaction: input.transaction,
  });
}
