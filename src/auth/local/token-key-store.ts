import { type CryptoKey, exportJWK, generateKeyPair, type JWK } from "jose";

export type TokenKeyStatus =
  | "pending"
  | "active"
  | "retiring"
  | "retired"
  | "revoked";

export interface TokenVerificationKey {
  kid: string;
  publicJwk: JWK;
  status: "active" | "retiring";
}

export type TokenSigningKey = Omit<TokenVerificationKey, "status"> & {
  expiresAt?: Date;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  retiresAt?: Date;
  status: TokenKeyStatus;
};

/**
 * Persistent signing-key authority. Memory is opt-in ephemeral.
 * Production Embedded Auth uses PostgresTokenKeyStore (AUTH-JWT-09).
 */
export interface TokenKeyStore {
  acquireBootstrapLock(): Promise<() => void>;
  activateKey(key: TokenSigningKey): Promise<void>;
  compareAndActivate(key: TokenSigningKey): Promise<void>;
  getActiveSigningKey(): Promise<TokenSigningKey | undefined>;
  listVerificationKeys(now?: Date): Promise<TokenVerificationKey[]>;
  retireKey(kid: string): Promise<void>;
  rotateSigningKey(): Promise<TokenSigningKey>;
}

/** retireWindow = maxTokenTtl + jwksCache max-age + SWR. */
export const DEFAULT_TOKEN_RETIRE_WINDOW_MS = (3600 + 300 + 300) * 1000;

const processStores = new Map<string, MemoryTokenKeyStore>();

export function getOrCreateProcessTokenKeyStore(
  issuer: string
): MemoryTokenKeyStore {
  const existing = processStores.get(issuer);
  if (existing) {
    return existing;
  }
  const created = new MemoryTokenKeyStore();
  processStores.set(issuer, created);
  return created;
}

export function hasProcessTokenKeyStore(issuer: string): boolean {
  return processStores.has(issuer);
}

export function resetProcessTokenKeyStores(): void {
  processStores.clear();
}

type StoredKey = TokenSigningKey & { status: TokenKeyStatus };

export class MemoryTokenKeyStore implements TokenKeyStore {
  private readonly keys = new Map<string, StoredKey>();
  private lockTail: Promise<void> = Promise.resolve();
  private readonly retireWindowMs: number;

  constructor(retireWindowMs = DEFAULT_TOKEN_RETIRE_WINDOW_MS) {
    this.retireWindowMs = retireWindowMs;
  }

  async acquireBootstrapLock(): Promise<() => void> {
    let releaseHeld: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const previous = this.lockTail;
    this.lockTail = previous.then(() => held);
    await previous;
    return () => {
      releaseHeld?.();
    };
  }

  async getActiveSigningKey(): Promise<TokenSigningKey | undefined> {
    this.prune(new Date());
    for (const key of this.keys.values()) {
      if (key.status === "active") {
        return key;
      }
    }
  }

  async listVerificationKeys(
    now = new Date()
  ): Promise<TokenVerificationKey[]> {
    this.prune(now);
    const out: TokenVerificationKey[] = [];
    for (const key of this.keys.values()) {
      if (key.status !== "active" && key.status !== "retiring") {
        continue;
      }
      if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) {
        continue;
      }
      out.push({
        kid: key.kid,
        publicJwk: key.publicJwk,
        status: key.status,
      });
    }
    return out;
  }

  async compareAndActivate(key: TokenSigningKey): Promise<void> {
    this.prune(new Date());
    const existing = await this.getActiveSigningKey();
    if (existing) {
      return;
    }
    this.keys.set(key.kid, { ...key, status: "active" });
  }

  async activateKey(key: TokenSigningKey): Promise<void> {
    await this.compareAndActivate(key);
  }

  async rotateSigningKey(): Promise<TokenSigningKey> {
    const unlock = await this.acquireBootstrapLock();
    try {
      const current = await this.getActiveSigningKey();
      const next = await generateSigningKey();
      if (current) {
        await this.retireKey(current.kid);
      }
      this.keys.set(next.kid, { ...next, status: "active" });
      return next;
    } finally {
      unlock();
    }
  }

  async retireKey(kid: string): Promise<void> {
    const existing = this.keys.get(kid);
    if (!existing) {
      return;
    }
    const retiresAt = new Date(Date.now() + this.retireWindowMs);
    this.keys.set(kid, {
      ...existing,
      expiresAt: retiresAt,
      retiresAt,
      status: "retiring",
    });
  }

  private prune(now: Date): void {
    for (const [kid, key] of this.keys) {
      if (
        key.status === "retiring" &&
        key.retiresAt &&
        key.retiresAt.getTime() <= now.getTime()
      ) {
        this.keys.set(kid, { ...key, status: "retired" });
      }
    }
  }
}

export function serializePublicJwks(keys: TokenVerificationKey[]): {
  keys: JWK[];
} {
  return {
    keys: keys.map((entry) => stripPrivateJwk(entry.publicJwk)),
  };
}

function stripPrivateJwk(jwk: JWK): JWK {
  const publicJwk = { ...jwk };
  delete publicJwk.d;
  return publicJwk;
}

export async function ensureActiveSigningKey(
  store: TokenKeyStore
): Promise<TokenSigningKey> {
  const unlock = await store.acquireBootstrapLock();
  try {
    const existing = await store.getActiveSigningKey();
    if (existing) {
      return existing;
    }
    const generated = await generateSigningKey();
    await store.compareAndActivate(generated);
    const active = await store.getActiveSigningKey();
    if (!active) {
      throw new Error(
        "Signing key activation did not persist an active committed key"
      );
    }
    return active;
  } finally {
    unlock();
  }
}

export async function rotateSigningKey(
  store: TokenKeyStore
): Promise<TokenSigningKey> {
  return store.rotateSigningKey();
}

export async function generateSigningKey(): Promise<TokenSigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const kid = crypto.randomUUID();
  const jwk = await exportJWK(publicKey);
  const publicJwk: JWK = {
    ...jwk,
    alg: "ES256",
    kid,
    use: "sig",
  };
  return {
    kid,
    privateKey,
    publicJwk,
    publicKey,
    status: "active",
  };
}
