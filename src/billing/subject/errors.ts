export class AthenaBillingSubjectError extends Error {
  readonly code: string;
  readonly conflict?: string;
  readonly status: number;

  constructor(input: {
    code: string;
    conflict?: string;
    message: string;
    status: number;
  }) {
    super(input.message);
    this.name = "AthenaBillingSubjectError";
    this.code = input.code;
    this.status = input.status;
    if (input.conflict != null) {
      this.conflict = input.conflict;
    }
  }
}

export function billingSubjectNotFound(
  message = "Billing document not found."
): AthenaBillingSubjectError {
  return new AthenaBillingSubjectError({
    code: "ATHENA_BILLING_NOT_FOUND",
    message,
    status: 404,
  });
}

export function isAthenaBillingSubjectError(
  error: unknown
): error is AthenaBillingSubjectError {
  if (error instanceof AthenaBillingSubjectError) {
    return true;
  }
  if (error == null || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown; name?: unknown; status?: unknown };
  return (
    record.code === "ATHENA_BILLING_NOT_FOUND" ||
    record.name === "AthenaBillingSubjectError" ||
    (typeof record.code === "string" &&
      record.code.startsWith("ATHENA_BILLING_SUBJECT_") &&
      typeof record.status === "number")
  );
}

export function billingSubjectConflict(
  message = "Billing subject binding is in conflict."
): AthenaBillingSubjectError {
  return new AthenaBillingSubjectError({
    code: "ATHENA_BILLING_SUBJECT_CONFLICT",
    message,
    status: 409,
  });
}

export const SUBSCRIPTION_ALREADY_ACTIVE =
  "subscription_already_active" as const;

export function billingSubscriptionAlreadyActive(
  message = "An active subscription already exists for this subject."
): AthenaBillingSubjectError {
  return new AthenaBillingSubjectError({
    code: "ATHENA_BILLING_SUBJECT_CONFLICT",
    conflict: SUBSCRIPTION_ALREADY_ACTIVE,
    message,
    status: 409,
  });
}
