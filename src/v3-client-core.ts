/**
 * Browser-safe Athena client compatibility entry.
 *
 * The construction implementation lives in `v3-client-assembly.ts`; this
 * stable entry remains for browser and compatibility imports.
 */

export * from "./v3-client-assembly.ts";
export type {
  AthenaAuthConfig,
  AthenaChatConfig,
  AthenaChatMode,
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientRuntimeConfig,
  AthenaClientServicesConfig,
  AthenaClientWithR2Storage,
  AthenaDbConfig,
  AthenaRequestContext,
  AthenaRequestContextProvider,
  AthenaStorageConfig,
} from "./client/contracts.ts";
export type {
  AthenaSqliteBindValue,
  AthenaSqliteConfig,
  AthenaSqliteExecutionOptions,
  AthenaSqliteExecutionResult,
  AthenaSqliteExecutor,
  AthenaSqliteExecutorCapabilities,
  AthenaSqliteStorageValue,
  AthenaSqliteTransaction,
} from "./sqlite-local/contracts.ts";
