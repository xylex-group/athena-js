import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProjectEnv } from "../cli/commands/env/project-env.ts";

const DIRECT_CONNECTION_STRING_ENV_KEYS = [
  "ATHENA_GENERATOR_PG_URL",
  "DATABASE_URL",
  "PG_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
] as const;
type DirectConnectionStringEnvKey =
  (typeof DIRECT_CONNECTION_STRING_ENV_KEYS)[number];

export interface LocalDatabaseUrlOptions {
  database: string;
  host: string;
  password: string;
  port: number;
  user: string;
}

export function buildLocalDatabaseUrl(
  options: LocalDatabaseUrlOptions
): string {
  return `postgres://${encodeURIComponent(options.user)}:${encodeURIComponent(options.password)}@${options.host}:${options.port}/${encodeURIComponent(options.database)}`;
}

/**
 * Resolve the file and key that own the effective direct connection string
 * using the generator's layered project-env precedence. Process environment
 * values are authoritative but cannot be updated by --write-env.
 */
export function resolveProjectEnvDatabaseUrlTarget(
  projectRoot: string,
  processEnv: Record<string, string | undefined> = process.env
): { envKey: DirectConnectionStringEnvKey; path: string } {
  const loaded = loadProjectEnv({ cwd: projectRoot, processEnv });
  const value = DIRECT_CONNECTION_STRING_ENV_KEYS.map((envKey) => ({
    envKey,
    value: loaded.values.get(envKey),
  })).find(({ value }) => value?.value);
  if (!value) {
    return { envKey: "DATABASE_URL", path: join(projectRoot, ".env") };
  }
  if (value.value?.source === "process") {
    throw new Error(
      `Cannot write ${value.envKey}: the effective value comes from the process environment.`
    );
  }
  if (!value.value?.sourcePath) {
    throw new Error(
      `Cannot write ${value.envKey}: the effective project env file could not be determined.`
    );
  }
  return { envKey: value.envKey, path: value.value.sourcePath };
}

export function resolveProjectEnvDatabaseUrlPath(
  projectRoot: string,
  processEnv: Record<string, string | undefined> = process.env
): string {
  return resolveProjectEnvDatabaseUrlTarget(projectRoot, processEnv).path;
}

export function updateEnvDatabaseUrl(
  path: string,
  databaseUrl: string,
  options: {
    envKey?: DirectConnectionStringEnvKey;
    force?: boolean;
    managedDatabaseUrl?: string;
  } = {}
): void {
  const envKey = options.envKey ?? "DATABASE_URL";
  let source = "";
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const databaseUrlAssignment = new RegExp(
    `^(\\s*)(export\\s+)?${envKey}\\s*=\\s*`
  );
  const assignments = lines.flatMap((line, index) => {
    const assignment = line.match(databaseUrlAssignment);
    return assignment ? [{ assignment, index }] : [];
  });
  const effective = assignments[assignments.length - 1];
  if (effective) {
    const { assignment, index } = effective;
    if (!assignment) {
      throw new Error(`Failed to parse the existing ${envKey} assignment.`);
    }
    const existingValue = normalizeEnvAssignmentValue(
      lines[index].slice(assignment[0].length)
    );
    const managedDatabaseUrl = options.managedDatabaseUrl ?? databaseUrl;
    if (
      existingValue &&
      !options.force &&
      !isManagedDatabaseUrl(existingValue, managedDatabaseUrl)
    ) {
      throw new Error(
        `Refusing to overwrite a non-local ${envKey} without force.`
      );
    }
    lines[index] =
      `${assignment[1]}${assignment[2] ?? ""}${envKey}=${databaseUrl}`;
    for (const duplicate of assignments
      .slice(0, -1)
      .map(({ index: duplicateIndex }) => duplicateIndex)
      .reverse()) {
      lines.splice(duplicate, 1);
    }
  } else if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.splice(lines.length - 1, 0, `${envKey}=${databaseUrl}`);
  } else {
    lines.push(`${envKey}=${databaseUrl}`);
  }
  writeFileSync(path, lines.join(newline), "utf8");
}

function normalizeEnvAssignmentValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1);
  }
  if (
    trimmed.startsWith("'") &&
    trimmed.endsWith("'") &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.search(/\s+#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

function isManagedDatabaseUrl(
  value: string,
  managedDatabaseUrl: string
): boolean {
  try {
    const url = new URL(value.trim().replace(/^['"]|['"]$/g, ""));
    const managed = new URL(
      managedDatabaseUrl.trim().replace(/^['"]|['"]$/g, "")
    );
    return (
      isLoopbackPostgresUrl(url) &&
      isLoopbackPostgresUrl(managed) &&
      url.hostname === managed.hostname &&
      url.port === managed.port &&
      url.pathname === managed.pathname &&
      url.username === managed.username
    );
  } catch {
    return false;
  }
}

function isLoopbackPostgresUrl(url: URL): boolean {
  return (
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]") &&
    url.port !== ""
  );
}
