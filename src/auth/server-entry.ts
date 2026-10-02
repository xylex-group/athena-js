/**
 * Node-only Athena Auth server runtime.
 *
 * Never import this module from browser, React, or Next client entries.
 */

import "server-only";

export {
  type AthenaAuthLocalConfig,
  type AthenaAuthPasskeyOptions,
  type AthenaAuthPublicConfig,
  type AthenaAuthRemoteConfig,
  type NormalizedAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "./config.ts";
export {
  ATHENA_AUTH_DEFAULT_ARGON2,
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
  type AthenaAuthGeneratedOperationDefinition,
  type AthenaAuthOperationDefinition,
  deriveEmbeddedCapabilityAdvertisement,
  listMissingEmbeddedOperations,
  operationKey,
  operationsForCapability,
} from "./contract/index.ts";
export { ATHENA_AUTH_OPERATIONS } from "./contract/operations.generated.ts";
export {
  type AthenaAuthHttpHandlers,
  type AthenaAuthRuntime,
  AthenaAuthRuntimeError,
  type AthenaAuthServerSurface,
  type CreateAthenaAuthRuntimeOptions,
  createArgon2PasswordHasher,
  createAthenaAuth,
  createAthenaAuthHttpHandlers,
  createAthenaAuthRuntime,
  createPostgresAuthDatabase,
  MemoryAuthStores,
  passwordHashNeedsRehash,
} from "./local/index.ts";
export {
  inspectAthenaAuthSchema,
  migrateAthenaAuthSchema,
  readAthenaAuthSchemaStatus,
} from "./node/migrate.ts";
export { ATHENA_AUTH_LATEST_MIGRATION } from "./schema/migrations.ts";
