/**
 * Node CLI / tooling adapter for Embedded Auth schema apply.
 *
 * Do not import auth/server-entry, server.ts, next/*, or server-only.
 */
export {
  inspectAthenaAuthSchema,
  migrateAthenaAuthSchema,
  readAthenaAuthSchemaStatus,
} from "../local/schema.ts";
