import { resolve } from "node:path";
import type { NormalizedAthenaGeneratorConfig } from "../../generator/types.ts";
import { ATHENA_MIGRATE_COMMAND } from "../commands.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY } from "../constants.ts";
import { MigrationError } from "../types.ts";

export function resolveMigrationsDirectory(
  config: NormalizedAthenaGeneratorConfig,
  cwd: string
): string {
  const configured = config.migrations.directory;
  return resolve(cwd, configured || DEFAULT_MIGRATIONS_DIRECTORY);
}

export function providerLabel(config: NormalizedAthenaGeneratorConfig): string {
  const { provider } = config;
  if (provider.kind === "postgres") {
    return `postgres/${provider.mode}`;
  }
  return `${provider.kind}/${provider.mode}`;
}

export function databaseLabel(config: NormalizedAthenaGeneratorConfig): string {
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

export function extractDatabaseName(
  connectionString: string
): string | undefined {
  try {
    const normalized = connectionString.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    const name = url.pathname.replace(/^\//, "");
    return name.length > 0 ? decodeURIComponent(name) : undefined;
  } catch {
    /* invalid connection string */
  }
}

export function relativeDirectoryDisplay(
  cwd: string,
  absoluteDirectory: string
): string {
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const normalizedDir = absoluteDirectory.replace(/\\/g, "/");
  if (normalizedDir.startsWith(`${normalizedCwd}/`)) {
    return normalizedDir.slice(normalizedCwd.length + 1);
  }
  if (normalizedDir === normalizedCwd) {
    return ".";
  }
  return absoluteDirectory.replace(/\\/g, "/");
}

export function assertDirectPostgres(config: NormalizedAthenaGeneratorConfig): {
  connectionString: string;
  database?: string;
} {
  const { provider } = config;
  if (provider.kind !== "postgres") {
    throw new MigrationError(
      "PROVIDER",
      `${ATHENA_MIGRATE_COMMAND} currently requires a direct PostgreSQL provider.\nUnsupported provider: ${provider.kind}/${provider.mode}.`
    );
  }
  if (provider.mode !== "direct") {
    throw new MigrationError(
      "PROVIDER",
      [
        `${ATHENA_MIGRATE_COMMAND} currently requires a direct PostgreSQL provider.`,
        "Gateway-backed migration execution is not yet supported.",
        "Raw DDL needs privileged database access outside the normal query gateway.",
      ].join("\n")
    );
  }
  if (!provider.connectionString) {
    throw new MigrationError(
      "CONFIG",
      "Direct PostgreSQL provider is missing connectionString (set DATABASE_URL / PG_URL or provider.connectionString)."
    );
  }
  return {
    connectionString: provider.connectionString,
    database: provider.database,
  };
}
