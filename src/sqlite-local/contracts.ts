/**
 * Host-neutral SQLite Local contracts.
 *
 * This file intentionally contains no SQLite implementation or host binding.
 * A Node, browser, or React Native adapter may satisfy these structural types.
 */

export type AthenaSqliteScalarValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array;

/**
 * Arrays are normalized to JSON text before they reach a host executor.
 * Keeping the executor contract scalar-only matches SQLite driver behavior
 * and prevents nested-array bind values from leaking across host boundaries.
 */
export type AthenaSqliteBindValue = AthenaSqliteScalarValue;

export type AthenaSqliteStorageValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array;

export interface AthenaSqliteExecutionOptions {
  signal?: AbortSignal;
  /** Host-defined absolute deadline in milliseconds since the epoch. */
  deadlineMs?: number;
}

export interface AthenaSqliteExecutionResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly AthenaSqliteStorageValue[])[];
  readonly changes?: number;
}

export interface AthenaSqliteExecutorCapabilities {
  /** The host can interrupt an in-flight statement. */
  readonly interrupt: boolean;
  /** Transaction support exposed by the host. */
  readonly transactions: "none" | "batch" | "interactive";
  /** The host supports savepoint primitives. */
  readonly savepoints: boolean;
  /** The host supports SQLite RETURNING. */
  readonly returning: boolean;
  readonly sqliteVersion?: string;
}

export interface AthenaSqliteTransaction {
  execute(
    sql: string,
    parameters?: readonly AthenaSqliteBindValue[],
    options?: AthenaSqliteExecutionOptions,
  ): Promise<AthenaSqliteExecutionResult>;
  savepoint?<T>(name: string, callback: () => Promise<T>): Promise<T>;
  createSavepoint?(name: string): Promise<void>;
  releaseSavepoint?(name: string): Promise<void>;
  rollbackToSavepoint?(name: string): Promise<void>;
}

export interface AthenaSqliteExecutor {
  readonly capabilities: AthenaSqliteExecutorCapabilities;
  execute(
    sql: string,
    parameters?: readonly AthenaSqliteBindValue[],
    options?: AthenaSqliteExecutionOptions,
  ): Promise<AthenaSqliteExecutionResult>;
  transaction<T>(
    callback: (
      transaction: AthenaSqliteTransaction,
    ) => Promise<T>,
    options?: AthenaSqliteExecutionOptions,
  ): Promise<T>;
  close?(): Promise<void>;
}

export interface AthenaSqliteConfig {
  /**
   * Injected host executor. It is borrowed unless `ownership` is explicitly
   * set to `owned`; Athena never guesses ownership from the object shape.
   */
  readonly executor: AthenaSqliteExecutor;
  /**
   * Injected canonical compiler. Structured CRUD MUST go through Rust
   * `athena-query`; TypeScript never emits SQL.
   */
  readonly compiler?: import("./compiler.ts").AthenaCanonicalQueryCompiler;
  readonly ownership?: "borrowed" | "owned";
}
