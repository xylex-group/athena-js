/**
 * Node-only Athena Auth server runtime.
 *
 * Never import this module from browser, React, or Next client entries.
 */

import "server-only";

export {
  AthenaAuthRuntimeError,
  createArgon2PasswordHasher,
  createAthenaAuth,
  createAthenaAuthHttpHandlers,
  createAthenaAuthRuntime,
  createPostgresAuthDatabase,
  MemoryAuthStores,
  migrateAthenaAuthSchema,
  passwordHashNeedsRehash,
  readAthenaAuthSchemaStatus,
  type AthenaAuthHttpHandlers,
  type AthenaAuthRuntime,
  type AthenaAuthServerSurface,
  type CreateAthenaAuthRuntimeOptions,
} from "./local/index.ts";

export {
  normalizeAthenaAuthConfig,
  type AthenaAuthLocalConfig,
  type AthenaAuthPublicConfig,
  type AthenaAuthRemoteConfig,
  type NormalizedAthenaAuthConfig,
} from "./config.ts";

export {
  ATHENA_AUTH_DEFAULT_ARGON2,
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
} from "./contract/index.ts";
