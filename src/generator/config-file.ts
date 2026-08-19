import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findGeneratorConfigPath, loadGeneratorConfig } from "./config.ts";
import {
  detectAuthorityMode,
  formatSchemaFallbackMessages,
  resolveGeneratorDatabaseAuthority,
  type GeneratorSchemaProvenance,
} from "./database-authority.ts";
import {
  discoverPostgresSchemas,
  mergeSchemaSelections,
  schemasEqual,
} from "./schema-discovery.ts";
import {
  DEFAULT_POSTGRES_SCHEMAS,
  normalizeSchemaSelection,
} from "./schema-selection.ts";
import type {
  GeneratorProviderConfig,
  GeneratorProviderInputConfig,
  LoadedGeneratorConfig,
  NormalizedAthenaGeneratorConfig,
} from "./types.ts";

export type GeneratorConfigFileAction =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped";

export type GeneratorConfigProviderMode = "direct" | "gateway" | "auto";

export interface EnsureGeneratorConfigFileOptions {
  /** Explicit path relative to cwd or absolute. Defaults to discovered path or `athena.config.ts`. */
  configPath?: string;
  cwd?: string;
  /**
   * Discover live schemas and auto-fill `provider.schemas`.
   * Defaults to true.
   */
  discoverSchemas?: boolean;
  /**
   * Test/programmatic seam for live schema discovery (defaults to
   * `discoverPostgresSchemas`).
   */
  discoverSchemasImpl?: (
    provider: GeneratorProviderConfig
  ) => Promise<string[]>;
  /**
   * When false, never write to disk (report would-be action only).
   * Defaults to false.
   */
  dryRun?: boolean;
  /**
   * When true, rewrite the full modern template even if a file already exists.
   * Defaults to false (intelligent surgical update only).
   */
  force?: boolean;
  /**
   * Optional pre-loaded config (skips a second disk load).
   */
  loaded?: LoadedGeneratorConfig;
  /** Provider mode preference when creating a new file. */
  mode?: GeneratorConfigProviderMode;
  /**
   * Pre-resolved provider used for schema discovery (avoids re-normalizing).
   */
  provider?: GeneratorProviderConfig;
  /**
   * Explicit schemas to write when discovery is disabled or fails.
   */
  schemas?: readonly string[];
}

export interface EnsureGeneratorConfigFileResult {
  absolutePath: string;
  action: GeneratorConfigFileAction;
  changes: string[];
  content?: string;
  discoveryError?: string;
  mode: "direct" | "gateway";
  path: string;
  reason?: string;
  /** How `schemas` were chosen for this ensure pass. */
  schemaProvenance: GeneratorSchemaProvenance;
  schemas: string[];
}

type DetectedMode = "direct" | "gateway";

/**
 * Picks a provider mode from env when the caller did not force one.
 * Prefers direct when a connection string is present; otherwise gateway.
 * Callers that need `.env*` awareness should apply project env first
 * (`applyGeneratorProjectEnv` / `resolveGeneratorDatabaseAuthority`).
 */
export function detectGeneratorProviderMode(
  preferred: GeneratorConfigProviderMode = "auto"
): DetectedMode {
  return detectAuthorityMode(preferred);
}

function formatStringArray(values: readonly string[], indent: string): string {
  if (values.length === 0) {
    return "[]";
  }
  const inner = values
    .map((value) => `${indent}  ${JSON.stringify(value)}`)
    .join(",\n");
  return `[\n${inner},\n${indent}]`;
}

function buildDirectProviderBlock(schemas: readonly string[]): string {
  return `  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { optional: true }),
    schemas: ${formatStringArray(schemas, "    ")},
  }`;
}

function buildGatewayProviderBlock(schemas: readonly string[]): string {
  return `  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: generatorEnv("ATHENA_URL"),
    apiKey: generatorEnv("ATHENA_API_KEY"),
    client: generatorEnv("ATHENA_CLIENT", { optional: true }),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "postgres" }),
    schemas: ${formatStringArray(schemas, "    ")},
  }`;
}

/**
 * Renders a modern, typed `athena.config.ts` using `defineGeneratorConfig` + `generatorEnv`.
 * Secrets stay env-backed so gateway and direct modes both work without hardcoding keys.
 */
export function renderGeneratorConfigFile(options: {
  mode: DetectedMode;
  schemas?: readonly string[];
}): string {
  const schemas =
    options.schemas && options.schemas.length > 0
      ? [...options.schemas]
      : [...DEFAULT_POSTGRES_SCHEMAS];

  const providerBlock =
    options.mode === "gateway"
      ? buildGatewayProviderBlock(schemas)
      : buildDirectProviderBlock(schemas);

  return `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
${providerBlock},
  output: {
    format: "table-builder",
    preset: "athena-direct",
    targets: {
      model: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      schema: "src/lib/athena/generated/schema/{schema_kebab}.ts",
      database: "src/lib/athena/generated/relations.ts",
      registry: "src/lib/athena/generated/registry.ts",
    },
    placeholderMap: {
      namespace: "athena",
    },
  },
  naming: {
    modelType: "pascal",
    modelConst: "camel",
    schemaConst: "camel",
    databaseConst: "camel",
    registryConst: "camel",
  },
  features: {
    emitRelations: true,
    emitRegistry: true,
  },
  experimental: {
    postgresGatewayIntrospection: false,
    scyllaProviderContracts: true,
  },
});
`;
}

function resolveConfigPath(
  cwd: string,
  configPath?: string
): {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
} {
  if (configPath) {
    const absolutePath = resolve(cwd, configPath);
    return {
      absolutePath,
      exists: existsSync(absolutePath),
      relativePath: configPath.replace(/\\/g, "/"),
    };
  }

  const discovered = findGeneratorConfigPath(cwd);
  if (discovered) {
    const relativePath = discovered.startsWith(cwd)
      ? discovered
          .slice(cwd.length)
          .replace(/^[/\\]/, "")
          .replace(/\\/g, "/")
      : "athena.config.ts";
    return {
      absolutePath: discovered,
      exists: true,
      relativePath,
    };
  }

  const absolutePath = resolve(cwd, "athena.config.ts");
  return {
    absolutePath,
    exists: false,
    relativePath: "athena.config.ts",
  };
}

function providerModeFromConfig(
  provider: GeneratorProviderConfig | GeneratorProviderInputConfig | undefined,
  preferred: GeneratorConfigProviderMode
): DetectedMode {
  if (provider && provider.kind === "postgres") {
    if (provider.mode === "gateway") {
      return "gateway";
    }
    if (provider.mode === "direct") {
      return "direct";
    }
  }
  return detectGeneratorProviderMode(preferred);
}

function schemasFromNormalized(
  config: NormalizedAthenaGeneratorConfig
): string[] {
  if (config.provider.kind !== "postgres") {
    return [...DEFAULT_POSTGRES_SCHEMAS];
  }
  return normalizeSchemaSelection(config.provider.schemas);
}

/**
 * Updates only the `schemas:` value inside an existing TypeScript config source.
 * Supports:
 * - `schemas: ["public", "athena"]`
 * - `schemas: generatorEnv.list("...", { default: ["public"] })`
 *
 * Returns undefined when the file cannot be updated surgically (caller may full-render).
 */
export function patchSchemasInConfigSource(
  source: string,
  schemas: readonly string[]
): string | undefined {
  const formattedInline = `[${schemas.map((value) => JSON.stringify(value)).join(", ")}]`;
  const formattedMultiline = formatStringArray(schemas, "    ");

  // Prefer generatorEnv.list default updates so env override still works.
  const listDefaultPattern =
    /(schemas\s*:\s*generatorEnv\.list\s*\(\s*['"][^'"]+['"]\s*,\s*\{[\s\S]*?default\s*:\s*)(\[[^\]]*\])/m;
  if (listDefaultPattern.test(source)) {
    return source.replace(listDefaultPattern, `$1${formattedInline}`);
  }

  // Literal array assignment on provider.schemas.
  const literalPattern = /(schemas\s*:\s*)(\[[^\]]*\])/m;
  if (literalPattern.test(source)) {
    const usesMultiline = /schemas\s*:\s*\[\s*\n/.test(source);
    return source.replace(
      literalPattern,
      `$1${usesMultiline ? formattedMultiline : formattedInline}`
    );
  }

  // Missing schemas field: inject after kind/mode block if we can find provider mode.
  const modeLine = /(mode\s*:\s*["'](?:direct|gateway)["']\s*,)/m;
  if (modeLine.test(source)) {
    return source.replace(modeLine, `$1\n    schemas: ${formattedInline},`);
  }
  return undefined;
}

function extractLiteralSchemas(source: string): string[] | undefined {
  const listDefaultMatch = source.match(
    /schemas\s*:\s*generatorEnv\.list\s*\(\s*['"][^'"]+['"]\s*,\s*\{[\s\S]*?default\s*:\s*(\[[^\]]*\])/m
  );
  const literalMatch =
    listDefaultMatch ?? source.match(/schemas\s*:\s*(\[[^\]]*\])/m);
  if (!literalMatch) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(literalMatch[1].replace(/'/g, '"')) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
  } catch {
    // Malformed JSON array literal — treat as no schemas.
  }
  return undefined;
}

interface SchemaResolution {
  discoveryError?: string;
  provenance: GeneratorSchemaProvenance;
  schemas: string[];
}

async function resolveDiscoveredSchemas(options: {
  cwd: string;
  discoverSchemas: boolean;
  discoverSchemasImpl?: (
    provider: GeneratorProviderConfig
  ) => Promise<string[]>;
  provider?: GeneratorProviderConfig;
  loaded?: LoadedGeneratorConfig;
  explicit?: readonly string[];
  mode: GeneratorConfigProviderMode;
}): Promise<SchemaResolution> {
  if (options.explicit && options.explicit.length > 0) {
    return {
      provenance: "explicit",
      schemas: normalizeSchemaSelection(options.explicit),
    };
  }

  if (!options.discoverSchemas) {
    if (options.loaded) {
      return {
        provenance: "configured",
        schemas: schemasFromNormalized(options.loaded.config),
      };
    }
    return {
      provenance: "fallback",
      schemas: [...DEFAULT_POSTGRES_SCHEMAS],
    };
  }

  let restoreEnv = () => {};
  try {
    const authority = resolveGeneratorDatabaseAuthority({
      // When a loaded/explicit provider is already normalized, env was applied
      // during load — still apply here for environment-probe so `.env*` works.
      applyProjectEnv: true,
      cwd: options.cwd,
      loaded: options.loaded,
      mode: options.mode,
      provider: options.provider,
    });
    restoreEnv = authority.restoreEnv;

    const discover = options.discoverSchemasImpl ?? discoverPostgresSchemas;
    const discovered = await discover(authority.provider);
    if (discovered.length === 0) {
      if (options.loaded) {
        return {
          provenance: "configured",
          schemas: schemasFromNormalized(options.loaded.config),
        };
      }
      return {
        discoveryError:
          "live catalog returned no non-system schemas with base tables",
        provenance: "fallback",
        schemas: [...DEFAULT_POSTGRES_SCHEMAS],
      };
    }

    if (options.loaded) {
      return {
        provenance: "discovered",
        schemas: mergeSchemaSelections(
          schemasFromNormalized(options.loaded.config),
          discovered
        ),
      };
    }

    return { provenance: "discovered", schemas: discovered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.loaded) {
      return {
        discoveryError: message,
        provenance: "configured",
        schemas: schemasFromNormalized(options.loaded.config),
      };
    }
    return {
      discoveryError: message,
      provenance: "fallback",
      schemas: [...DEFAULT_POSTGRES_SCHEMAS],
    };
  } finally {
    restoreEnv();
  }
}

/**
 * Creates or intelligently updates `athena.config.ts`.
 *
 * Intelligence rules:
 * - missing file → write modern direct/gateway template with env-backed secrets
 * - existing file + force → full rewrite
 * - existing file → only patch `provider.schemas` when auto-fill finds new values
 * - skip write when content/schemas already match (no churn, safe for typecheck CI)
 * - never removes user-listed schemas that discovery did not return
 * - gateway mode uses the same template surface as direct (generatorEnv for url/key)
 */
export async function ensureGeneratorConfigFile(
  options: EnsureGeneratorConfigFileOptions = {}
): Promise<EnsureGeneratorConfigFileResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun === true;
  const discoverSchemas = options.discoverSchemas !== false;
  const force = options.force === true;
  const preferredMode = options.mode ?? "auto";

  const pathInfo = resolveConfigPath(cwd, options.configPath);
  const changes: string[] = [];

  let loaded = options.loaded;
  if (!loaded && pathInfo.exists && !force) {
    try {
      loaded = await loadGeneratorConfig({
        configPath: pathInfo.absolutePath,
        cwd,
      });
    } catch {
      // Fall through to create/replace when existing file is unloadable and force is off:
      // only patch if we can read text; otherwise report skipped with reason.
    }
  }

  // Resolve mode with the same project-env authority migrate uses, so
  // `.env` / `.env.local` DATABASE_URL is visible before discovery.
  let mode: DetectedMode = providerModeFromConfig(
    loaded?.config.provider ?? options.provider,
    preferredMode
  );
  try {
    const authority = resolveGeneratorDatabaseAuthority({
      applyProjectEnv: true,
      cwd,
      loaded,
      mode: preferredMode,
      provider: options.provider ?? loaded?.config.provider,
    });
    mode = authority.mode;
    authority.restoreEnv();
  } catch {
    // Mode probe may fail when connection info is missing; keep preferred/default.
    mode = providerModeFromConfig(
      loaded?.config.provider ?? options.provider,
      preferredMode
    );
  }

  const schemaResolution = await resolveDiscoveredSchemas({
    cwd,
    discoverSchemas,
    discoverSchemasImpl: options.discoverSchemasImpl,
    explicit: options.schemas,
    loaded,
    mode: preferredMode,
    provider: options.provider ?? loaded?.config.provider,
  });

  if (schemaResolution.provenance === "discovered") {
    changes.push(`schemas-discovered: ${schemaResolution.schemas.join(",")}`);
  } else if (schemaResolution.provenance === "fallback") {
    changes.push(
      ...formatSchemaFallbackMessages({
        discoveryError: schemaResolution.discoveryError,
        expectedLiveSchemas: ["public", "athena"],
        schemas: schemaResolution.schemas,
      })
    );
  } else if (schemaResolution.discoveryError) {
    changes.push(`schema-discovery-failed: ${schemaResolution.discoveryError}`);
  }

  // --- Create path ---
  if (!pathInfo.exists || force) {
    const content = renderGeneratorConfigFile({
      mode,
      schemas: schemaResolution.schemas,
    });

    if (pathInfo.exists) {
      changes.push("force-rewrote-config");
    } else {
      changes.push("created-modern-config");
    }

    if (!dryRun) {
      await mkdir(dirname(pathInfo.absolutePath), { recursive: true });
      await writeFile(pathInfo.absolutePath, content, "utf8");
    }

    return {
      absolutePath: pathInfo.absolutePath,
      action: pathInfo.exists ? "updated" : "created",
      changes,
      content,
      discoveryError: schemaResolution.discoveryError,
      mode,
      path: pathInfo.relativePath,
      reason: pathInfo.exists ? "force rewrite" : "config file missing",
      schemaProvenance: schemaResolution.provenance,
      schemas: schemaResolution.schemas,
    };
  }

  // --- Update path (intelligent, non-destructive) ---
  const existingSource = await readFile(pathInfo.absolutePath, "utf8");
  const existingLiteralSchemas = extractLiteralSchemas(existingSource);
  const existingSchemas =
    existingLiteralSchemas ??
    (loaded
      ? schemasFromNormalized(loaded.config)
      : [...DEFAULT_POSTGRES_SCHEMAS]);

  if (schemasEqual(existingSchemas, schemaResolution.schemas)) {
    return {
      absolutePath: pathInfo.absolutePath,
      action: "unchanged",
      changes: changes.length > 0 ? changes : ["schemas-already-current"],
      content: existingSource,
      discoveryError: schemaResolution.discoveryError,
      mode,
      path: pathInfo.relativePath,
      reason: "schemas already match discovered/configured set",
      schemaProvenance: schemaResolution.provenance,
      schemas: existingSchemas,
    };
  }

  const patched = patchSchemasInConfigSource(
    existingSource,
    schemaResolution.schemas
  );
  if (!patched) {
    return {
      absolutePath: pathInfo.absolutePath,
      action: "skipped",
      changes: [
        ...changes,
        "could-not-patch-schemas-surgically",
        "re-run with force=true to rewrite full template",
      ],
      content: existingSource,
      discoveryError: schemaResolution.discoveryError,
      mode,
      path: pathInfo.relativePath,
      reason:
        "existing config schemas could not be updated surgically without risking a destructive rewrite",
      schemaProvenance: schemaResolution.provenance,
      schemas: existingSchemas,
    };
  }

  if (patched === existingSource) {
    return {
      absolutePath: pathInfo.absolutePath,
      action: "unchanged",
      changes: [...changes, "patch-noop"],
      content: existingSource,
      discoveryError: schemaResolution.discoveryError,
      mode,
      path: pathInfo.relativePath,
      reason: "patch produced identical content",
      schemaProvenance: schemaResolution.provenance,
      schemas: existingSchemas,
    };
  }

  changes.push(
    `schemas-updated: ${existingSchemas.join(",")} -> ${schemaResolution.schemas.join(",")}`
  );

  if (!dryRun) {
    await writeFile(pathInfo.absolutePath, patched, "utf8");
  }

  return {
    absolutePath: pathInfo.absolutePath,
    action: "updated",
    changes,
    content: patched,
    discoveryError: schemaResolution.discoveryError,
    mode,
    path: pathInfo.relativePath,
    reason: "auto-filled provider.schemas",
    schemaProvenance: schemaResolution.provenance,
    schemas: schemaResolution.schemas,
  };
}
