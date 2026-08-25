/**
 * SUPERSEDED by test/sdd/athena-schema-ir-v2.target.test.ts
 *
 * Former characterization of HEAD overlapping truths:
 * - B-SIR-07: src/schema/ir/ is absent
 * - B-SIR-08: package.json has no ./schema export; tsup has no schema entry
 * - B-SIR-09: table() has no IR document field
 * - B-SIR-15: no canonicalizeAthenaSchemaIr / fingerprintAthenaSchemaIr /
 *   validateAthenaSchemaIr / schemaIrFromIntrospection symbols
 * - B-SIR-16: no test/fixtures/schema-ir/ corpus
 *
 * These absence pins inverted after Schema IR v2 P0. Do not invert titles in
 * place. Target suite is the CI source of truth.
 */
export const SUPERSEDED_BY =
	"test/sdd/athena-schema-ir-v2.target.test.ts";

export const SUPERSEDED_IDS = [
	"B-SIR-07: src/schema/ir/ is absent",
	"B-SIR-08: package.json exports ./policy and ./migrations, not ./schema; tsup has no schema entry",
	"B-SIR-09: table() returns AthenaTableDef / ModelDef; no IR document field",
	"B-SIR-15: no canonicalizeAthenaSchemaIr / fingerprintAthenaSchemaIr / validateAthenaSchemaIr symbols",
	"B-SIR-16: no test/fixtures/schema-ir/ corpus",
] as const;
