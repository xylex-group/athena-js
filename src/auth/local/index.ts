export {
  createAthenaAuth,
  createAthenaAuthHttpHandlers,
  createAthenaAuthRuntime,
  type AthenaAuthHttpHandlers,
  type AthenaAuthRuntime,
  type AthenaAuthServerSurface,
  type CreateAthenaAuthRuntimeOptions,
} from "./runtime.ts";
export { createArgon2PasswordHasher, passwordHashNeedsRehash } from "./password.ts";
export { MemoryAuthStores } from "./memory-stores.ts";
export {
  classifyAuthLedgerQueryError,
  healthFromAuthPlan,
  type AthenaAuthLedgerHealth,
  type AthenaAuthLedgerQueryFailure,
} from "./ledger-health.ts";
export {
  assertAthenaAuthSchemaCompatible,
  compareAthenaAuthLedgers,
  getAthenaAuthExpectedLedger,
  getAthenaAuthSchemaManifest,
  listAthenaAuthCanonicalMigrations,
  migrateAthenaAuthSchema,
  planAthenaAuthSchema,
  readAthenaAuthSchemaStatus,
  repairAthenaAuthSchema,
  toAthenaAuthSchemaCompatibility,
  withAthenaAuthMigrationLock,
  type AthenaAuthCanonicalMigration,
  type AthenaAuthLedgerEntry,
  type AthenaAuthMigrationAction,
  type AthenaAuthMigrationPlan,
  type AthenaAuthMigrationPlanEntry,
  type AthenaAuthSchemaCompatibility,
  type AthenaAuthSchemaDirection,
  type AthenaAuthSchemaStatus,
} from "./schema.ts";
export {
  assertQueryResult,
  createAuthDatabaseFromPool,
  createAuthDatabaseFromRuntime,
  createPostgresAuthDatabase,
  createPostgresAuthDatabaseFromPool,
  type AthenaAuthDatabase,
  type AthenaAuthQueryResult,
} from "./database.ts";
export type { AthenaAuthSchemaDrift } from "./schema-inspect.ts";
export {
  ATHENA_AUTH_MIGRATION_EXPECTATIONS,
  column,
  index,
  table,
  type MigrationRepairability,
  type SchemaExpectation,
} from "./schema-manifest.ts";
export { AthenaAuthRuntimeError } from "./errors.ts";
