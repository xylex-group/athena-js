import type { BillingSubjectRef } from "../types.ts";
import type {
  VerifiedBillingContact,
  VerifiedBillingContactSource,
} from "./contact.ts";

export type BillingProviderName = "mollie" | "stripe" | (string & {});

export interface ProviderSubject {
  connectionId: string;
  provider: BillingProviderName;
  providerSubjectId: string;
  providerSubjectKind: "customer" | "recipient";
}

export interface BillingSubjectBindingRecord {
  connectionId: string;
  emailSnapshot: string | null;
  emailVerificationSource?: VerifiedBillingContactSource | null;
  verifiedEmailObservedAt?: string | null;
  id: string;
  isPrimary: boolean;
  providerSubjectId: string;
  providerSubjectKind: "customer" | "recipient";
  reservationToken?: string | null;
  source: "created" | "imported" | "reconciled";
  status: "pending" | "active" | "conflict" | "revoked";
  subjectId: string;
  subjectKind: "user" | "organization";
}

export interface BillingSqlExecutor {
  query(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
  transaction?<T>(
    fn: (sql: BillingSqlExecutor) => Promise<T>
  ): Promise<T>;
}

export interface BillingSubjectRepository {
  activate(input: {
    id: string;
    providerSubjectId: string;
    reservationToken?: string | null;
  }): Promise<BillingSubjectBindingRecord>;
  getBinding(id: string): Promise<BillingSubjectBindingRecord | undefined>;
  listActiveBindings(input: {
    connectionId: string;
    subject: BillingSubjectRef;
  }): Promise<readonly BillingSubjectBindingRecord[]>;
  reserve(input: {
    connectionId: string;
    providerSubjectId?: string;
    providerSubjectKind: "customer" | "recipient";
    source: "created" | "imported" | "reconciled";
    subject: BillingSubjectRef;
    contact?: VerifiedBillingContact;
  }): Promise<{
    binding: BillingSubjectBindingRecord;
    inserted: boolean;
  }>;
  recordContact(input: {
    bindingId: string;
    contact: VerifiedBillingContact;
  }): Promise<BillingSubjectBindingRecord | undefined>;
}

export function subjectKind(
  subject: BillingSubjectRef
): "user" | "organization" {
  return subject.kind;
}
