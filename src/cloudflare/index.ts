/**
 * Cloudflare Workers edge-local adapter for @xylex-group/athena.
 *
 * Preferred path is root {@link createClient} with drop-in backends:
 * `createClient({ db: { d1 }, storage: { r2 }, mode, prefer, url, key })`.
 *
 * This subpath re-exports thin façades and D1/R2 helpers only.
 *
 * @see docs/cloudflare-edge-local.md
 * @see ADR 0015 / 0016 / 0019
 */

export {
  createCloudflareEdgeCapabilities,
  createGatewayCapabilities,
} from "./capabilities.ts";
export {
  executeD1Batch,
  executeD1Query,
  isMultiStatement,
  splitSqlStatements,
  sqlContainsKeywordOutsideLiterals,
  sqlFirstKeywordOutsideLiterals,
  statementExpectsResultRows,
} from "./d1/runner.ts";
export {
  compileD1Count,
  compileD1Delete,
  compileD1Fetch,
  compileD1Insert,
  compileD1Update,
  D1SqlCompileError,
  extractAthenaCount,
  normalizeD1TableName,
} from "./d1/sql.ts";
export { rewritePostgresSqlForSqlite } from "./d1/sql-rewrite.ts";
export {
  createCloudflareD1GatewayTransport,
  resolveD1BoundedIdentityColumn,
} from "./d1/transport.ts";
export {
  type CloudflareAthenaClient,
  type CloudflareAthenaClientConfig,
  type CloudflareAthenaClientConfigWithR2,
  type CloudflareAthenaClientWithR2,
  createCloudflareClient,
} from "./edge-client.ts";
export {
  ATHENA_EXECUTION_MODE_ENV_KEY,
  ATHENA_EXECUTION_PREFER_ENV_KEY,
  type AthenaExecutionMode,
  type AthenaExecutionPrefer,
  type AthenaResolvedExecutionMode,
  type ResolveAthenaExecutionModeInput,
  resolveAthenaExecutionMode,
} from "./execution-mode.ts";
export {
  type CloudflareR2GetObjectResult,
  type CloudflareR2ListObjectsInput,
  type CloudflareR2ListObjectsResult,
  type CloudflareR2ObjectStorage,
  type CloudflareR2PutBody,
  type CloudflareR2PutObjectInput,
  type CloudflareR2StorageModule,
  composeHttpAndR2Storage,
  createCloudflareR2ObjectStorage,
  createCloudflareR2StorageModule,
} from "./r2/storage.ts";
export {
  type AthenaRuntimeClient,
  type AthenaRuntimeConfig,
  type AthenaRuntimeConfigWithR2,
  type AthenaRuntimeResult,
  type AthenaWorkerEnv,
  type CreateAthenaFromWorkerEnvOptions,
  createAthenaFromWorkerEnv,
  createAthenaRuntime,
  createAthenaRuntimeClient,
  toCreateClientConfig,
} from "./runtime.ts";
export type {
  AthenaClientCapabilities,
  AthenaDbCapabilities,
  AthenaStorageCapabilities,
  D1DatabaseLike,
  R2BucketLike,
} from "./types.ts";
