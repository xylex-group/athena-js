import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ANALYSIS_IR_VERSION, PARSER_ID } from "./ast.ts";
import type { MigrationAnalysis } from "./semantic-ir.ts";

export const ANALYSIS_CACHE_FILENAME = "analysis-v1.json";

interface CacheFile {
  irVersion: number;
  parserId: string;
  records: Record<string, MigrationAnalysis>;
}

function cachePath(cwd: string): string {
  return join(cwd, ".athena", "migrations", ANALYSIS_CACHE_FILENAME);
}

export async function loadAnalysisCache(
  cwd: string
): Promise<Map<string, MigrationAnalysis>> {
  try {
    const raw = await readFile(cachePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.irVersion !== ANALYSIS_IR_VERSION || parsed.parserId !== PARSER_ID) {
      return new Map();
    }
    return new Map(Object.entries(parsed.records ?? {}));
  } catch {
    return new Map();
  }
}

export async function saveAnalysisCache(
  cwd: string,
  analyses: readonly MigrationAnalysis[]
): Promise<void> {
  const records: Record<string, MigrationAnalysis> = {};
  for (const analysis of analyses) {
    records[`${analysis.checksum}:${analysis.filename}`] = analysis;
  }
  const dir = join(cwd, ".athena", "migrations");
  await mkdir(dir, { recursive: true });
  const payload: CacheFile = {
    irVersion: ANALYSIS_IR_VERSION,
    parserId: PARSER_ID,
    records,
  };
  await writeFile(cachePath(cwd), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function cacheKey(checksum: string, filename: string): string {
  return `${checksum}:${filename}`;
}
