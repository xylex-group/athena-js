import type {
  AthenaConfig,
  AthenaGeneratorConfig,
} from "../generator/types.ts";

/**
 * Typed identity helper for authoring `athena.config.ts`.
 * Import from `@xylex-group/athena/config` so CLI evaluation does not load Auth/WebAuthn.
 * `provider` is optional; generator commands still validate via
 * {@link defineGeneratorConfig} / `loadGeneratorConfig`.
 */
export function defineAthenaConfig<TConfig extends AthenaConfig>(
  config: TConfig
): TConfig {
  return config;
}

/**
 * @deprecated Prefer {@link defineAthenaConfig} for project files.
 * Strict generator identity — not an alias of {@link defineAthenaConfig}.
 */
export function defineGeneratorConfig<TConfig extends AthenaGeneratorConfig>(
  config: TConfig
): TConfig {
  return config;
}
