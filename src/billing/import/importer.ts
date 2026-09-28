import type { AthenaBillingAuditWriter } from "../observability/audit.ts";
import type { BillingReconciliationContext } from "../observability/types.ts";
import {
  emitBillingAuditFailure,
  emitBillingImportSemanticAudit,
} from "../reconciliation/semantic-audit.ts";
import type { BillingImportPageResult } from "../reconciliation/types.ts";
import {
  applyBillingImportPlan,
  type BillingImportBindingStore,
  type BillingImportCursorStore,
  type BillingImportDocumentStore,
} from "./apply.ts";
import type { BillingImportAuditStore } from "./audit.ts";
import { readAthenaSubjectFromMetadata } from "./candidate-resolver.ts";
import {
  ATHENA_BILLING_IMPORT_PROVIDER_FAILED,
  AthenaBillingImportError,
} from "./errors.ts";
import { planBillingImport } from "./planner.ts";
import { reconcileBillingDocumentsForBinding } from "./project.ts";
import type { BillingCustomerImportPort } from "./providers/types.ts";
import type {
  BillingImportCustomer,
  BillingImportPlan,
  BillingImportPolicy,
  BillingImportRunReport,
  BillingSubjectDirectory,
} from "./types.ts";
import { DEFAULT_BILLING_IMPORT_POLICY } from "./types.ts";

export interface RunBillingCustomerImportInput {
  audit?: BillingImportAuditStore;
  bindings: BillingImportBindingStore;
  connectionId: string;
  context?: BillingReconciliationContext;
  cursor?: string;
  cursors?: BillingImportCursorStore;
  customerId?: string;
  directory: BillingSubjectDirectory;
  discovery: BillingCustomerImportPort;
  documents?: BillingImportDocumentStore;
  dryRun: boolean;
  includeAmbiguous?: boolean;
  limit?: number;
  persistCursor?: boolean;
  policy?: BillingImportPolicy;
  preloadedCustomers?: readonly BillingImportCustomer[];
  provider?: string;
  runId?: string;
  semanticAudit?: AthenaBillingAuditWriter;
  skipCursorAdvance?: boolean;
  subjectId?: string;
}

async function loadPage(
  discovery: BillingCustomerImportPort,
  input: { cursor?: string; customerId?: string; limit?: number }
): Promise<{
  items: readonly BillingImportCustomer[];
  nextCursor?: string | null;
}> {
  try {
    if (input.customerId && discovery.getCustomer) {
      const customer = await discovery.getCustomer({
        customerId: input.customerId,
      });
      return { items: [customer], nextCursor: null };
    }
    return await discovery.listCustomers(input);
  } catch (error) {
    if (error instanceof AthenaBillingImportError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "provider failed";
    throw new AthenaBillingImportError({
      code: ATHENA_BILLING_IMPORT_PROVIDER_FAILED,
      message,
    });
  }
}

export async function applyBillingImportCustomers(input: {
  audit?: BillingImportAuditStore;
  bindings: BillingImportBindingStore;
  connectionId: string;
  context?: BillingReconciliationContext;
  customerId?: string;
  directory: BillingSubjectDirectory;
  documents?: BillingImportDocumentStore;
  dryRun: boolean;
  includeAmbiguous?: boolean;
  items: readonly BillingImportCustomer[];
  policy: BillingImportPolicy;
  provider: string;
  runId?: string;
  semanticAudit?: AthenaBillingAuditWriter;
  subjectId?: string;
}): Promise<{
  bindingsActivated: number;
  bindingsCreated: number;
  conflicts: number;
  plans: BillingImportPlan[];
  scannedCustomers: BillingImportCustomer[];
  skipped: number;
}> {
  const plans: BillingImportPlan[] = [];
  let bindingsCreated = 0;
  let bindingsActivated = 0;
  let conflicts = 0;
  let skipped = 0;
  const scannedCustomers: BillingImportCustomer[] = [];
  const persistAudit = input.audit != null && !input.dryRun;

  for (const customer of input.items) {
    if (input.customerId && customer.providerCustomerId !== input.customerId) {
      continue;
    }
    scannedCustomers.push(customer);
    const metadataSubject = readAthenaSubjectFromMetadata(customer.metadata);
    const directorySubject = metadataSubject
      ? await input.directory.getById(metadataSubject)
      : null;
    const email = customer.email?.trim();
    const emailMatches = email
      ? await input.directory.findUsersByEmail(email)
      : [];
    const existingLocator = await input.bindings.findByLocator({
      connectionId: input.connectionId,
      providerCustomerId: customer.providerCustomerId,
    });
    const proposed =
      directorySubject?.subject ??
      (emailMatches.length === 1 ? emailMatches[0]?.subject : undefined);
    const existingPrimary = proposed
      ? await input.bindings.findActivePrimary({
          connectionId: input.connectionId,
          subject: proposed,
        })
      : null;
    const documentHints = input.documents
      ? await input.documents.hintsForCustomer({
          connectionId: input.connectionId,
          providerCustomerId: customer.providerCustomerId,
        })
      : [];
    const uniqueMatch = emailMatches.length === 1 ? emailMatches[0] : undefined;
    const plan = planBillingImport({
      connectionId: input.connectionId,
      customer,
      directorySubject,
      documentHints,
      emailMatches,
      emailVerification:
        uniqueMatch?.emailVerified === true && email
          ? {
              issuer: "athena.auth",
              normalizedEmail: email.trim().toLowerCase(),
              source: "athena.directory",
              verified: true,
              verifiedAt: new Date().toISOString(),
            }
          : null,
      existingLocator,
      existingPrimary,
      policy: input.policy ?? DEFAULT_BILLING_IMPORT_POLICY,
    });
    if (input.subjectId && plan.subject?.id !== input.subjectId) {
      continue;
    }
    if (
      plan.confidence === "ambiguous" &&
      input.includeAmbiguous !== true &&
      plan.decision !== "conflict"
    ) {
      skipped += 1;
      continue;
    }
    plans.push(plan);
    if (persistAudit && input.audit && input.runId) {
      await input.audit.recordCandidate({
        correlationId: input.context?.correlationId,
        plan,
        runId: input.runId,
        traceId: input.context?.traceId,
      });
    }
    if (input.dryRun) {
      continue;
    }
    try {
      const applied = await applyBillingImportPlan(input.bindings, {
        emailSnapshot: customer.email,
        plan,
      });
      if (applied === "created") {
        bindingsCreated += 1;
      } else if (applied === "activated") {
        bindingsActivated += 1;
      } else if (applied === "conflict") {
        conflicts += 1;
      } else {
        skipped += 1;
      }
      let projectionConflicts = 0;
      if (
        applied === "created" ||
        applied === "activated" ||
        plan.action === "noop"
      ) {
        const subject = plan.subject;
        if (subject && input.documents) {
          const projection = await reconcileBillingDocumentsForBinding(
            input.documents,
            {
              connectionId: input.connectionId,
              providerCustomerId: customer.providerCustomerId,
              subject,
            }
          );
          projectionConflicts = projection.conflicts;
          conflicts += projection.conflicts;
        }
      }
      if (input.semanticAudit && input.context) {
        await emitBillingImportSemanticAudit({
          applied,
          context: input.context,
          plan,
          previous: existingLocator,
          projectionConflicts,
          writer: input.semanticAudit,
        });
      }
    } catch (error) {
      if (input.semanticAudit && input.context) {
        await emitBillingAuditFailure({
          context: input.context,
          error,
          providerCustomerId: customer.providerCustomerId,
          subject: plan.subject,
          writer: input.semanticAudit,
        });
      }
      throw error;
    }
  }

  return {
    bindingsActivated,
    bindingsCreated,
    conflicts,
    plans,
    scannedCustomers,
    skipped,
  };
}

export async function runBillingCustomerImportPage(
  input: RunBillingCustomerImportInput
): Promise<BillingImportPageResult> {
  const policy = input.policy ?? DEFAULT_BILLING_IMPORT_POLICY;
  const cursorBefore =
    input.cursor ?? (await input.cursors?.get(input.connectionId)) ?? null;
  const page =
    input.preloadedCustomers == null
      ? await loadPage(input.discovery, {
          cursor: cursorBefore ?? undefined,
          customerId: input.customerId,
          limit: input.limit,
        })
      : {
          items: input.preloadedCustomers,
          nextCursor: null as string | null,
        };
  const applied = await applyBillingImportCustomers({
    audit: input.audit,
    bindings: input.bindings,
    connectionId: input.connectionId,
    context: input.context,
    customerId: input.customerId,
    directory: input.directory,
    documents: input.documents,
    dryRun: input.dryRun,
    includeAmbiguous: input.includeAmbiguous,
    items: page.items,
    policy,
    provider: input.provider ?? "mollie",
    runId: input.runId,
    semanticAudit: input.semanticAudit,
    subjectId: input.subjectId,
  });
  const nextCursor = page.nextCursor ?? null;
  const persistCursor =
    input.persistCursor !== false &&
    !input.dryRun &&
    !input.skipCursorAdvance &&
    input.customerId == null &&
    input.cursors != null;
  if (persistCursor && input.cursors) {
    await input.cursors.set(input.connectionId, nextCursor);
  }
  return {
    bindingsActivated: applied.bindingsActivated,
    bindingsCreated: applied.bindingsCreated,
    conflicts: applied.conflicts,
    cursorAfter: persistCursor ? nextCursor : cursorBefore,
    cursorBefore,
    customersScanned: applied.scannedCustomers.length,
    hasMore: nextCursor != null && nextCursor.length > 0,
    plans: applied.plans,
    skipped: applied.skipped,
  };
}

export async function runBillingCustomerImport(
  input: RunBillingCustomerImportInput
): Promise<BillingImportRunReport> {
  const persistAudit = input.audit != null && !input.dryRun;
  const cursorBefore =
    input.cursor ?? (await input.cursors?.get(input.connectionId)) ?? null;
  let runId: string | undefined;
  if (persistAudit && input.audit) {
    const started = await input.audit.startRun({
      causationId: input.context?.causationId,
      connectionId: input.connectionId,
      correlationId: input.context?.correlationId,
      cursorBefore,
      provider: input.provider ?? "mollie",
      status: "running",
      traceId: input.context?.traceId,
      trigger: input.context?.trigger,
    });
    runId = started.id;
  }
  try {
    const page = await runBillingCustomerImportPage({
      ...input,
      runId,
    });
    const report: BillingImportRunReport = {
      bindingsActivated: page.bindingsActivated,
      bindingsCreated: page.bindingsCreated,
      conflicts: page.conflicts,
      connectionId: input.connectionId,
      correlationId: input.context?.correlationId,
      cursorAfter: page.cursorAfter,
      cursorBefore: page.cursorBefore,
      customersScanned: page.customersScanned,
      dryRun: input.dryRun,
      errors: 0,
      hasMore: page.hasMore,
      pagesProcessed: 1,
      plans: page.plans,
      runId,
      skipped: page.skipped,
      status: page.conflicts > 0 ? "completed_with_conflicts" : "completed",
      traceId: input.context?.traceId,
    };
    if (persistAudit && input.audit && runId) {
      await input.audit.completeRun({ id: runId, report });
    }
    return report;
  } catch (error) {
    if (persistAudit && input.audit && runId) {
      const message = error instanceof Error ? error.message : "import failed";
      await input.audit.failRun({ error: message, id: runId });
    }
    throw error;
  }
}
