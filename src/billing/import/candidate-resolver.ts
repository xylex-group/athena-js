import type { BillingSubjectRef } from "../types.ts";
import {
  ATHENA_EXTERNAL_ID_METADATA_KEY,
  ATHENA_SUBJECT_ID_METADATA_KEY,
  ATHENA_SUBJECT_KIND_METADATA_KEY,
  type BillingImportCustomer,
  type BillingImportEvidence,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readAthenaSubjectFromMetadata(
  metadata: Record<string, unknown>
): BillingSubjectRef | undefined {
  const id = readString(metadata[ATHENA_SUBJECT_ID_METADATA_KEY]);
  const kind = readString(metadata[ATHENA_SUBJECT_KIND_METADATA_KEY]);
  if (!id || (kind !== "user" && kind !== "organization")) {
    return;
  }
  return { id, kind };
}

export function collectProviderCustomerEvidence(
  customer: BillingImportCustomer
): BillingImportEvidence[] {
  const evidence: BillingImportEvidence[] = [];
  const metadata = isRecord(customer.metadata) ? customer.metadata : {};
  const subject = readAthenaSubjectFromMetadata(metadata);
  if (subject) {
    evidence.push({
      kind: "provider_metadata_subject_id",
      value: `${subject.kind}:${subject.id}`,
    });
  }
  const externalId = readString(metadata[ATHENA_EXTERNAL_ID_METADATA_KEY]);
  if (externalId) {
    evidence.push({
      kind: "provider_metadata_external_id",
      value: externalId,
    });
  }
  const email = readString(customer.email ?? undefined);
  if (email) {
    evidence.push({ kind: "email", value: email.toLowerCase() });
  }
  return evidence;
}

export function subjectsEqual(
  left: BillingSubjectRef,
  right: BillingSubjectRef
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
