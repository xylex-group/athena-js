/**
 * SUPERSEDED by test/sdd/athena-client-decomposition.target.test.ts
 *
 * Former characterization of freeze HEAD:
 * - P0: src/client/ directory does not exist
 * - P0: createInternalClientCore is exported from src/client.ts
 * - P0: createInternalClientView is exported from src/client.ts
 * - P0: InternalAthenaClientCore is declared in src/client.ts
 * - P0: fluent TableQueryBuilder still compiles inside src/client.ts
 * - P1: query/read-query.ts type-imports AthenaClient from v3-client-core.ts
 * - P1: type-only reverse edges into src/client.ts exist at HEAD
 * - P0: Phase 0 freeze markdown is documentation-only (product src not moved)
 *
 * Location assertions inverted after Phases 0–2 (composition root under
 * `src/client/create-client.ts` + `context.ts`; `client.ts` re-exports).
 * Do not invert titles in place. Target suite is the CI source of truth.
 *
 * Active baseline file moved after implement. Kept as a record only
 * (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/athena-client-decomposition.target.test.ts";

export const SUPERSEDED_IDS = [
  "P0: src/client/ directory does not exist",
  "P0: createInternalClientCore is exported from src/client.ts",
  "P0: createInternalClientView is exported from src/client.ts",
  "P0: InternalAthenaClientCore is declared in src/client.ts",
  "P0: fluent TableQueryBuilder still compiles inside src/client.ts",
  "P1: query/read-query.ts type-imports AthenaClient from v3-client-core.ts",
  "P1: type-only reverse edges into src/client.ts exist at HEAD",
  "P0: Phase 0 freeze markdown is documentation-only (product src not moved)",
] as const;
