import type { AthenaBillingEventDefinition } from "./events.ts";
import type { AthenaBillingAuditEntry } from "./types.ts";

const BILLING_AUDIT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AthenaBillingAuditError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AthenaBillingAuditError";
    this.code = code;
  }
}

export function assertBillingAuditUuid(value: string, code: string): void {
  if (!BILLING_AUDIT_UUID.test(value)) {
    throw new AthenaBillingAuditError(code);
  }
}

export function mintBillingAuditIdentity(): {
  eventId: string;
  id: string;
} {
  return {
    eventId: crypto.randomUUID(),
    id: crypto.randomUUID(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isPresentSnapshot(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const record = asRecord(value);
  if (record && Object.keys(record).length === 0) {
    return false;
  }
  return true;
}

function isRunLevelAuditEvent(
  event: AthenaBillingAuditEntry["event"]
): boolean {
  return (
    event === "billing.reconciliation.cursor.reset" ||
    event === "billing.reconciliation.failed"
  );
}

export function validateBillingAuditEntry(
  entry: AthenaBillingAuditEntry,
  ir: Pick<
    AthenaBillingEventDefinition,
    "mutationKind" | "previous" | "result" | "subjectType"
  >
): void {
  assertBillingAuditUuid(entry.id, "ATHENA_BILLING_AUDIT_INVALID_ID");
  assertBillingAuditUuid(
    entry.eventId,
    "ATHENA_BILLING_AUDIT_INVALID_EVENT_ID"
  );
  assertBillingAuditUuid(
    entry.connectionId,
    "ATHENA_BILLING_AUDIT_INVALID_CONNECTION_ID"
  );
  if (entry.outcome !== "success" && entry.outcome !== "failure") {
    throw new AthenaBillingAuditError("ATHENA_BILLING_AUDIT_INVALID_OUTCOME");
  }
  if (!isPresentSnapshot(entry.result)) {
    throw new AthenaBillingAuditError("ATHENA_BILLING_AUDIT_RESULT_REQUIRED");
  }
  if (
    entry.outcome === "success" &&
    ir.result === "resource" &&
    asRecord(entry.result) === null
  ) {
    throw new AthenaBillingAuditError("ATHENA_BILLING_AUDIT_INVALID_RESULT");
  }
  if (
    entry.outcome === "success" &&
    ir.previous === "required" &&
    !isPresentSnapshot(entry.previous)
  ) {
    throw new AthenaBillingAuditError("ATHENA_BILLING_AUDIT_PREVIOUS_REQUIRED");
  }
  if (
    !isRunLevelAuditEvent(entry.event) &&
    ir.subjectType !== "billing_webhook_registration" &&
    (typeof entry.subject?.id !== "string" ||
      entry.subject.id.length === 0 ||
      (entry.subject.kind !== "user" && entry.subject.kind !== "organization"))
  ) {
    throw new AthenaBillingAuditError("ATHENA_BILLING_AUDIT_SUBJECT_REQUIRED");
  }
  if (
    typeof entry.connectionId !== "string" ||
    entry.connectionId.length === 0 ||
    typeof entry.provider !== "string" ||
    entry.provider.length === 0
  ) {
    throw new AthenaBillingAuditError(
      "ATHENA_BILLING_AUDIT_CONNECTION_REQUIRED"
    );
  }
  if (ir.subjectType === "billing_webhook_registration") {
    if (
      typeof entry.providerSubject?.id !== "string" ||
      entry.providerSubject.id.length === 0 ||
      entry.providerSubject.kind !== "webhook"
    ) {
      throw new AthenaBillingAuditError(
        "ATHENA_BILLING_AUDIT_PROVIDER_SUBJECT_REQUIRED"
      );
    }
  } else if (
    !isRunLevelAuditEvent(entry.event) &&
    (typeof entry.providerSubject?.id !== "string" ||
      entry.providerSubject.id.length === 0 ||
      entry.providerSubject.kind !== "customer")
  ) {
    throw new AthenaBillingAuditError(
      "ATHENA_BILLING_AUDIT_PROVIDER_SUBJECT_REQUIRED"
    );
  }
}
