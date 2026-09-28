import {
  loadAthenaConfig,
  loadGeneratorConfig,
} from "../../generator/config.ts";
import type {
  LoadAthenaConfigOptions,
  LoadedAthenaConfig,
  LoadedGeneratorConfig,
} from "../../generator/types.ts";
import { wrapCliProjectLoadError } from "./errors.ts";
import { type CliProjectTarget, resolveCliProjectTarget } from "./target.ts";

export type LoadCliProjectOptions = LoadAthenaConfigOptions;

export interface LoadedCliProject {
  athena: LoadedAthenaConfig;
  generator: LoadedGeneratorConfig;
  target: CliProjectTarget;
}

export interface LoadedStaticCliProject {
  athena: LoadedAthenaConfig;
  cwd: string;
}

/**
 * CLI-owned project/config resolution. Evaluates `athena.config.*` via the
 * generator loaders and never instantiates domain runtimes or connects.
 */
export async function loadCliProject(
  options: LoadCliProjectOptions = {}
): Promise<LoadedCliProject> {
  const cwd = options.cwd ?? process.cwd();
  try {
    const athena = await loadAthenaConfig({
      configPath: options.configPath,
      cwd,
    });
    const generator = await loadGeneratorConfig({
      configPath: options.configPath,
      cwd,
    });
    return {
      athena,
      generator,
      target: resolveCliProjectTarget(generator, cwd),
    };
  } catch (error) {
    throw wrapCliProjectLoadError(error);
  }
}

/**
 * Loads only the static project config. This is the path for local runtime
 * commands, which must not require a generator provider or DATABASE_URL.
 */
export async function loadStaticCliProject(
  options: LoadCliProjectOptions = {}
): Promise<LoadedStaticCliProject> {
  const cwd = options.cwd ?? process.cwd();
  try {
    return {
      athena: await loadAthenaConfig({
        configPath: options.configPath,
        cwd,
      }),
      cwd,
    };
  } catch (error) {
    throw wrapCliProjectLoadError(error);
  }
}
