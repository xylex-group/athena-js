import type {
  OAuthTransactionRecord,
  OAuthTransactionStore,
} from "../../social/server/transaction-store.ts";

function cloneRecord(row: OAuthTransactionRecord): OAuthTransactionRecord {
  return {
    codeChallengeMethod: row.codeChallengeMethod,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    id: row.id,
    intent: row.intent,
    nonceHash: row.nonceHash,
    pkceVerifierCiphertext: row.pkceVerifierCiphertext,
    providerId: row.providerId,
    redirectUri: row.redirectUri,
    stateHash: row.stateHash,
    userId: row.userId,
  };
}

export class MemoryOAuthTransactionStore implements OAuthTransactionStore {
  private readonly rows = new Map<string, OAuthTransactionRecord>();

  constructor() {
    this.consume = this.consume.bind(this);
    this.create = this.create.bind(this);
    this.expire = this.expire.bind(this);
  }

  async create(row: OAuthTransactionRecord): Promise<void> {
    this.rows.set(row.stateHash, cloneRecord(row));
  }

  async consume(stateHash: string): Promise<OAuthTransactionRecord | null> {
    const row = this.rows.get(stateHash);
    if (!row) {
      return null;
    }
    this.rows.delete(stateHash);
    if (row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return cloneRecord(row);
  }

  async expire(now: Date = new Date()): Promise<number> {
    const cutoff = now.getTime();
    let deleted = 0;
    for (const [key, row] of [...this.rows.entries()]) {
      if (row.expiresAt.getTime() <= cutoff) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export function createMemoryOAuthTransactionStore(): MemoryOAuthTransactionStore {
  return new MemoryOAuthTransactionStore();
}
