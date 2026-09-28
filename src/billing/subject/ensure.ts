import type { BillingSubjectRef } from "../types.ts";
import type { BillingSubjectRepository } from "./repository.ts";

/**
 * Reserve a pending provider customer for an Athena subject.
 * Persistence keys: subject_kind + subject_id. email is never a lookup key
 * and never auto-binds (Auth user directory lookup is import-only).
 */
export async function ensureSubjectCustomer(input: {
  connectionId: string;
  repository: BillingSubjectRepository;
  subject: BillingSubjectRef;
}): Promise<void> {
  const existing = await input.repository.listActiveBindings({
    connectionId: input.connectionId,
    subject: input.subject,
  });
  if (existing.length > 0) {
    return;
  }
  await input.repository.reserve({
    connectionId: input.connectionId,
    providerSubjectKind: "customer",
    source: "created",
    subject: input.subject,
  });
}
