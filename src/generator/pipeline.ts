import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { resolveArtifactWritePlan } from "./artifact-merge.ts";
import {
  GENERATED_MANIFEST_REL,
  loadGeneratorConfig,
} from "./config.ts";
import { ensureGeneratorConfigFile } from "./config-file.ts";
import { resolveGeneratorProvider } from "./providers.ts";
import { generateArtifactsFromSnapshot } from "./renderer.ts";
import {
  discoverPostgresSchemas,
  mergeSchemaSelections,
} from "./schema-discovery.ts";
import { resolveProviderSchemas } from "./schema-selection.ts";
import type {
  GeneratedArtifact,
  GeneratedManifest,
  GeneratorConfigEnsureSummary,
  LoadGeneratorConfigOptions,
  NormalizedAthenaGeneratorConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
  SkippedGeneratedArtifact,
  WrittenGeneratedArtifact,
} from "./types.ts";

const GENERATOR_VERSION = "4.0.0";

function toPosixRel(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function buildGeneratedManifest(input: {
  configPath: string;
  cwd: string;
  files: GeneratedArtifact[];
}): GeneratedManifest {
  const configRel =
    input.configPath === "[environment defaults]"
      ? "athena.config.ts"
      : toPosixRel(relative(input.cwd, input.configPath));
  const outputs = [
    ...new Set(input.files.map((file) => toPosixRel(file.path))),
  ].sort();
  return {
    config: configRel.startsWith("..") ? "athena.config.ts" : configRel,
    generatorVersion: GENERATOR_VERSION,
    outputs,
  };
}

async function writeGeneratedManifest(
  cwd: string,
  manifest: GeneratedManifest,
  dryRun: boolean
): Promise<string> {
  const rel = GENERATED_MANIFEST_REL;
  const absolutePath = resolve(cwd, rel);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!dryRun) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body, "utf8");
  }
  return rel;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function policyForArtifact(
  file: GeneratedArtifact,
  config: NormalizedAthenaGeneratorConfig
):
  | "always"
  | NormalizedAthenaGeneratorConfig["output"]["artifactWrite"]["database"] {
  if (file.kind === "model" || file.kind === "schema") {
    return "always";
  }
  if (file.kind === "database") {
    return config.output.artifactWrite.database;
  }
  return config.output.artifactWrite.registry;
}

async function writeArtifacts(
  files: GeneratedArtifact[],
  cwd: string,
  config: NormalizedAthenaGeneratorConfig,
  dryRun: boolean
): Promise<{
  writtenFiles: string[];
  writtenDetails: WrittenGeneratedArtifact[];
  skippedFiles: SkippedGeneratedArtifact[];
}> {
  const writtenFiles: string[] = [];
  const writtenDetails: WrittenGeneratedArtifact[] = [];
  const skippedFiles: SkippedGeneratedArtifact[] = [];

  for (const file of files) {
    const absolutePath = resolve(cwd, file.path);
    const exists = await fileExists(absolutePath);
    const existingContent = exists ? await readExisting(absolutePath) : null;
    const policy = policyForArtifact(file, config);
    const plan = resolveArtifactWritePlan(file, existingContent, policy);

    if (plan.action === "skip" || plan.action === "unchanged") {
      skippedFiles.push({
        conflicts: plan.conflicts.length > 0 ? plan.conflicts : undefined,
        detail: plan.detail,
        kind: file.kind,
        lintErrors: plan.lintErrors.length > 0 ? plan.lintErrors : undefined,
        path: file.path,
        preservedCustom:
          plan.preservedCustom.length > 0 ? plan.preservedCustom : undefined,
        reason: plan.skipReason ?? "already-current",
      });
      continue;
    }

    if (!(plan.content && plan.writeReason)) {
      skippedFiles.push({
        detail: "merge produced no content",
        kind: file.kind,
        lintErrors: plan.lintErrors,
        path: file.path,
        reason: "merge-lint-failed",
      });
      continue;
    }

    if (!dryRun) {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, plan.content, "utf8");
    }

    writtenFiles.push(file.path);
    writtenDetails.push({
      added: plan.added.length > 0 ? plan.added : undefined,
      kind: file.kind,
      path: file.path,
      preservedCustom:
        plan.preservedCustom.length > 0 ? plan.preservedCustom : undefined,
      reason: plan.writeReason,
    });
  }

  return {
    skippedFiles,
    writtenDetails,
    writtenFiles,
  };
}

function withPostgresSchemas(
  config: NormalizedAthenaGeneratorConfig,
  schemas: string[]
): NormalizedAthenaGeneratorConfig {
  if (config.provider.kind !== "postgres") {
    return config;
  }

  return {
    ...config,
    provider: {
      ...config.provider,
      schemas,
    },
  };
}

/**
 * End-to-end generator execution: load config, introspect, render, and optionally write files.
 *
 * When `writeConfig` is enabled (default), also ensures `athena.config.ts` exists and
 * auto-fills discovered schemas without clobbering custom config fields.
 */
export async function runSchemaGenerator(
  options: RunGeneratorOptions = {}
): Promise<RunGeneratorResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun === true;
  const writeConfig = options.writeConfig !== false;
  const discoverSchemas = options.discoverSchemas !== false;
  const configOptions: LoadGeneratorConfigOptions = {
    configPath: options.configPath,
    cwd,
  };

  const loaded = await loadGeneratorConfig(configOptions);
  let { configPath, config } = loaded;
  let configEnsure: GeneratorConfigEnsureSummary | undefined;

  // Expand schemas from live discovery before introspection so gateway/direct
  // multi-schema databases generate fully without requiring a hand-maintained list.
  // Injected test/custom providers skip live discovery to avoid real network I/O.
  let effectiveSchemas = resolveProviderSchemas(config.provider);
  const canDiscoverLive =
    discoverSchemas && config.provider.kind === "postgres" && !options.provider;

  if (canDiscoverLive) {
    try {
      const discovered = await discoverPostgresSchemas(config.provider);
      if (discovered.length > 0) {
        effectiveSchemas = mergeSchemaSelections(effectiveSchemas, discovered);
      }
    } catch {
      // Discovery is best-effort during generate; configured schemas still run.
    }
  }

  config = withPostgresSchemas(config, effectiveSchemas);

  // Intelligent config ensure: create when missing, patch schemas when expanded.
  // Skip when a custom provider is injected (unit tests / programmatic overrides).
  const shouldEnsureConfig =
    writeConfig && config.provider.kind === "postgres" && !options.provider;

  if (shouldEnsureConfig) {
    const ensureResult = await ensureGeneratorConfigFile({
      configPath: options.configPath,
      cwd,
      // Schemas already resolved above — avoid a second discovery round-trip.
      discoverSchemas: false,
      dryRun,
      loaded: { config, configPath },
      mode: config.provider.mode,
      provider: config.provider,
      schemas: effectiveSchemas,
    });

    configEnsure = {
      action: ensureResult.action,
      changes: ensureResult.changes,
      path: ensureResult.path,
      reason: ensureResult.reason,
      schemas: ensureResult.schemas,
    };

    // Prefer the durable config path once a real file was created/updated.
    if (
      ensureResult.action === "created" ||
      ensureResult.action === "updated" ||
      (ensureResult.action === "unchanged" &&
        configPath === "[environment defaults]")
    ) {
      configPath = ensureResult.absolutePath;
      if (ensureResult.schemas.length > 0) {
        effectiveSchemas = ensureResult.schemas;
        config = withPostgresSchemas(config, effectiveSchemas);
      }
    }
  }

  const provider =
    options.provider ??
    resolveGeneratorProvider(config.provider, config.experimental);

  const snapshot = await provider.inspect({
    schemas: effectiveSchemas,
  });

  const generated = generateArtifactsFromSnapshot(snapshot, config);
  const writeResult = await writeArtifacts(
    generated.files,
    cwd,
    config,
    dryRun
  );

  const generatedManifest = buildGeneratedManifest({
    configPath,
    cwd,
    files: generated.files,
  });
  const generatedManifestPath = await writeGeneratedManifest(
    cwd,
    generatedManifest,
    dryRun
  );

  return {
    ...generated,
    config,
    configEnsure,
    configPath,
    generatedManifest,
    generatedManifestPath,
    skippedFiles: writeResult.skippedFiles,
    writtenDetails: writeResult.writtenDetails,
    writtenFiles: writeResult.writtenFiles,
  };
}
