/**
 * Node-only writer for AthenaModels → dialect `.sql` files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ModelSqlFile,
  type ModelSqlInput,
  type ModelsToSqlFilesOptions,
  modelsToSqlFiles,
} from "./model-sql.ts";

export interface WriteModelSqlFilesOptions extends ModelsToSqlFilesOptions {
  /** Directory that receives the `.sql` tree. */
  outDir: string;
}

/**
 * Write AthenaModels → dialect `.sql` files under `outDir`.
 *
 * Example layout:
 * ```
 * outDir/
 *   postgres/public/users.sql
 *   d1/public/users.sql   // content uses bare "users"
 * ```
 */
export async function writeModelSqlFiles(
  input: ModelSqlInput,
  options: WriteModelSqlFilesOptions
): Promise<ModelSqlFile[]> {
  const outDir = options.outDir?.trim();
  if (!outDir) {
    throw new Error("writeModelSqlFiles requires options.outDir");
  }

  const files = modelsToSqlFiles(input, options);
  await mkdir(outDir, { recursive: true });

  for (const file of files) {
    const absolute = path.join(outDir, file.filename);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, "utf8");
  }

  return files;
}
