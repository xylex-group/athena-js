/**
 * Project-config tooling leaf for `athena.config.ts`.
 *
 * This entrypoint must stay free of Auth, WebAuthn, `createClient`, and other
 * Node runtime materializers. CLI-generated configs import from here so a packed
 * consumer that also depends on Athena Auth UI and Next does not evaluate the
 * `@peculiar/asn1-schema` registry while loading config.
 */

export type {
  GeneratorEnvBooleanOptions,
  GeneratorEnvJsonOptions,
  GeneratorEnvListOptions,
  GeneratorEnvOneOfOptions,
  GeneratorEnvStringOptions,
} from "../generator/env.ts";
export { generatorEnv } from "../generator/env.ts";
export type {
  AthenaConfig,
  AthenaGeneratorConfig,
} from "../generator/types.ts";
export {
  defineAthenaConfig,
  defineGeneratorConfig,
} from "./project-helpers.ts";
