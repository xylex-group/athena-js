/**
 * SUPERSEDED by test/sdd/athena-policy-dx.target.test.ts
 *
 * Former Wave 1 pin characterization (`acb0f21c`) of Athena JS Policy DX:
 * - B-PDX-CFG-NO-ATHENA-CONFIG: AthenaConfig identifier absent from generator types
 * - B-PDX-CFG-PROVIDER-REQUIRED: AthenaGeneratorConfig requires provider
 * - B-PDX-CFG-DEFINE-CONSTRAINT: defineAthenaConfig is generator-typed
 * - B-PDX-CFG-ALIAS: defineGeneratorConfig is a literal alias of defineAthenaConfig
 * - B-PDX-CFG-NO-LOAD-ATHENA: loadAthenaConfig is absent
 * - B-PDX-CFG-NORMALIZE-DROPS: normalizeGeneratorConfig has no models/policies/tooling
 * - B-PDX-CFG-EXTRACT-PROVIDER: runtime extract requires record.provider object
 * - B-PDX-CFG-NO-TOOLING: tooling is not a field on AthenaGeneratorConfig
 * - B-PDX-GEN-LOADS-GENERATOR: generate uses loadGeneratorConfig
 * - B-PDX-CLI-NO-POLICY: CLI has no policy group or path
 * - B-PDX-POL-DEFINE: definePolicies flattens array / record / single policy()
 * - B-PDX-POL-NO-CLIENT: no PolicyClient / createPolicyClient
 * - B-PDX-EXEC-SKIP-EVENT: onExecutionEvent only after transport switch; deny skips it
 * - B-PDX-UPSERT-INSERT: fluent upsert traces upsert but transports insert
 * - B-PDX-HANDLERS-HOSTED: hosted-only createAthenaDataHandlers throws
 * - B-PDX-NO-CONFIG-SUBPATH: package.json exports has no ./config
 * - B-PDX-NO-PROJECT-HELPER: defineAthenaProject identifier absent from src
 * - B-PDX-NO-LIFECYCLE-DIR: no src/runtime/data/lifecycle/ and no ATHENA_DATA_LIFECYCLE error
 *
 * Wave 1 inverted found-case cells (do not invert in place):
 * B-PDX-CFG-NO-ATHENA-CONFIG, B-PDX-CFG-DEFINE-CONSTRAINT, B-PDX-CFG-ALIAS,
 * B-PDX-CFG-NO-LOAD-ATHENA, B-PDX-CFG-NO-TOOLING.
 * Stay-true pins live in the target suite and product keep-green tests
 * (generator-config, policy-dsl, policy-act, finality-handlers-from-root).
 *
 * Active baseline file moved after implement. Kept as a record only
 * (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY = "test/sdd/athena-policy-dx.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-PDX-CFG-NO-ATHENA-CONFIG: AthenaConfig identifier absent from generator types",
  "B-PDX-CFG-PROVIDER-REQUIRED: AthenaGeneratorConfig requires provider",
  "B-PDX-CFG-DEFINE-CONSTRAINT: defineAthenaConfig is generator-typed",
  "B-PDX-CFG-ALIAS: defineGeneratorConfig is a literal alias of defineAthenaConfig",
  "B-PDX-CFG-NO-LOAD-ATHENA: loadAthenaConfig is absent",
  "B-PDX-CFG-NORMALIZE-DROPS: normalizeGeneratorConfig projection has no models/policies/tooling",
  "B-PDX-CFG-EXTRACT-PROVIDER: runtime extract requires record.provider object",
  "B-PDX-CFG-NO-TOOLING: tooling is not a field on AthenaGeneratorConfig",
  "B-PDX-GEN-LOADS-GENERATOR: generate uses loadGeneratorConfig",
  "B-PDX-CLI-NO-POLICY: CLI has no policy group or path",
  "B-PDX-POL-DEFINE: definePolicies flattens array / record / single policy()",
  "B-PDX-POL-NO-CLIENT: no PolicyClient / createPolicyClient",
  "B-PDX-EXEC-SKIP-EVENT: onExecutionEvent only after transport switch; deny skips it",
  "B-PDX-UPSERT-INSERT: fluent upsert traces upsert but transports insert",
  "B-PDX-HANDLERS-HOSTED: createAthenaDataHandlers hosted-only throws ATHENA_LOCAL_RUNTIME_REQUIRED",
  "B-PDX-NO-CONFIG-SUBPATH: package.json exports has no ./config",
  "B-PDX-NO-PROJECT-HELPER: defineAthenaProject identifier absent from src",
  "B-PDX-NO-LIFECYCLE-DIR: no src/runtime/data/lifecycle/ and no ATHENA_DATA_LIFECYCLE error",
] as const;
