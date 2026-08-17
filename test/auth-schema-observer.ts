import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";

const DDL = /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SCHEMA)\b/i;

export function isAuthDdl(sql: string): boolean {
  return DDL.test(sql);
}

export function createObservingAuthDatabase(options?: {
  ledger?: Array<{ checksum?: string | null; name?: string; version: number }>;
  missing?: boolean;
  version?: number;
}): AthenaAuthDatabase & { statements: string[] } {
  const statements: string[] = [];
  const database: AthenaAuthDatabase & { statements: string[] } = {
    async close() {},
    async query(text) {
      statements.push(text);
      if (options?.missing) {
        throw new Error(
          'relation "athena.auth_schema_migrations" does not exist'
        );
      }
      if (/auth_schema_migrations/i.test(text)) {
        const rows =
          options?.ledger ??
          [{ version: options?.version ?? ATHENA_AUTH_SCHEMA_GENERATION }];
        return {
          rowCount: rows.length,
          rows,
        };
      }
      return { rowCount: 0, rows: [] };
    },
    statements,
    async transaction(fn) {
      return fn(database);
    },
  };
  return database;
}
