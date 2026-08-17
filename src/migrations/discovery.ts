import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checksumMigrationSql } from "./checksum.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY } from "./constants.ts";
import { assertMigrationSqlAllowsOuterTransaction } from "./sql-guards.ts";
import { MigrationError, type MigrationFile } from "./types.ts";

export { DEFAULT_MIGRATIONS_DIRECTORY };

/**
 * Canonical filename pattern: `<digits>_<name>.sql`
 * Digits may be any positive length (0001, 01, 10001, …).
 * Gaps in version numbers are allowed; duplicates are not.
 */
const MIGRATION_FILENAME_RE = /^(\d+)_(.+)\.sql$/i;

const IGNORED_BASENAMES = new Set([
  ".ds_store",
  ".gitkeep",
  "readme",
  "readme.md",
  "readme.txt",
]);

function shouldIgnoreEntry(filename: string): boolean {
  const base = filename.toLowerCase();
  if (base.startsWith(".")) {
    return true;
  }
  if (IGNORED_BASENAMES.has(base)) {
    return true;
  }
  // Non-SQL incidental files (docs, keep files) are ignored.
  if (!base.endsWith(".sql")) {
    return true;
  }
  return false;
}

function formatVersion(version: number, width: number): string {
  return String(version).padStart(Math.max(width, 4), "0");
}

/**
 * Parses a migration basename into version + name.
 * Returns undefined when the name is not a migration SQL file pattern.
 */
export function parseMigrationFilename(
  filename: string
): { name: string; version: number } | undefined {
  const match = MIGRATION_FILENAME_RE.exec(filename);
  if (!match) {
    return undefined;
  }
  const version = Number.parseInt(match[1] ?? "", 10);
  const name = match[2] ?? "";
  if (!Number.isFinite(version) || version < 0 || name.length === 0) {
    return undefined;
  }
  return { name, version };
}

export interface DiscoverMigrationsOptions {
  /** Absolute or cwd-relative directory path. */
  directory: string;
  cwd?: string;
}

/**
 * Discovers and loads ordered migration files from a directory.
 *
 * Rules:
 * - Ignores incidental non-SQL files (README.md, .gitkeep, dotfiles).
 * - Rejects malformed `*.sql` filenames.
 * - Rejects duplicate versions.
 * - Orders by numeric version ascending (gaps allowed).
 */
export async function discoverMigrations(
  options: DiscoverMigrationsOptions
): Promise<MigrationFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const absoluteDirectory = resolve(cwd, options.directory);

  let directoryStat;
  try {
    directoryStat = await stat(absoluteDirectory);
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw new MigrationError(
      "DISCOVERY",
      `Unable to read migration directory "${options.directory}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  if (!directoryStat.isDirectory()) {
    throw new MigrationError(
      "DISCOVERY",
      `Migration path "${options.directory}" is not a directory.`
    );
  }

  let entries: string[];
  try {
    entries = await readdir(absoluteDirectory);
  } catch (error) {
    throw new MigrationError(
      "DISCOVERY",
      `Unable to list migration directory "${options.directory}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  const parsed: Array<{
    filename: string;
    name: string;
    path: string;
    version: number;
  }> = [];
  const malformedSql: string[] = [];

  for (const filename of entries) {
      // Ignore README/.gitkeep/dotfiles and other non-SQL incidental files.
      if (shouldIgnoreEntry(filename)) {
        continue;
      }

      // Remaining entries are *.sql (shouldIgnore filters non-sql).
      const identity = parseMigrationFilename(filename);
      if (!identity) {
        malformedSql.push(join(options.directory, filename).replace(/\\/g, "/"));
        continue;
      }

      parsed.push({
        filename,
        name: identity.name,
        path: join(absoluteDirectory, filename),
        version: identity.version,
      });
    }

  if (malformedSql.length > 0) {
    throw new MigrationError(
      "DISCOVERY",
      [
        "Migration error:",
        "Malformed migration filename(s). Expected <digits>_<name>.sql:",
        ...malformedSql.map((path) => `  ${path}`),
      ].join("\n")
    );
  }

  const byVersion = new Map<number, string[]>();
  for (const item of parsed) {
    const list = byVersion.get(item.version) ?? [];
    list.push(join(options.directory, item.filename).replace(/\\/g, "/"));
    byVersion.set(item.version, list);
  }

  const duplicates = [...byVersion.entries()].filter(
    ([, paths]) => paths.length > 1
  );
  if (duplicates.length > 0) {
    const blocks = duplicates.map(([version, paths]) => {
      const width = Math.max(
        4,
        ...paths.map((p) => {
          const base = p.split("/").pop() ?? "";
          const m = /^(\d+)_/.exec(base);
          return m?.[1]?.length ?? 4;
        })
      );
      return [
        `Duplicate migration version ${formatVersion(version, width)}:`,
        ...paths.map((path) => `  ${path}`),
      ].join("\n");
    });
    throw new MigrationError(
      "DISCOVERY",
      ["Migration error:", ...blocks].join("\n")
    );
  }

  parsed.sort((a, b) => a.version - b.version || a.filename.localeCompare(b.filename));

  const migrations: MigrationFile[] = [];
  for (const item of parsed) {
    let sql: string;
    try {
      sql = await readFile(item.path, "utf8");
    } catch (error) {
      throw new MigrationError(
        "DISCOVERY",
        `Unable to read migration file "${item.filename}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }

    assertMigrationSqlAllowsOuterTransaction(sql, item.filename);

        migrations.push({
          checksum: checksumMigrationSql(sql),
          filename: item.filename,
          name: item.name,
          path: item.path,
          sql,
          version: item.version,
        });
      }

  return migrations;
}
