import type {
  LoadedGeneratorConfig,
  NormalizedAthenaGeneratorConfig,
} from "../../generator/types.ts";

export interface CliProjectTarget {
  configPath: string;
  cwd: string;
  database: string;
  providerKind: string;
  providerMode: string;
}

function extractDatabaseName(connectionString: string): string | undefined {
  try {
    const normalized = connectionString.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    const name = url.pathname.replace(/^\//, "");
    return name.length > 0 ? decodeURIComponent(name) : undefined;
  } catch {
    /* invalid connection string */
  }
}

function databaseLabel(config: NormalizedAthenaGeneratorConfig): string {
  const { provider } = config;
  if (provider.kind === "postgres") {
    if (provider.mode === "direct") {
      return (
        provider.database ??
        extractDatabaseName(provider.connectionString) ??
        "postgres"
      );
    }
    return provider.database;
  }
  if (provider.kind === "scylla") {
    return provider.keyspace;
  }
  return "unknown";
}

/**
 * Provider/cwd labels from a loaded generator config. Parses URLs only —
 * never opens a database connection.
 */
export function resolveCliProjectTarget(
  loaded: LoadedGeneratorConfig,
  cwd: string
): CliProjectTarget {
  const { provider } = loaded.config;
  return {
    configPath: loaded.configPath,
    cwd,
    database: databaseLabel(loaded.config),
    providerKind: provider.kind,
    providerMode: provider.mode,
  };
}
