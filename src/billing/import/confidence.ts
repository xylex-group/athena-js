import type {
  BillingImportConfidence,
  BillingImportEvidence,
} from "./types.ts";

export function confidenceFromEvidence(
  evidence: readonly BillingImportEvidence[],
  emailMatchCount: number,
  metadataSubjectResolved: boolean
): BillingImportConfidence {
  if (
    evidence.some((item) => item.kind === "provider_metadata_subject_id") &&
    metadataSubjectResolved
  ) {
    return "exact";
  }
  if (
    evidence.some(
      (item) =>
        item.kind === "historical_payment" ||
        item.kind === "historical_subscription"
    )
  ) {
    return "strong";
  }
  if (evidence.some((item) => item.kind === "email") && emailMatchCount === 1) {
    return "strong";
  }
  if (emailMatchCount > 1) {
    return "ambiguous";
  }
  return "none";
}
