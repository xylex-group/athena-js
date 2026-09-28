import { hashAuthBridgeCode } from "../../bridge/code.ts";
import type { AuthBridgeCodeStore } from "../../bridge/store.ts";
import type {
  AuthBridgeCodeRecord,
  AuthBridgeConsumeReason,
  ConsumeAuthBridgeCodeInput,
  ConsumedBridgeCode,
  IssueAuthBridgeCodeInput,
} from "../../bridge/types.ts";
import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import type { AthenaAuthDatabase } from "../database.ts";

const TABLE = ATHENA_AUTH_TABLES.authBridgeCodes;

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(String(value));
}

function asNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asDate(value);
}

function hydrate(row: Record<string, unknown>): AuthBridgeCodeRecord {
  const consumeReason = row.consume_reason;
  return {
    codeHash: String(row.code_hash),
    consumedAt: asNullableDate(row.consumed_at),
    consumeReason:
      consumeReason === "consumed" ||
      consumeReason === "destination_mismatch" ||
      consumeReason === "session_revoked"
        ? consumeReason
        : null,
    createdAt: asDate(row.created_at),
    destinationOrigin: String(row.destination_origin),
    expiresAt: asDate(row.expires_at),
    id: String(row.id),
    organizationId:
      typeof row.organization_id === "string" ? row.organization_id : null,
    redirectPath: String(row.redirect_path),
    sessionId: String(row.session_id),
    userId: String(row.user_id),
  };
}

export function createPostgresAuthBridgeCodeStore(
  database: AthenaAuthDatabase
): AuthBridgeCodeStore {
  return {
    async consume(
      input: ConsumeAuthBridgeCodeInput
    ): Promise<ConsumedBridgeCode | null> {
      const codeHash = await hashAuthBridgeCode(input.code);
      return database.transaction(async (tx) => {
        const selected = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${TABLE} WHERE code_hash = $1 FOR UPDATE`,
          [codeHash]
        );
        const raw = selected.rows[0];
        if (!raw) {
          return null;
        }
        const row = hydrate(raw);
        const now = new Date();
        if (
          row.consumedAt !== null ||
          row.expiresAt.getTime() <= now.getTime()
        ) {
          return null;
        }
        const reason: AuthBridgeConsumeReason =
          row.destinationOrigin === input.destinationOrigin
            ? "consumed"
            : "destination_mismatch";
        await tx.query(
          `UPDATE ${TABLE}
					 SET consumed_at = $2, consume_reason = $3
					 WHERE code_hash = $1 AND consumed_at IS NULL`,
          [codeHash, now, reason]
        );
        if (reason === "destination_mismatch") {
          return null;
        }
        return {
          consumedAt: now,
          destinationOrigin: row.destinationOrigin,
          organizationId: row.organizationId,
          redirectPath: row.redirectPath,
          sessionId: row.sessionId,
          userId: row.userId,
        };
      });
    },

    async deleteExpired(now = new Date()): Promise<number> {
      const result = await database.query(
        `DELETE FROM ${TABLE} WHERE expires_at <= $1`,
        [now]
      );
      return result.rowCount;
    },
    async issue(
      input: IssueAuthBridgeCodeInput
    ): Promise<AuthBridgeCodeRecord> {
      const id = input.id ?? crypto.randomUUID();
      const createdAt = new Date();
      await database.query(
        `INSERT INTO ${TABLE} (
					id, code_hash, session_id, user_id, organization_id,
					destination_origin, redirect_path, expires_at, created_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          input.codeHash,
          input.sessionId,
          input.userId,
          input.organizationId ?? null,
          input.destinationOrigin,
          input.redirectPath,
          input.expiresAt,
          createdAt,
        ]
      );
      return {
        codeHash: input.codeHash,
        consumedAt: null,
        consumeReason: null,
        createdAt,
        destinationOrigin: input.destinationOrigin,
        expiresAt: new Date(input.expiresAt),
        id,
        organizationId: input.organizationId ?? null,
        redirectPath: input.redirectPath,
        sessionId: input.sessionId,
        userId: input.userId,
      };
    },

    async revokeForSession(
      sessionId: string,
      _reason?: string
    ): Promise<number> {
      const result = await database.query(
        `UPDATE ${TABLE}
				 SET consumed_at = NOW(), consume_reason = $2
				 WHERE session_id = $1
				   AND consumed_at IS NULL
				   AND expires_at > NOW()`,
        [sessionId, "session_revoked"]
      );
      return result.rowCount;
    },
  };
}
