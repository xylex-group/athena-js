/**
 * Browser-safe Embedded Auth schema generation.
 *
 * SQL catalog stays in `migrations.ts` (Node / CLI). This number must equal
 * the maximum `version` in that catalog; `migrations.ts` fail-closes on mismatch.
 */
export const ATHENA_AUTH_SCHEMA_GENERATION = 50;
