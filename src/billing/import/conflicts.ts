export type BillingBindingConflictReason =
  | "multiple_email_matches"
  | "existing_active_binding"
  | "provider_customer_claimed"
  | "identity_changed"
  | "ambiguous_import"
  | "manual_review_required";

export interface BillingBindingConflictRecord {
  candidateProviderCustomerId: string;
  confidence: string;
  connectionId: string;
  reason: BillingBindingConflictReason;
  status: "open" | "resolved";
  subjectId?: string;
  subjectKind?: "user" | "organization";
}

export function uniqueEmailAutoBindConflictReason(): BillingBindingConflictReason {
  return "manual_review_required";
}
