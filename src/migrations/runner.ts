import { resolve } from "node:path";
import {
  createPostgresAuthDatabase,
  type AthenaAuthDatabase,
} from "../auth/local/database.ts";
import {
  type AthenaAuthMigrationPlan,
  getAthenaAuthExpectedLedger,
  migrateAthenaAuthSchema,
  planAthenaAuthSchema,
  repairAthenaAuthSchema,
} from "../auth/local/schema.ts";
import { AthenaAuthRuntimeError } from "../auth/local/errors.ts";
import { repairabilityForAuthMigration } from "../auth/local/schema-manifest.ts";
import { createCliUi, type AthenaCliUI } from "../cli/ui/index.ts";
import { loadGeneratorConfig } from "../generator/config.ts";
import type { NormalizedAthenaGeneratorConfig } from "../generator/types.ts";
import type { MigrationBackend } from "./backend.ts";
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  discoverMigrations,
} from "./discovery.ts";
import { planHasBlockingConflicts, planMigrations } from "./planner.ts";
import { createPostgresMigrationBackend } from "./postgres.ts";
import { buildMigrationReportView } from "./report.ts";
import {
  type AppliedMigrationResult,
  type MigrationCommandMode,
  MigrationError,
  type MigrationPlan,
  type MigrationRunSummary,
  type RunMigrationsOptions,
} from "./types.ts";

function resolveMigrationsDirectory(
  config: NormalizedAthenaGeneratorConfig,
  cwd: string
): string {
  const configured = config.migrations.directory;
  return resolve(cwd, configured || DEFAULT_MIGRATIONS_DIRECTORY);
}

function providerLabel(config: NormalizedAthenaGeneratorConfig): string {
  const { provider } = config;
  if (provider.kind === "postgres") {
    return `postgres/${provider.mode}`;
  }
  return `${provider.kind}/${provider.mode}`;
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

function extractDatabaseName(connectionString: string): string | undefined {
  try {
    const normalized = connectionString.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    const name = url.pathname.replace(/^\//, "");
    return name.length > 0 ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

function relativeDirectoryDisplay(cwd: string, absoluteDirectory: string): string {
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

function formatConflictBlock(plan: MigrationPlan): string {
  const lines: string[] = [];
  for (const conflict of plan.conflicts) {
    if (conflict.kind === "checksum-mismatch") {
      const filename =
        conflict.local?.filename ??
        `${String(conflict.version).padStart(4, "0")}_${conflict.applied?.name ?? "unknown"}.sql`;
      lines.push(
        [
          "Migration integrity error",
          "",
          `${filename} was already applied but its contents have changed.`,
          "",
          "Stored checksum:",
          conflict.applied?.checksum ?? "(missing)",
          "",
          "Current checksum:",
          conflict.local?.checksum ?? "(missing local file)",
          "",
          "Applied migrations are immutable.",
          "Create a new migration instead of editing an applied migration.",
        ].join("\n")
      );
      continue;
    }

    if (conflict.kind === "missing-local") {
      const label = conflict.applied
        ? `${String(conflict.version).padStart(4, "0")}_${conflict.applied.name}`
        : String(conflict.version).padStart(4, "0");
      lines.push(
        [
          "Migration history conflict",
          "",
          `Database contains migration ${label}`,
          "but no matching local migration exists.",
          "",
          "Refusing to continue because this checkout is older than the database migration history.",
        ].join("\n")
      );
    }
  }
  return lines.join("\n\n");
}

function assertDirectPostgres(
  config: NormalizedAthenaGeneratorConfig
): { connectionString: string; database?: string } {
  const { provider } = config;
  if (provider.kind !== "postgres") {
    throw new MigrationError(
      "PROVIDER",
      `athena-js migrate currently requires a direct PostgreSQL provider.\nUnsupported provider: ${provider.kind}/${provider.mode}.`
    );
  }
  if (provider.mode !== "direct") {
    throw new MigrationError(
      "PROVIDER",
      [
        "athena-js migrate currently requires a direct PostgreSQL provider.",
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

function resolveUi(options: RunMigrationsOptions): AthenaCliUI {
  if (options.ui) {
    return options.ui;
  }
  return createCliUi({
    json: options.json,
    plain: options.plain,
    write: options.log,
  });
}

async function openAuthDatabase(
  options: RunMigrationsOptions,
  connectionString: string
): Promise<AthenaAuthDatabase | undefined> {
  if (options.createAuthDatabase) {
    return options.createAuthDatabase(connectionString);
  }
  if (options.createBackend) {
    // Test backends typically skip live Auth DB access.
    return undefined;
  }
  return createPostgresAuthDatabase(connectionString);
}

function offlineExpectedAuthPlan(): AthenaAuthMigrationPlan {
  const expected = getAthenaAuthExpectedLedger();
  const entries = expected.map((entry) => ({
    version: entry.version,
    name: entry.name,
    checksum: entry.checksum ?? "",
    ledgerState: "absent" as const,
    schemaState: "unknown" as const,
    action: "apply" as const,
    repairability: repairabilityForAuthMigration(entry.version),
  }));
  return {
    entries,
    appliedCount: 0,
    pendingCount: entries.length,
    driftCount: 0,
    conflictCount: 0,
    hasBlockingDrift: false,
  };
}

async function loadAuthPlan(
  options: RunMigrationsOptions,
  connectionString: string,
  inspectSchema: boolean
): Promise<AthenaAuthMigrationPlan> {
  if (options.planAuthSchema) {
    return options.planAuthSchema();
  }
  const database = await openAuthDatabase(options, connectionString);
  if (!database) {
    // Test/backends without Auth DB still render the expected ledger offline.
    return offlineExpectedAuthPlan();
  }
  try {
    return await planAthenaAuthSchema(database, { inspectSchema });
  } finally {
    await database.close?.();
  }
}

async function applyEmbeddedAuthSchema(
  options: RunMigrationsOptions,
  connectionString: string,
  ui: AthenaCliUI
): Promise<void> {
  if (options.migrateAuthSchema) {
    ui.info("→ Embedded Auth schema applying");
    await options.migrateAuthSchema();
    ui.success("✓ Embedded Auth schema applied");
    return;
  }
  if (options.createBackend && !options.createAuthDatabase) {
    return;
  }
  ui.info("→ Embedded Auth schema applying");
  const database = await openAuthDatabase(options, connectionString);
  if (!database) {
    return;
  }
  try {
    await migrateAthenaAuthSchema(database);
  } finally {
    await database.close?.();
  }
  ui.success("✓ Embedded Auth schema applied");
}

function renderReport(
  ui: AthenaCliUI,
  summary: Pick<
    MigrationRunSummary,
    "providerLabel" | "databaseLabel" | "directory" | "plan" | "mode"
  >,
  authPlan: AthenaAuthMigrationPlan | undefined,
  outcome: string,
  diagnostics: MigrationRunSummary["diagnostics"] = []
): void {
  const report = buildMigrationReportView({
    summary,
    authPlan,
    outcome,
    diagnostics,
    logPath: undefined,
  });
  ui.renderMigrationReport(report);
}

/**
 * Programmatic migration runner (Node/tooling only).
 */
export async function runMigrations(
  options: RunMigrationsOptions = {}
): Promise<MigrationRunSummary> {
  const cwd = options.cwd ?? process.cwd();
  const ui = resolveUi(options);
  const log = options.log ?? ((message: string) => ui.info(message));
  const mode: MigrationCommandMode =
    options.mode ?? (options.dryRun ? "dry-run" : "apply");
  const dryRun =
    mode === "dry-run" || mode === "plan" || Boolean(options.dryRun);

  const loaded = await loadGeneratorConfig({
    configPath: options.configPath,
    cwd,
  });
  const config = loaded.config;
  const absoluteDirectory = resolveMigrationsDirectory(config, cwd);
  const directoryDisplay = relativeDirectoryDisplay(cwd, absoluteDirectory);

  const discover =
    options.discover ??
    ((directory: string) => discoverMigrations({ cwd, directory }));

  const local = await discover(
    absoluteDirectory.startsWith(cwd)
      ? relativeDirectoryDisplay(cwd, absoluteDirectory)
      : absoluteDirectory
  );

  let backend: MigrationBackend | undefined;
  let connectionString = "";
  const newlyApplied: AppliedMigrationResult[] = [];
  let plan: MigrationPlan = { applied: [], conflicts: [], pending: [] };
  let authPlan: AthenaAuthMigrationPlan | undefined;

  try {
    const pg = assertDirectPostgres(config);
    connectionString = pg.connectionString;
    backend =
      (await options.createBackend?.({
        connectionString: pg.connectionString,
        database: pg.database,
      })) ??
      (await createPostgresMigrationBackend({
        connectionString: pg.connectionString,
        database: pg.database,
      }));

    await backend.acquireLock();
    // Inspection modes must stay non-mutating: no CREATE SCHEMA/TABLE.
    // Apply/repair may bootstrap the ledger.
    if (mode === "apply" || mode === "repair") {
      await backend.ensureLedger();
    }
    const applied = await backend.listAppliedMigrations();
    plan = planMigrations({ applied, local });

    const summaryBase = {
      databaseLabel: databaseLabel(config),
      directory: directoryDisplay,
      dryRun,
      mode,
      plan,
      providerLabel: providerLabel(config),
    };

    if (mode === "repair") {
      authPlan = await loadAuthPlan(options, connectionString, true);
      const repairEntries =
        authPlan?.entries.filter((entry) => entry.action === "repair") ?? [];
      renderReport(
        ui,
        summaryBase,
        authPlan,
        repairEntries.length === 0
          ? "No Embedded Auth repairs required."
          : `${repairEntries.length} migration(s) require repair`,
        []
      );

      if (repairEntries.length === 0) {
        return {
          ...summaryBase,
          appliedCount: plan.applied.length,
          authPlan,
          conflicts: plan.conflicts,
          diagnostics: [],
          failedCount: 0,
          newlyApplied: [],
          pendingCount: plan.pending.length,
          skippedCount: 0,
        };
      }

      if (!options.yes && !dryRun) {
        if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
          throw new MigrationError(
            "CONFIG",
            [
              "migrate repair requires confirmation.",
              "",
              "Re-run with --yes in CI/non-TTY environments:",
              "",
              "  athena-js migrate repair --yes",
            ].join("\n")
          );
        }
        const confirmed = await ui.confirm(
          "Repair drifted Embedded Auth schema now?"
        );
        if (!confirmed) {
          throw new MigrationError("CONFIG", "Repair cancelled.");
        }
      }

      if (options.repairAuthSchema) {
        await options.repairAuthSchema({ dryRun });
      } else if (!options.createBackend || options.createAuthDatabase) {
        const database = await openAuthDatabase(options, connectionString);
        if (database) {
          try {
            await repairAthenaAuthSchema(database, { dryRun });
          } finally {
            await database.close?.();
          }
        }
      }

      authPlan = await loadAuthPlan(options, connectionString, true);
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        skippedCount: dryRun ? repairEntries.length : 0,
      };
    }

    // Auth plan for status/plan/dry-run/apply presentation.
    // Status/plan inspect physical schema; dry-run may skip heavy inspect for speed
    // but status and apply paths must see drift.
    const inspectAuth =
      mode === "status" || mode === "plan" || mode === "apply";
    try {
      authPlan = await loadAuthPlan(options, connectionString, inspectAuth);
    } catch (error) {
      if (
        error instanceof AthenaAuthRuntimeError &&
        error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
      ) {
        throw new MigrationError("EXECUTION", error.publicMessage, {
          cause: error,
        });
      }
      // Ledger missing / connection issues during status: show expected offline later.
    }

    if (mode === "status" || mode === "plan") {
      const outcome = planHasBlockingConflicts(plan)
        ? "Application migration history has conflicts."
        : authPlan?.hasBlockingDrift
          ? "Embedded Auth schema drift detected."
          : plan.pending.length === 0 && (authPlan?.pendingCount ?? 0) === 0
            ? "Database is up to date."
            : "Pending migrations remain.";

      renderReport(ui, summaryBase, authPlan, outcome);

      if (planHasBlockingConflicts(plan)) {
        throw new MigrationError("HISTORY", formatConflictBlock(plan));
      }

      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        skippedCount: 0,
      };
    }

    if (planHasBlockingConflicts(plan)) {
      renderReport(
        ui,
        summaryBase,
        authPlan,
        "Application migration history has conflicts.",
        [{ level: "error", message: formatConflictBlock(plan) }]
      );
      throw new MigrationError("HISTORY", formatConflictBlock(plan));
    }

    if (mode === "dry-run") {
      const outcome =
        plan.pending.length === 0
          ? "No pending application migrations. No database changes were made."
          : `${plan.pending.length} pending application migration(s). No database changes were made.`;
      renderReport(ui, summaryBase, authPlan, outcome);
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        skippedCount: plan.pending.length,
      };
    }

    // apply
    if (authPlan?.hasBlockingDrift) {
      const driftMessage = [
        "Embedded Auth schema drift detected",
        "",
        ...authPlan.entries
          .filter((entry) => entry.schemaState === "drift")
          .flatMap((entry) => [
            entry.name,
            "",
            ...(entry.drift ?? []).map(
              (item) =>
                `  Missing ${item.kind.replace("missing-", "")}: ${item.object}`
            ),
            "",
          ]),
        "Migration history says these migrations were already applied.",
        "",
        "Athena will not silently modify a drifted schema.",
        "",
        "Run:",
        "",
        "  athena-js migrate repair",
      ].join("\n");
      renderReport(ui, summaryBase, authPlan, "Embedded Auth schema drift.", [
        { level: "error", code: "ATHENA_AUTH_SCHEMA_DRIFT", message: driftMessage },
      ]);
      throw new MigrationError("HISTORY", driftMessage);
    }

    if (local.length === 0 && plan.pending.length === 0) {
      ui.info("No application migrations found.");
      await applyEmbeddedAuthSchema(options, connectionString, ui);
      authPlan = await loadAuthPlan(options, connectionString, true);
      renderReport(ui, summaryBase, authPlan, "0 application migrations applied.");
      return {
        ...summaryBase,
        appliedCount: 0,
        authPlan,
        conflicts: [],
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: 0,
        skippedCount: 0,
      };
    }

    for (const entry of plan.applied) {
      ui.info(`✓ ${entry.migration.filename} already applied`);
    }

    if (plan.pending.length === 0) {
      ui.info("Application migrations are up to date.");
      await applyEmbeddedAuthSchema(options, connectionString, ui);
      authPlan = await loadAuthPlan(options, connectionString, true);
      renderReport(
        ui,
        summaryBase,
        authPlan,
        `${plan.applied.length} application migrations current.`
      );
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: [],
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: 0,
        skippedCount: 0,
      };
    }

    if (!backend) {
      throw new MigrationError(
        "PROVIDER",
        "Migration backend was not initialized."
      );
    }

    for (const entry of plan.pending) {
      ui.info(`→ ${entry.migration.filename} applying`);
      const result = await backend.applyMigration(entry.migration);
      newlyApplied.push(result);
      ui.success(`✓ ${entry.migration.filename} ${result.executionMs} ms`);
    }

    await applyEmbeddedAuthSchema(options, connectionString, ui);
    authPlan = await loadAuthPlan(options, connectionString, true);

    const outcome = `${newlyApplied.length} migration(s) applied`;
    renderReport(ui, summaryBase, authPlan, outcome);

    return {
      ...summaryBase,
      appliedCount: plan.applied.length + newlyApplied.length,
      authPlan,
      conflicts: [],
      diagnostics: [],
      failedCount: 0,
      newlyApplied,
      pendingCount: 0,
      skippedCount: 0,
    };
  } catch (error) {
    if (error instanceof MigrationError) {
      throw error;
    }
    if (error instanceof AthenaAuthRuntimeError) {
      throw new MigrationError("EXECUTION", error.publicMessage, {
        cause: error,
      });
    }
    throw new MigrationError(
      "EXECUTION",
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  } finally {
    if (backend) {
      await backend.close();
    }
  }
}

