import { listAthenaAuthCanonicalMigrations } from "../../auth/schema/migrations.ts";
import { analyzeAll } from "../analysis/compiler.ts";
import {
  applyAnalysis,
  emptyProjectedSchema,
  type ProjectedSchema,
} from "../analysis/projected-schema.ts";
import type { SchemaProvider } from "../analysis/schema-provider.ts";
import { checksumMigrationSql } from "../checksum.ts";
import type { MigrationFile } from "../types.ts";

export type { SchemaProvider } from "../analysis/schema-provider.ts";

export interface PackagedAuthPlanSlice {
  entries: readonly {
    action: string;
    ledgerState: string;
    version: number;
  }[];
}

export interface PackagedMigrationProjection {
  providers: SchemaProvider[];
  schema: ProjectedSchema;
}

function authFiles(): MigrationFile[] {
  return listAthenaAuthCanonicalMigrations().map((entry) => ({
    checksum: checksumMigrationSql(entry.sql),
    filename: entry.name,
    name: entry.name,
    path: entry.name,
    sql: entry.sql,
    version: entry.version,
  }));
}

function pendingAuthVersions(
  authPlan: PackagedAuthPlanSlice | undefined
): ReadonlySet<number> {
  if (!authPlan) {
    return new Set();
  }
  return new Set(
    authPlan.entries
      .filter(
        (entry) => entry.action === "apply" || entry.ledgerState === "absent"
      )
      .map((entry) => entry.version)
  );
}

export async function buildPackagedMigrationProjection(input: {
  authPlan?: PackagedAuthPlanSlice;
  cacheDir?: string;
}): Promise<PackagedMigrationProjection> {
  const pending = pendingAuthVersions(input.authPlan);
  if (pending.size === 0) {
    return {
      providers: [],
      schema: emptyProjectedSchema(),
    };
  }
  const files = authFiles().filter((file) => pending.has(file.version));
  const analyses = await analyzeAll(files, input.cacheDir);
  let schema = emptyProjectedSchema();
  const providers: SchemaProvider[] = [];
  for (const analysis of analyses) {
    schema = applyAnalysis(schema, analysis);
    for (const object of analysis.effects.creates) {
      providers.push({
        filename: analysis.filename,
        object,
        source: "embedded-auth",
        state: "pending",
        version: analysis.version,
      });
    }
  }
  return { providers, schema };
}
