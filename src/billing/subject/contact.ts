export type VerifiedBillingContactSource = "athena-auth";

export interface VerifiedBillingContact {
  email: string;
  source: VerifiedBillingContactSource;
  subjectId: string;
  verifiedEmailObservedAt: string;
}

export function createVerifiedBillingContact(input: {
  email: string;
  source: VerifiedBillingContactSource;
  subjectId: string;
  verifiedEmailObservedAt: string | Date | null;
}): VerifiedBillingContact {
  const email = input.email.trim();
  const subjectId = input.subjectId.trim();
  const verifiedEmailObservedAt =
    input.verifiedEmailObservedAt instanceof Date
      ? input.verifiedEmailObservedAt.toISOString()
      : input.verifiedEmailObservedAt?.trim() ?? "";
  if (!email || !subjectId || !verifiedEmailObservedAt) {
    throw new Error(
      "A verified Billing contact requires an email, subject, and observation time.",
    );
  }
  if (input.source !== "athena-auth") {
    throw new Error("Billing contact provenance must come from Athena Auth.");
  }
  if (!Number.isFinite(Date.parse(verifiedEmailObservedAt))) {
    throw new Error("Billing contact observation time is invalid.");
  }
  return {
    email,
    source: input.source,
    subjectId,
    verifiedEmailObservedAt,
  };
}
