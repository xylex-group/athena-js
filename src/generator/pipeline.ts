import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { resolveArtifactWritePlan } from "./artifact-merge.ts";
import { GENERATED_MANIFEST_REL, loadGeneratorConfig } from "./config.ts";
import { ensureGeneratorConfigFile } from "./config-file.ts";
import { isAthenaGeneratedSource } from "./generated-file-header.ts";
import { resolveGeneratorProvider } from "./providers.ts";
import { generateArtifactsFromSnapshot } from "./renderer.ts";
import {
  discoverPostgresSchemas,
  mergeSchemaSelections,
} from "./schema-discovery.ts";
import { resolveProviderSchemas } from "./schema-selection.ts";
import { findDuplicateTableSelectors } from "./table-selection.ts";
import type {
  GeneratedArtifact,
  GeneratedManifest,
  GeneratorConfigEnsureSummary,
  GeneratorDiagnostic,
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
  const absolutePath = await resolveSafeGeneratedPath(cwd, rel);
  if (absolutePath === null) {
    throw new Error(`Generated output path is unsafe: ${rel}`);
  }
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!dryRun) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body, "utf8");
  }
  return rel;
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readExistingManifest(
  cwd: string
): Promise<{ error?: string; manifest: GeneratedManifest | null }> {
  const manifestPath = await resolveSafeGeneratedPath(
    cwd,
    GENERATED_MANIFEST_REL
  );
  if (manifestPath === null) {
    return {
      error: `Generated manifest is invalid: ${GENERATED_MANIFEST_REL}`,
      manifest: null,
    };
  }
  let body: string;
  try {
    body = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { manifest: null };
    }
    return {
      error: `Unable to read generated manifest: ${GENERATED_MANIFEST_REL}`,
      manifest: null,
    };
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { config?: unknown }).config !== "string" ||
      typeof (parsed as { generatorVersion?: unknown }).generatorVersion !==
        "string" ||
      !Array.isArray((parsed as { outputs?: unknown }).outputs) ||
      !(parsed as { outputs: unknown[] }).outputs.every(
        (output) =>
          typeof output === "string" &&
          output.length > 0 &&
          isSafeManifestOutput(output, cwd)
      )
    ) {
      return {
        error: `Generated manifest is invalid: ${GENERATED_MANIFEST_REL}`,
        manifest: null,
      };
    }
    return { manifest: parsed as GeneratedManifest };
  } catch {
    return {
      error: `Generated manifest is invalid: ${GENERATED_MANIFEST_REL}`,
      manifest: null,
    };
  }
}

function isSafeManifestOutput(output: string, cwd: string): boolean {
  if (isAbsolute(output)) {
    return false;
  }
  const normalized = toPosixRel(output);
  if (
    normalized !== output ||
    normalized.length === 0 ||
    normalized === "." ||
    normalized.includes("\0")
  ) {
    return false;
  }
  if (
    posix.isAbsolute(normalized) ||
    win32.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return false;
  }
  const candidate = resolve(cwd, output);
  const candidateRelative = toPosixRel(relative(cwd, candidate));
  return (
    candidateRelative.length > 0 &&
    candidateRelative !== "." &&
    candidateRelative !== ".." &&
    !candidateRelative.startsWith("../") &&
    !isAbsolute(candidateRelative)
  );
}

function isContainedPath(root: string, candidate: string): boolean {
  const candidateRelative = relative(root, candidate);
  return (
    candidateRelative !== ".." &&
    !candidateRelative.startsWith(`..${sep}`) &&
    !isAbsolute(candidateRelative)
  );
}

async function resolveSafeGeneratedPath(
  cwd: string,
  output: string
): Promise<string | null> {
  if (!isSafeManifestOutput(output, cwd)) {
    return null;
  }

  let root: string;
  try {
    root = await realpath(cwd);
  } catch {
    return null;
  }

  let current = resolve(cwd, output);
  const missing: string[] = [];
  while (true) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        return null;
      }
      const resolvedCurrent = await realpath(current);
      if (!isContainedPath(root, resolvedCurrent)) {
        return null;
      }
      const resolvedCandidate = resolve(resolvedCurrent, ...missing);
      return isContainedPath(root, resolvedCandidate)
        ? resolvedCandidate
        : null;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        return null;
      }
      const parent = dirname(current);
      if (parent === current) {
        return null;
      }
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

async function resolvePhysicalOutputIdentity(
  absolutePath: string
): Promise<string | null> {
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return absolutePath;
    }
    return null;
  }
}

async function resolveManifestOwnership(
  existing: GeneratedManifest | null,
  expected: GeneratedManifest,
  cwd: string,
  generatedFiles: GeneratedArtifact[],
  config: NormalizedAthenaGeneratorConfig
): Promise<{ deletions: string[]; violations: string[] }> {
  const expectedOutputs = new Set(expected.outputs);
  const policyManagedOutputs = new Set(
    generatedFiles
      .filter((file) => file.kind === "database" || file.kind === "registry")
      .filter((file) => policyForArtifact(file, config) !== "always")
      .map((file) => toPosixRel(file.path))
  );
  const deletions: string[] = [];
  const violations: string[] = [];
  const resolvedOutputs = new Map<
    string,
    { absolutePath: string; identity: string } | null
  >();

  const resolveOutput = async (
    output: string
  ): Promise<{ absolutePath: string; identity: string } | null> => {
    if (resolvedOutputs.has(output)) {
      return resolvedOutputs.get(output) ?? null;
    }
    const absolutePath = await resolveSafeGeneratedPath(cwd, output);
    if (absolutePath === null) {
      violations.push(`Generated output path is unsafe: ${output}`);
      resolvedOutputs.set(output, null);
      return null;
    }
    const identity = await resolvePhysicalOutputIdentity(absolutePath);
    if (identity === null) {
      violations.push(`Generated output path is unsafe: ${output}`);
      resolvedOutputs.set(output, null);
      return null;
    }
    const resolved = { absolutePath, identity };
    resolvedOutputs.set(output, resolved);
    return resolved;
  };

  const expectedIdentities = new Set<string>();
  for (const output of expected.outputs) {
    const resolved = await resolveOutput(output);
    if (resolved) {
      expectedIdentities.add(resolved.identity);
    }
  }
  const existingIdentities = new Set<string>();
  for (const output of existing?.outputs ?? []) {
    const resolved = await resolveOutput(output);
    if (resolved) {
      existingIdentities.add(resolved.identity);
    }
  }

  for (const output of expected.outputs) {
    const resolved = await resolveOutput(output);
    if (resolved === null) {
      continue;
    }
    const content = await readExisting(resolved.absolutePath);
    if (
      content !== null &&
      !policyManagedOutputs.has(output) &&
      !isAthenaGeneratedSource(content)
    ) {
      violations.push(`Generated output is not Athena-owned: ${output}`);
    }
  }

  for (const output of existing?.outputs ?? []) {
    const resolved = await resolveOutput(output);
    if (resolved === null) {
      continue;
    }
    if (expectedOutputs.has(output) || expectedIdentities.has(resolved.identity)) {
      continue;
    }
    const content = await readExisting(resolved.absolutePath);
    if (content === null) {
      continue;
    }
    if (isAthenaGeneratedSource(content)) {
      deletions.push(output);
      continue;
    }
    violations.push(`Generated output is no longer Athena-owned: ${output}`);
  }

  return { deletions, violations };
}

async function deleteGeneratedFiles(
  files: string[],
  cwd: string,
  dryRun: boolean
): Promise<string[]> {
  const deletedFiles: string[] = [];
  for (const file of files) {
    const absolutePath = await resolveSafeGeneratedPath(cwd, file);
    if (absolutePath === null) {
      continue;
    }
    const content = await readExisting(absolutePath);
    if (content === null || !isAthenaGeneratedSource(content)) {
      continue;
    }
    if (!dryRun) {
      await unlink(absolutePath);
    }
    deletedFiles.push(file);
  }
  return deletedFiles;
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
    const absolutePath = await resolveSafeGeneratedPath(cwd, file.path);
    if (absolutePath === null) {
      throw new Error(`Generated output path is unsafe: ${file.path}`);
    }
    const existingContent = await readExisting(absolutePath);
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
  const check = options.check === true;
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
      dryRun: dryRun || check,
      loaded: { config, configPath },
      mode: config.provider.mode,
      provider: config.provider,
      schemas: effectiveSchemas,
    });

    configEnsure = {
      action: ensureResult.action,
      changes: ensureResult.changes,
      discoveryError: ensureResult.discoveryError,
      path: ensureResult.path,
      reason: ensureResult.reason,
      schemaProvenance: ensureResult.schemaProvenance,
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
  const generatedManifest = buildGeneratedManifest({
    configPath,
    cwd,
    files: generated.files,
  });
  const existingManifestRead = await readExistingManifest(cwd);
  const existingManifest = existingManifestRead.manifest;
  const manifestOwnership = existingManifestRead.error
    ? { deletions: [], violations: [existingManifestRead.error] }
    : await resolveManifestOwnership(
        existingManifest,
        generatedManifest,
        cwd,
        generated.files,
        config
      );
  const ownership = manifestOwnership.violations;
  const diagnostics: GeneratorDiagnostic[] = [];
  if (existingManifestRead.error) {
    diagnostics.push({
      code: "ATHENA_GENERATOR_MANIFEST_INVALID",
      message: existingManifestRead.error,
      severity: "error",
    });
  }
  for (const [filterName, selection] of [
    ["includeTables", config.filter.raw?.includeTables],
    ["excludeTables", config.filter.raw?.excludeTables],
  ] as const) {
    for (const selector of findDuplicateTableSelectors(selection)) {
      diagnostics.push({
        code: "ATHENA_GENERATOR_DUPLICATE_TABLE_SELECTOR",
        message: `${filterName} contains duplicate table selector "${selector}".`,
        severity: options.strict ? "error" : "warning",
      });
    }
  }
  for (const message of ownership) {
    diagnostics.push({
      code: "ATHENA_GENERATOR_OWNERSHIP_VIOLATION",
      message,
      severity: "error",
    });
  }
  const hasFatalDiagnostics = diagnostics.some(
    (diagnostic) => diagnostic.severity === "error"
  );
  if (hasFatalDiagnostics) {
    return {
      ...generated,
      config,
      configEnsure,
      configPath,
      convergence: ownership.length > 0 ? "ownership-violation" : "failed",
      deletedFiles: [],
      diagnostics,
      generatedManifest,
      generatedManifestPath: GENERATED_MANIFEST_REL,
      ownershipViolations: ownership,
      skippedFiles: [],
      writtenDetails: [],
      writtenFiles: [],
    };
  }
  const writeResult = await writeArtifacts(
    generated.files,
    cwd,
    config,
    dryRun || check
  );
  const deletedFiles = await deleteGeneratedFiles(
    manifestOwnership.deletions,
    cwd,
    dryRun || check
  );

  const generatedManifestPath = await writeGeneratedManifest(
    cwd,
    generatedManifest,
    dryRun || check
  );

  const configChangesPending =
    configEnsure?.action === "created" || configEnsure?.action === "updated";
  const artifactsChangesPending =
    writeResult.writtenDetails.length > 0 ||
    deletedFiles.length > 0 ||
    writeResult.skippedFiles.some((file) => file.reason !== "already-current");
  const manifestChangesPending =
    existingManifest === null ||
    JSON.stringify(existingManifest) !== JSON.stringify(generatedManifest);
  const changesPending =
    configChangesPending || artifactsChangesPending || manifestChangesPending;

  return {
    ...generated,
    config,
    configEnsure,
    configPath,
    convergence:
      dryRun || check
        ? changesPending
          ? "stale"
          : "current"
        : writeResult.skippedFiles.some(
              (file) => file.reason !== "already-current"
            )
          ? "stale"
          : "current",
    deletedFiles,
    diagnostics,
    generatedManifest,
    generatedManifestPath,
    ownershipViolations: ownership,
    skippedFiles: writeResult.skippedFiles,
    writtenDetails: writeResult.writtenDetails,
    writtenFiles: writeResult.writtenFiles,
  };
}
