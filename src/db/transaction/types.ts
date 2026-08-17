import type { AthenaResult } from "../../client-result.ts";
import type { AthenaExecutable, AthenaQueryDescriptor } from "../../query/descriptor.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";

export type AthenaTransactionIsolationLevel =
  | "read_committed"
  | "repeatable_read"
  | "serializable";

export type AthenaTransactionBackend =
  | "postgres-direct"
  | "gateway-postgres"
  | "d1-batch"
  | "gateway-d1"
  | "unsupported";

export interface AthenaTransactionCapabilities {
  atomic: boolean;
  backend: AthenaTransactionBackend;
  deferrable: boolean;
  interactive: boolean;
  isolationLevels: readonly AthenaTransactionIsolationLevel[];
  readOnly: boolean;
  savepoints: boolean;
}

export interface AthenaTransactionOptions {
  deferrable?: boolean;
  idempotencyKey?: string;
  isolationLevel?: AthenaTransactionIsolationLevel;
  readOnly?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AthenaResolvedTransactionOptions {
  callOptions?: AthenaGatewayCallOptions;
  deferrable: boolean;
  idempotencyKey?: string;
  isolationLevel?: AthenaTransactionIsolationLevel;
  readOnly: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type AthenaTransactionOperationKind = "fetch" | "insert" | "update" | "delete";

export interface AthenaTransactionOperationBase {
  descriptor: AthenaQueryDescriptor;
  id: string;
  index: number;
}

export type AthenaTransactionOperation =
  | (AthenaTransactionOperationBase & {
      kind: "fetch";
      payload: AthenaFetchPayload;
    })
  | (AthenaTransactionOperationBase & {
      kind: "insert";
      payload: AthenaInsertPayload;
    })
  | (AthenaTransactionOperationBase & {
      kind: "update";
      payload: AthenaUpdatePayload;
    })
  | (AthenaTransactionOperationBase & {
      kind: "delete";
      payload: AthenaDeletePayload;
    });

export interface AthenaTransactionTransportResult {
  committed: boolean;
  results: AthenaGatewayResponse<unknown>[];
  transactionId?: string;
}

export interface AthenaInteractiveTransactionTransport {
  commit(): Promise<void>;
  createSavepoint?(name: string): Promise<void>;
  execute(
    operation: AthenaTransactionOperation
  ): Promise<AthenaGatewayResponse<unknown>>;
  releaseSavepoint?(name: string): Promise<void>;
  rollback(): Promise<void>;
  rollbackToSavepoint?(name: string): Promise<void>;
}

export interface AthenaTransactionTransport {
  beginInteractive?(
    options?: AthenaResolvedTransactionOptions
  ): Promise<AthenaInteractiveTransactionTransport>;
  readonly capabilities: AthenaTransactionCapabilities;
  executeAtomic(
    operations: readonly AthenaTransactionOperation[],
    options?: AthenaResolvedTransactionOptions
  ): Promise<AthenaTransactionTransportResult>;
}

export type AthenaExecutableOutput<T> = T extends AthenaExecutable<infer R>
  ? R
  : T extends PromiseLike<infer R>
    ? R
    : never;

export type AthenaTransactionResults<
  T extends readonly AthenaExecutable<unknown>[],
> = {
  [K in keyof T]: AthenaExecutableOutput<T[K]>;
};

export type AthenaTransactionOperationCompiler = () => AthenaTransactionOperation;

export interface AthenaTransactionCacheObserver {
  reconcileCommitted(
    operations: readonly AthenaTransactionOperation[],
    results: readonly AthenaResult<unknown>[]
  ): void;
}

export const ATHENA_TRANSACTION_COMPILE = Symbol.for(
  "athena.transaction.compile"
);

export const UNSUPPORTED_TRANSACTION_CAPABILITIES: AthenaTransactionCapabilities =
  {
    atomic: false,
    backend: "unsupported",
    deferrable: false,
    interactive: false,
    isolationLevels: [],
    readOnly: false,
    savepoints: false,
  };

export const POSTGRES_DIRECT_TRANSACTION_CAPABILITIES: AthenaTransactionCapabilities =
  {
    atomic: true,
    backend: "postgres-direct",
    deferrable: true,
    interactive: true,
    isolationLevels: ["read_committed", "repeatable_read", "serializable"],
    readOnly: true,
    savepoints: true,
  };

export const GATEWAY_POSTGRES_TRANSACTION_CAPABILITIES: AthenaTransactionCapabilities =
  {
    atomic: true,
    backend: "gateway-postgres",
    deferrable: true,
    interactive: false,
    isolationLevels: ["read_committed", "repeatable_read", "serializable"],
    readOnly: true,
    savepoints: false,
  };

export const D1_BATCH_TRANSACTION_CAPABILITIES: AthenaTransactionCapabilities =
  {
    atomic: true,
    backend: "d1-batch",
    deferrable: false,
    interactive: false,
    isolationLevels: [],
    readOnly: false,
    savepoints: false,
  };

export const GATEWAY_D1_TRANSACTION_CAPABILITIES: AthenaTransactionCapabilities =
  {
    atomic: false,
    backend: "gateway-d1",
    deferrable: false,
    interactive: false,
    isolationLevels: [],
    readOnly: false,
    savepoints: false,
  };
