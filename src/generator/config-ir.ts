import type {
  AthenaConfig,
  AthenaConfigIr,
  AthenaGeneratorConfig,
  GeneratorProviderInputConfig,
} from "./types.ts";

/**
 * Projects a loaded project config into the shared raw configuration shape.
 *
 * Keeping this projection explicit prevents loaders from silently acquiring
 * different field vocabularies while preserving the project-only fields.
 */
export function toAthenaConfigIr(input: AthenaConfig): AthenaConfigIr {
  return {
    ...(input.experimental === undefined
      ? {}
      : { experimental: input.experimental }),
    ...(input.features === undefined ? {} : { features: input.features }),
    ...(input.filter === undefined ? {} : { filter: input.filter }),
    ...(input.migrations === undefined ? {} : { migrations: input.migrations }),
    ...(input.local === undefined ? {} : { local: input.local }),
    ...(input.models === undefined ? {} : { models: input.models }),
    ...(input.modules === undefined ? {} : { modules: input.modules }),
    ...(input.naming === undefined ? {} : { naming: input.naming }),
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.policies === undefined ? {} : { policies: input.policies }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.tooling === undefined ? {} : { tooling: input.tooling }),
  };
}

export function toAthenaGeneratorConfigIr(
  input: AthenaGeneratorConfig
): AthenaConfigIr & { provider: GeneratorProviderInputConfig } {
  return {
    ...toAthenaConfigIr(input),
    provider: input.provider,
  };
}
