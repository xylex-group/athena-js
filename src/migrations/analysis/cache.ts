import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ANALYSIS_IR_VERSION,
  ANALYZER_ID,
  ANALYZER_SEMANTICS_VERSION,
  PARSER_ID,
} from "./ast.ts";
import type { MigrationAnalysis } from "./semantic-ir.ts";

export const ANALYSIS_CACHE_FILENAME = "analysis-v2.json";

interface CacheFile {
  analyzerId: string;
  analyzerSemanticsVersion: number;
  irVersion: number;
  parserId: string;
  records: Record<string, MigrationAnalysis>;
}

function cachePath(cwd: string): string {
  return join(cwd, ".athena", "migrations", ANALYSIS_CACHE_FILENAME);
}

function cacheCompatible(parsed: CacheFile): boolean {
  return (
    parsed.irVersion === ANALYSIS_IR_VERSION &&
    parsed.parserId === PARSER_ID &&
    parsed.analyzerId === ANALYZER_ID &&
    parsed.analyzerSemanticsVersion === ANALYZER_SEMANTICS_VERSION
  );
}

export async function loadAnalysisCache(
  cwd: string
): Promise<Map<string, MigrationAnalysis>> {
  try {
    const raw = await readFile(cachePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!cacheCompatible(parsed)) {
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
    records[cacheKey(analysis.checksum, analysis.filename)] = analysis;
  }
  const dir = join(cwd, ".athena", "migrations");
  await mkdir(dir, { recursive: true });
  const payload: CacheFile = {
    analyzerId: ANALYZER_ID,
    analyzerSemanticsVersion: ANALYZER_SEMANTICS_VERSION,
    irVersion: ANALYSIS_IR_VERSION,
    parserId: PARSER_ID,
    records,
  };
  await writeFile(
    cachePath(cwd),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

export function cacheKey(checksum: string, filename: string): string {
  return `${ANALYZER_ID}:${checksum}:${filename}`;
}
