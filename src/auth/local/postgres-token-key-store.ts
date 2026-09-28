import { type CryptoKey, exportJWK, importJWK, type JWK } from "jose";
import {
  ATHENA_AUTH_SIGNING_KEY_ADVISORY_LOCK,
  ATHENA_AUTH_TABLES,
} from "../contract/index.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import {
  issuerAdvisoryLockKey,
  openTokenPrivateJwk,
  sealTokenPrivateJwk,
} from "./token-key-crypto.ts";
import {
  DEFAULT_TOKEN_RETIRE_WINDOW_MS,
  generateSigningKey,
  type TokenKeyStatus,
  type TokenKeyStore,
  type TokenSigningKey,
  type TokenVerificationKey,
} from "./token-key-store.ts";

interface SigningKeyRow {
  activated_at: Date | string | null;
  algorithm: string;
  expires_at: Date | string | null;
  issuer: string;
  kid: string;
  private_jwk_ciphertext: string;
  public_jwk: JWK | string;
  retires_at: Date | string | null;
  status: TokenKeyStatus;
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (value == null) {
    return;
  }
  return value instanceof Date ? value : new Date(value);
}

function parsePublicJwk(value: JWK | string): JWK {
  if (typeof value === "string") {
    return JSON.parse(value) as JWK;
  }
  return value;
}

export class PostgresTokenKeyStore implements TokenKeyStore {
  constructor(
    private readonly input: {
      database: AthenaAuthDatabase;
      encryptionSecret: string;
      issuer: string;
      retireWindowMs?: number;
      transactionBound?: boolean;
    }
  ) {}

  async acquireBootstrapLock(): Promise<() => void> {
    return () => undefined;
  }

  async getActiveSigningKey(): Promise<TokenSigningKey | undefined> {
    return this.withLock(async (tx) => {
      await this.pruneExpired(tx);
      const result = await tx.query<SigningKeyRow>(
        `SELECT kid, issuer, status, algorithm, public_jwk, private_jwk_ciphertext,
				        created_at, activated_at, retires_at, expires_at
				 FROM ${ATHENA_AUTH_TABLES.authSigningKeys}
				 WHERE issuer = $1 AND status = 'active'
				 LIMIT 1`,
        [this.input.issuer]
      );
      const row = result.rows[0];
      return row ? this.hydrateSigningKey(row) : undefined;
    });
  }

  async listVerificationKeys(
    now = new Date()
  ): Promise<TokenVerificationKey[]> {
    return this.withLock(async (tx) => {
      await this.pruneExpired(tx, now);
      const result = await tx.query<SigningKeyRow>(
        `SELECT kid, issuer, status, algorithm, public_jwk, private_jwk_ciphertext,
				        created_at, activated_at, retires_at, expires_at
				 FROM ${ATHENA_AUTH_TABLES.authSigningKeys}
				 WHERE issuer = $1
				   AND status IN ('active', 'retiring')
				   AND (expires_at IS NULL OR expires_at > $2)`,
        [this.input.issuer, now.toISOString()]
      );
      return Promise.all(
        result.rows.map(async (row) => {
          const key = await this.hydrateSigningKey(row);
          return {
            kid: key.kid,
            publicJwk: key.publicJwk,
            status: key.status === "active" ? "active" : "retiring",
          };
        })
      );
    });
  }

  async compareAndActivate(key: TokenSigningKey): Promise<void> {
    await this.withLock(async (tx) => {
      const existing = await tx.query<{ kid: string }>(
        `SELECT kid FROM ${ATHENA_AUTH_TABLES.authSigningKeys}
				 WHERE issuer = $1 AND status = 'active'
				 LIMIT 1`,
        [this.input.issuer]
      );
      if (existing.rows[0]) {
        return;
      }
      await this.insertActive(tx, key);
    });
  }

  async activateKey(key: TokenSigningKey): Promise<void> {
    await this.compareAndActivate(key);
  }

  async rotateSigningKey(): Promise<TokenSigningKey> {
    const next = await generateSigningKey();
    const windowMs =
      this.input.retireWindowMs ?? DEFAULT_TOKEN_RETIRE_WINDOW_MS;
    const retiresAt = new Date(Date.now() + windowMs);
    return this.withLock(async (tx) => {
      await this.pruneExpired(tx);
      const active = await tx.query<{ kid: string }>(
        `SELECT kid FROM ${ATHENA_AUTH_TABLES.authSigningKeys}
				 WHERE issuer = $1 AND status = 'active'
				 FOR UPDATE`,
        [this.input.issuer]
      );
      const current = active.rows[0];
      if (current) {
        await tx.query(
          `UPDATE ${ATHENA_AUTH_TABLES.authSigningKeys}
					 SET status = 'retiring', retires_at = $2, expires_at = $2
					 WHERE kid = $1 AND issuer = $3 AND status = 'active'`,
          [current.kid, retiresAt.toISOString(), this.input.issuer]
        );
      }
      await this.insertActive(tx, next);
      return next;
    });
  }

  async retireKey(kid: string): Promise<void> {
    const windowMs =
      this.input.retireWindowMs ?? DEFAULT_TOKEN_RETIRE_WINDOW_MS;
    const retiresAt = new Date(Date.now() + windowMs);
    await this.withLock(async (tx) => {
      await tx.query(
        `UPDATE ${ATHENA_AUTH_TABLES.authSigningKeys}
				 SET status = 'retiring', retires_at = $2, expires_at = $2
				 WHERE kid = $1 AND issuer = $3 AND status = 'active'`,
        [kid, retiresAt.toISOString(), this.input.issuer]
      );
    });
  }

  private async withLock<T>(
    fn: (tx: AthenaAuthDatabase) => Promise<T>
  ): Promise<T> {
    if (this.input.transactionBound) {
      await this.input.database.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ATHENA_AUTH_SIGNING_KEY_ADVISORY_LOCK,
        issuerAdvisoryLockKey(this.input.issuer),
      ]);
      return fn(this.input.database);
    }
    return this.input.database.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ATHENA_AUTH_SIGNING_KEY_ADVISORY_LOCK,
        issuerAdvisoryLockKey(this.input.issuer),
      ]);
      return fn(tx);
    });
  }

  private async pruneExpired(
    tx: AthenaAuthDatabase,
    now = new Date()
  ): Promise<void> {
    await tx.query(
      `UPDATE ${ATHENA_AUTH_TABLES.authSigningKeys}
			 SET status = 'retired'
			 WHERE issuer = $1
			   AND status = 'retiring'
			   AND retires_at IS NOT NULL
			   AND retires_at <= $2`,
      [this.input.issuer, now.toISOString()]
    );
  }

  private async insertActive(
    tx: AthenaAuthDatabase,
    key: TokenSigningKey
  ): Promise<void> {
    const privateJwk = await exportJWK(key.privateKey);
    const ciphertext = await sealTokenPrivateJwk(
      privateJwk as Record<string, unknown>,
      this.input.encryptionSecret
    );
    await tx.query(
      `INSERT INTO ${ATHENA_AUTH_TABLES.authSigningKeys} (
				kid, issuer, status, algorithm, public_jwk, private_jwk_ciphertext,
				activated_at
			) VALUES ($1, $2, 'active', 'ES256', $3::jsonb, $4, NOW())`,
      [key.kid, this.input.issuer, JSON.stringify(key.publicJwk), ciphertext]
    );
  }

  private async hydrateSigningKey(
    row: SigningKeyRow
  ): Promise<TokenSigningKey> {
    const publicJwk = parsePublicJwk(row.public_jwk);
    const privateJwk = await openTokenPrivateJwk(
      row.private_jwk_ciphertext,
      this.input.encryptionSecret
    );
    const privateKey = (await importJWK(
      { ...privateJwk, alg: "ES256" },
      "ES256"
    )) as CryptoKey;
    const publicKey = (await importJWK(
      { ...publicJwk, alg: "ES256" },
      "ES256"
    )) as CryptoKey;
    const status = row.status === "active" ? "active" : "retiring";
    return {
      expiresAt: asDate(row.expires_at),
      kid: row.kid,
      privateKey,
      publicJwk,
      publicKey,
      retiresAt: asDate(row.retires_at),
      status,
    };
  }
}
