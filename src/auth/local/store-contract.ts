import type { MemoryAuthStores } from "./memory-stores.ts";
import type { PostgresAuthStores } from "./stores.ts";

/**
 * Storage-agnostic auth store port. Memory and Postgres both satisfy it.
 * Hook scope and handlers depend on this type, not on a concrete backend.
 */
export type AthenaAuthStores = MemoryAuthStores | PostgresAuthStores;
