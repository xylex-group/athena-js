import type { BillingSubjectRef } from "../types.ts";
import type { BillingSubjectDirectory, BillingSubjectRecord } from "./types.ts";

export interface BillingImportUserRecord {
  email?: string | null;
  id: string;
}

export interface BillingImportUserStore {
  getUser(userId: string): Promise<BillingImportUserRecord | undefined>;
  getUserByEmail(email: string): Promise<BillingImportUserRecord | undefined>;
  listUsers?(input: {
    limit?: number;
    offset?: number;
    query?: string;
  }): Promise<{ users: BillingImportUserRecord[] }>;
}

function recordFromUser(user: BillingImportUserRecord): BillingSubjectRecord {
  return {
    email: user.email,
    subject: { id: user.id, kind: "user" },
  };
}

export function createEmbeddedAuthBillingSubjectDirectory(
  store: BillingImportUserStore
): BillingSubjectDirectory {
  return {
    async findUsersByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) {
        return [];
      }
      if (typeof store.listUsers === "function") {
        const page = await store.listUsers({
          limit: 50,
          query: normalized,
        });
        return page.users
          .filter(
            (user) =>
              typeof user.email === "string" &&
              user.email.trim().toLowerCase() === normalized
          )
          .map(recordFromUser);
      }
      const user = await store.getUserByEmail(email);
      return user ? [recordFromUser(user)] : [];
    },
    async getById(subject: BillingSubjectRef) {
      if (subject.kind !== "user") {
        return null;
      }
      const user = await store.getUser(subject.id);
      return user ? recordFromUser(user) : null;
    },
  };
}
