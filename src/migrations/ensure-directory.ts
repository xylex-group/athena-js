import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EnsureApplicationMigrationsDirectoryOptions {
  /** Absolute migrations directory path. */
  directory: string;
  /** When true, report would-be creation without writing. */
  dryRun?: boolean;
  /** Write `.gitkeep` so an empty folder is committable. Defaults to true. */
  keepFile?: boolean;
}

export interface EnsureApplicationMigrationsDirectoryResult {
  created: boolean;
  directory: string;
  keepFileWritten: boolean;
}

/**
 * Creates the application SQL migrations directory when missing.
 *
 * Migrate used to print `Directory athena/migrations` even when the folder
 * did not exist. Init and migrate both call this so the advertised layout
 * is a real path (`athena/migrations/.gitkeep`).
 */
export async function ensureApplicationMigrationsDirectory(
  options: EnsureApplicationMigrationsDirectoryOptions
): Promise<EnsureApplicationMigrationsDirectoryResult> {
  const keepFile = options.keepFile !== false;
  const keepPath = join(options.directory, ".gitkeep");
  const directoryMissing = !existsSync(options.directory);
  const keepMissing = keepFile && !existsSync(keepPath);

  if (!(directoryMissing || keepMissing)) {
    return {
      created: false,
      directory: options.directory,
      keepFileWritten: false,
    };
  }

  if (options.dryRun) {
    return {
      created: directoryMissing,
      directory: options.directory,
      keepFileWritten: keepMissing,
    };
  }

  if (directoryMissing) {
    await mkdir(options.directory, { recursive: true });
  }
  if (keepMissing) {
    await writeFile(keepPath, "", "utf8");
  }

  return {
    created: directoryMissing,
    directory: options.directory,
    keepFileWritten: keepMissing,
  };
}
