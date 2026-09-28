import type { BillingSubjectBindingRecord } from "../subject/repository.ts";
import type { BillingSubjectRef } from "../types.ts";

export type BillingImportConfidence = "exact" | "strong" | "ambiguous" | "none";

export type BillingImportDecision =
  | "bind"
  | "skip"
  | "conflict"
  | "manual_review";

export type BillingImportEvidenceKind =
  | "provider_metadata_subject_id"
  | "provider_metadata_external_id"
  | "email"
  | "historical_payment"
  | "historical_subscription";

export interface BillingImportEvidence {
  kind: BillingImportEvidenceKind;
  value?: string;
}

export interface BillingImportCandidate {
  confidence: BillingImportConfidence;
  connectionId: string;
  evidence: BillingImportEvidence[];
  providerCustomerId: string;
  subject?: BillingSubjectRef;
}

export interface BillingImportCustomer {
  email?: string | null;
  metadata: Record<string, unknown>;
  name?: string | null;
  providerCustomerId: string;
  raw: unknown;
}

export interface BillingImportCustomerPage {
  items: readonly BillingImportCustomer[];
  nextCursor?: string | null;
}

export interface BillingSubjectRecord {
  email?: string | null;
  emailVerified?: boolean;
  subject: BillingSubjectRef;
}

export interface BillingSubjectDirectory {
  findUsersByEmail(email: string): Promise<readonly BillingSubjectRecord[]>;
  getById(subject: BillingSubjectRef): Promise<BillingSubjectRecord | null>;
}

export interface BillingImportPolicy {
  allowSecondaryBindings: boolean;
  allowUniqueEmailAutoBind: boolean;
}

export const DEFAULT_BILLING_IMPORT_POLICY: BillingImportPolicy = {
  allowSecondaryBindings: false,
  allowUniqueEmailAutoBind: false,
};

export type BillingImportPlanAction =
  | "create_active_binding"
  | "noop"
  | "resume_pending"
  | "mark_conflict"
  | "none";

export interface BillingImportPlan {
  action: BillingImportPlanAction;
  candidates: readonly BillingSubjectRef[];
  confidence: BillingImportConfidence;
  connectionId: string;
  decision: BillingImportDecision;
  evidence: readonly BillingImportEvidence[];
  providerCustomerId: string;
  reason: string;
  source: "imported" | "reconciled";
  subject?: BillingSubjectRef;
}

export interface BillingImportDocumentHint {
  connectionId: string;
  ownershipStatus: "resolved" | "unresolved" | "conflict";
  providerCustomerId: string;
  subject?: BillingSubjectRef;
}

export interface BillingImportContext {
  connectionId: string;
  customer: BillingImportCustomer;
  directorySubject: BillingSubjectRecord | null;
  documentHints: readonly BillingImportDocumentHint[];
  emailMatches: readonly BillingSubjectRecord[];
  emailVerification?: {
    issuer: string;
    normalizedEmail: string;
    source: string;
    verified: boolean;
    verifiedAt: string;
  } | null;
  existingLocator: BillingSubjectBindingRecord | null;
  existingPrimary: BillingSubjectBindingRecord | null;
  policy: BillingImportPolicy;
}

export interface BillingImportRunReport {
  bindingsActivated: number;
  bindingsCreated: number;
  conflicts: number;
  connectionId: string;
  correlationId?: string;
  cursorAfter?: string | null;
  cursorBefore?: string | null;
  customersScanned: number;
  dryRun: boolean;
  environment?: "live" | "test";
  errors: number;
  hasMore?: boolean;
  pagesProcessed?: number;
  plans: readonly BillingImportPlan[];
  provider?: string;
  runId?: string;
  skipped: number;
  status?: string;
  traceId?: string;
}

export const ATHENA_SUBJECT_KIND_METADATA_KEY = "athenaSubjectKind";
export const ATHENA_SUBJECT_ID_METADATA_KEY = "athenaSubjectId";
export const ATHENA_EXTERNAL_ID_METADATA_KEY = "athenaExternalId";
