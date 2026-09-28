import type { MemoryAuthStores } from "./memory-stores.ts";
import type { PostgresAuthStores } from "./stores.ts";
import type { SqliteAuthStores } from "./sqlite-stores.ts";

/**
 * Storage-agnostic auth store port. Memory, Postgres, and SQLite all satisfy it.
 */
export type AthenaAuthStores = MemoryAuthStores | PostgresAuthStores | SqliteAuthStores;
