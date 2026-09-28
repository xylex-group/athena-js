import type { AthenaConfig } from "../../generator/types.ts";
import {
  type CompileMigrationsResult,
  compileMigrations,
} from "../analysis/index.ts";
import { emptyProjectedSchema } from "../analysis/projected-schema.ts";
import type { MigrationBackend } from "../backend.ts";
import {
  buildPackagedMigrationProjection,
  type PackagedAuthPlanSlice,
} from "../embedded/semantics.ts";
import { shouldApplyEmbeddedAuthMigrations } from "../embedded-auth/enablement.ts";

export async function compileApplicationSemantics(input: {
  authPlan?: PackagedAuthPlanSlice;
  backend: MigrationBackend;
  cacheDir?: string;
  local: readonly import("../types.ts").MigrationFile[];
  modules?: AthenaConfig["modules"];
  plan: import("../types.ts").MigrationPlan;
  strict?: boolean;
}): Promise<CompileMigrationsResult> {
  const catalog = await input.backend.inspectCatalog();
  const packaged = shouldApplyEmbeddedAuthMigrations(input.modules)
    ? await buildPackagedMigrationProjection({
        authPlan: input.authPlan,
        cacheDir: input.cacheDir,
      })
    : { providers: [], schema: emptyProjectedSchema() };
  return compileMigrations({
    appliedVersions: new Set(
      input.plan.applied.map((entry) => entry.migration.version)
    ),
    cacheDir: input.cacheDir,
    catalog,
    externalProviders: packaged.providers,
    files: input.local,
    projectedPrerequisites: packaged.schema,
    strict: input.strict,
  });
}

export function blockingSemantic(result: CompileMigrationsResult): boolean {
  return result.diagnostics.some(
    (item) => item.classification !== "dynamic_sql"
  );
}
