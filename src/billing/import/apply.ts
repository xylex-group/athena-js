import type { BillingSubjectBindingRecord } from "../subject/repository.ts";
import type { BillingSubjectRef } from "../types.ts";
import { subjectsEqual } from "./candidate-resolver.ts";
import type { BillingImportDocumentHint, BillingImportPlan } from "./types.ts";

export interface BillingImportBindingStore {
  activate(input: {
    emailSnapshot?: string | null;
    id: string;
    source: "imported" | "reconciled";
  }): Promise<void>;
  findActivePrimary(input: {
    connectionId: string;
    subject: BillingSubjectRef;
  }): Promise<BillingSubjectBindingRecord | null>;
  findByLocator(input: {
    connectionId: string;
    providerCustomerId: string;
  }): Promise<BillingSubjectBindingRecord | null>;
  insertActive(input: {
    connectionId: string;
    emailSnapshot?: string | null;
    providerCustomerId: string;
    source: "imported" | "reconciled";
    subject: BillingSubjectRef;
  }): Promise<BillingSubjectBindingRecord>;
  recordConflict?(input: {
    confidence: string;
    connectionId: string;
    providerCustomerId: string;
    reason: string;
    subject?: BillingSubjectRef;
  }): Promise<void>;
}

export interface BillingImportDocumentStore {
  hintsForCustomer(input: {
    connectionId: string;
    providerCustomerId: string;
  }): Promise<readonly BillingImportDocumentHint[]>;
  projectForBinding(input: {
    connectionId: string;
    providerCustomerId: string;
    subject: BillingSubjectRef;
  }): Promise<{ conflicts: number; resolved: number }>;
}

export interface BillingImportCursorStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, cursor: string | null): Promise<void>;
}

export function createMemoryBillingImportCursorStore(): BillingImportCursorStore & {
  cursors: Map<string, string | null>;
} {
  const cursors = new Map<string, string | null>();
  return {
    cursors,
    async get(connectionId) {
      return cursors.get(connectionId) ?? null;
    },
    async set(connectionId, cursor) {
      cursors.set(connectionId, cursor);
    },
  };
}

let nextId = 1;

function newId(): string {
  nextId += 1;
  return `bind_${nextId}`;
}

export type MemoryBillingImportConflict = {
  confidence: string;
  connectionId: string;
  observationCount: number;
  providerCustomerId: string;
  reason: string;
  subjectId?: string;
  subjectKind?: string;
};

export function createMemoryBillingImportBindingStore(
  initial: BillingSubjectBindingRecord[] = []
): BillingImportBindingStore & {
  conflicts: MemoryBillingImportConflict[];
  records: BillingSubjectBindingRecord[];
} {
  const records = [...initial];
  const conflicts: MemoryBillingImportConflict[] = [];
  return {
    async activate(input) {
      const row = records.find((item) => item.id === input.id);
      if (!row) {
        return;
      }
      row.status = "active";
      row.isPrimary = true;
      row.source = input.source;
      if (input.emailSnapshot !== undefined) {
        row.emailSnapshot = input.emailSnapshot ?? null;
      }
    },
    conflicts,
    async findActivePrimary(input) {
      return (
        records.find(
          (row) =>
            row.connectionId === input.connectionId &&
            row.subjectKind === input.subject.kind &&
            row.subjectId === input.subject.id &&
            row.providerSubjectKind === "customer" &&
            row.status === "active" &&
            row.isPrimary
        ) ?? null
      );
    },
    async findByLocator(input) {
      return (
        records.find(
          (row) =>
            row.connectionId === input.connectionId &&
            row.providerSubjectKind === "customer" &&
            row.providerSubjectId === input.providerCustomerId
        ) ?? null
      );
    },
    async insertActive(input) {
      const row: BillingSubjectBindingRecord = {
        connectionId: input.connectionId,
        emailSnapshot: input.emailSnapshot ?? null,
        id: newId(),
        isPrimary: true,
        providerSubjectId: input.providerCustomerId,
        providerSubjectKind: "customer",
        source: input.source,
        status: "active",
        subjectId: input.subject.id,
        subjectKind: input.subject.kind,
      };
      records.push(row);
      return row;
    },
    async recordConflict(input) {
      const subjectKind = input.subject?.kind ?? "";
      const subjectId = input.subject?.id ?? "";
      const existing = conflicts.find(
        (row) =>
          row.connectionId === input.connectionId &&
          row.providerCustomerId === input.providerCustomerId &&
          (row.subjectKind ?? "") === subjectKind &&
          (row.subjectId ?? "") === subjectId
      );
      if (existing) {
        existing.confidence = input.confidence;
        existing.observationCount += 1;
        existing.reason = input.reason;
        existing.subjectId = input.subject?.id;
        existing.subjectKind = input.subject?.kind;
        return;
      }
      conflicts.push({
        confidence: input.confidence,
        connectionId: input.connectionId,
        observationCount: 1,
        providerCustomerId: input.providerCustomerId,
        reason: input.reason,
        subjectId: input.subject?.id,
        subjectKind: input.subject?.kind,
      });
    },
    records,
  };
}

export async function applyBillingImportPlan(
  store: BillingImportBindingStore,
  input: {
    emailSnapshot?: string | null;
    plan: BillingImportPlan;
  }
): Promise<"created" | "activated" | "noop" | "conflict"> {
  const { plan } = input;
  if (plan.action === "none" || plan.action === "noop") {
    return "noop";
  }
  if (plan.action === "mark_conflict") {
    if (store.recordConflict) {
      await store.recordConflict({
        confidence: plan.confidence,
        connectionId: plan.connectionId,
        providerCustomerId: plan.providerCustomerId,
        reason:
          plan.reason === "unique email candidate only"
            ? "manual_review_required"
            : "ambiguous_import",
        subject: plan.subject,
      });
    }
    return "conflict";
  }
  const subject = plan.subject;
  if (!subject) {
    return "noop";
  }
  const existing = await store.findByLocator({
    connectionId: plan.connectionId,
    providerCustomerId: plan.providerCustomerId,
  });
  if (existing) {
    if (
      existing.status === "active" &&
      subjectsEqual(subject, {
        id: existing.subjectId,
        kind: existing.subjectKind,
      })
    ) {
      return "noop";
    }
    if (
      !subjectsEqual(subject, {
        id: existing.subjectId,
        kind: existing.subjectKind,
      })
    ) {
      return "conflict";
    }
    if (existing.status === "pending" || plan.action === "resume_pending") {
      await store.activate({
        emailSnapshot: input.emailSnapshot,
        id: existing.id,
        source: plan.source,
      });
      return "activated";
    }
    return "noop";
  }
  await store.insertActive({
    connectionId: plan.connectionId,
    emailSnapshot: input.emailSnapshot,
    providerCustomerId: plan.providerCustomerId,
    source: plan.source,
    subject,
  });
  return "created";
}
