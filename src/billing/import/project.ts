import type { BillingSubjectRef } from "../types.ts";
import type { BillingImportDocumentStore } from "./apply.ts";
import type { BillingImportDocumentHint } from "./types.ts";

export interface MemoryBillingDocument {
  connectionId: string;
  id: string;
  kind: "payment" | "subscription" | "invoice";
  ownershipStatus: "resolved" | "unresolved" | "conflict";
  providerCustomerId: string;
  subject?: BillingSubjectRef;
}

export function createMemoryBillingImportDocumentStore(
  documents: MemoryBillingDocument[]
): BillingImportDocumentStore & { documents: MemoryBillingDocument[] } {
  return {
    documents,
    async hintsForCustomer(input) {
      const hints: BillingImportDocumentHint[] = [];
      for (const row of documents) {
        if (
          row.providerCustomerId !== input.providerCustomerId ||
          row.connectionId !== input.connectionId
        ) {
          continue;
        }
        hints.push({
          connectionId: row.connectionId,
          ownershipStatus: row.ownershipStatus,
          providerCustomerId: row.providerCustomerId,
          subject: row.subject,
        });
      }
      return hints;
    },
    async projectForBinding(input) {
      let resolved = 0;
      let conflicts = 0;
      for (const row of documents) {
        if (row.providerCustomerId !== input.providerCustomerId) {
          continue;
        }
        if (
          row.connectionId !== input.connectionId &&
          row.connectionId !== ""
        ) {
          continue;
        }
        if (
          row.ownershipStatus === "resolved" &&
          row.subject &&
          (row.subject.kind !== input.subject.kind ||
            row.subject.id !== input.subject.id)
        ) {
          row.ownershipStatus = "conflict";
          conflicts += 1;
          continue;
        }
        if (
          row.ownershipStatus === "unresolved" ||
          row.subject == null ||
          (row.subject.kind === input.subject.kind &&
            row.subject.id === input.subject.id)
        ) {
          row.connectionId = input.connectionId;
          row.subject = input.subject;
          row.ownershipStatus = "resolved";
          resolved += 1;
        }
      }
      return { conflicts, resolved };
    },
  };
}

export async function reconcileBillingDocumentsForBinding(
  store: BillingImportDocumentStore,
  input: {
    connectionId: string;
    providerCustomerId: string;
    subject: BillingSubjectRef;
  }
): Promise<{ conflicts: number; resolved: number }> {
  return store.projectForBinding(input);
}
