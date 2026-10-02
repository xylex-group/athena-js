import { type CryptoKey, exportJWK, generateKeyPair, type JWK } from "jose";

export type TokenKeyStatus =
  | "pending"
  | "active"
  | "retiring"
  | "retired"
  | "revoked";

export type TokenSigningAlgorithm = "ES256" | "RS256";

export interface TokenVerificationKey {
  algorithm: TokenSigningAlgorithm;
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
  getActiveSigningKey(
    algorithm?: TokenSigningAlgorithm
  ): Promise<TokenSigningKey | undefined>;
  listVerificationKeys(now?: Date): Promise<TokenVerificationKey[]>;
  retireKey(kid: string): Promise<void>;
  rotateSigningKey(algorithm?: TokenSigningAlgorithm): Promise<TokenSigningKey>;
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

  async getActiveSigningKey(
    algorithm: TokenSigningAlgorithm = "ES256"
  ): Promise<TokenSigningKey | undefined> {
    this.prune(new Date());
    for (const key of this.keys.values()) {
      if (key.status === "active" && key.algorithm === algorithm) {
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
        algorithm: key.algorithm,
        publicJwk: key.publicJwk,
        status: key.status,
      });
    }
    return out;
  }

  async compareAndActivate(key: TokenSigningKey): Promise<void> {
    this.prune(new Date());
    const existing = await this.getActiveSigningKey(key.algorithm);
    if (existing) {
      return;
    }
    this.keys.set(key.kid, { ...key, status: "active" });
  }

  async activateKey(key: TokenSigningKey): Promise<void> {
    await this.compareAndActivate(key);
  }

  async rotateSigningKey(
    algorithm: TokenSigningAlgorithm = "ES256"
  ): Promise<TokenSigningKey> {
    const unlock = await this.acquireBootstrapLock();
    try {
      const current = await this.getActiveSigningKey(algorithm);
      const next = await generateSigningKey(algorithm);
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
  store: TokenKeyStore,
  algorithm: TokenSigningAlgorithm = "ES256"
): Promise<TokenSigningKey> {
  const unlock = await store.acquireBootstrapLock();
  try {
    const existing = await store.getActiveSigningKey(algorithm);
    if (existing) {
      return existing;
    }
    const generated = await generateSigningKey(algorithm);
    await store.compareAndActivate(generated);
    const active = await store.getActiveSigningKey(algorithm);
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
  store: TokenKeyStore,
  algorithm: TokenSigningAlgorithm = "ES256"
): Promise<TokenSigningKey> {
  return store.rotateSigningKey(algorithm);
}

export async function generateSigningKey(
  algorithm: TokenSigningAlgorithm = "ES256"
): Promise<TokenSigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, {
    extractable: true,
    ...(algorithm === "RS256" ? { modulusLength: 2048 } : {}),
  });
  const kid = crypto.randomUUID();
  const jwk = await exportJWK(publicKey);
  const publicJwk: JWK = {
    ...jwk,
    alg: algorithm,
    kid,
    use: "sig",
  };
  return {
    algorithm,
    kid,
    privateKey,
    publicJwk,
    publicKey,
    status: "active",
  };
}
