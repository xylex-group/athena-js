import { AthenaAuthRuntimeError } from "../auth/local/errors.ts";
import type { AthenaAuthMigrationPlan } from "../auth/local/schema.ts";
import { createAthenaPostgresRuntime } from "../postgres/owned-runtime.ts";
import {
  ATHENA_MIGRATE_REPAIR_COMMAND,
  ATHENA_MIGRATE_REPAIR_YES_COMMAND,
} from "./commands.ts";
import { formatDiagnostic } from "./analysis/diagnostics.ts";
import {
  explainMigration,
  formatMigrationGraph,
  formatPreflightFailure,
} from "./analysis/index.ts";
import { fingerprintProjectedSchema } from "./analysis/projected-schema.ts";
import { applyApplicationMigrations } from "./application/apply.ts";
import {
  assertDirectPostgres,
  databaseLabel,
  providerLabel,
} from "./application/authority.ts";
import { prepareApplicationMigrationRun } from "./application/prepare.ts";
import { reconcileApplicationMigrations } from "./application/reconcile.ts";
import {
  blockingSemantic,
  compileApplicationSemantics,
} from "./application/semantics.ts";
import type { MigrationBackend } from "./backend.ts";
import { applyEmbeddedAuthMigrations } from "./embedded-auth/apply.ts";
import { loadAuthPlan } from "./embedded-auth/plan.ts";
import { repairEmbeddedAuthMigrations } from "./embedded-auth/repair.ts";
import { applyEmbeddedBillingMigrations } from "./embedded-billing/apply.ts";
import { applyEmbeddedChatMigrations } from "./embedded-chat/apply.ts";
import { applyEmbeddedEventIngressMigrations } from "./embedded-event-ingress/apply.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY, discoverMigrations } from "./discovery.ts";
import {
  type EmbeddedModuleSection,
  embeddedModuleHasConflicts,
  embeddedModuleHasPending,
  embeddedModuleNeedsAdoption,
  formatEmbeddedModuleConflicts,
  inspectEmbeddedModuleSections,
} from "./embedded-modules-inspect.ts";
import {
  formatManagedAuthDrift,
  type ManagedAuthInspection,
} from "./managed-auth.ts";
import { planHasBlockingConflicts, planMigrations } from "./planner.ts";
import { createPostgresMigrationBackend } from "./postgres.ts";
import { runSqliteMigrations } from "./sqlite.ts";
import { isHighAutoRepair } from "./reconciliation/index.ts";
import { formatConflictBlock } from "./reporting/conflicts.ts";
import {
  formatUnknownAuthLedgerError,
  hasUnknownAuthGenerations,
  renderReport,
  unknownAuthLedgerDiagnostics,
} from "./reporting/render.ts";
import {
  formatPlanProvenance,
  formatSourceSafetyWarning,
} from "./source-control/index.ts";
import {
  type AppliedMigrationResult,
  type MigrationCommandMode,
  MigrationError,
  type MigrationFile,
  type MigrationPlan,
  type MigrationRunSummary,
  type RunMigrationsOptions,
} from "./types.ts";

function translateRunError(error: unknown): MigrationError {
  if (error instanceof MigrationError) {
    return error;
  }
  if (error instanceof AthenaAuthRuntimeError) {
    return new MigrationError("EXECUTION", error.publicMessage, {
      cause: error,
    });
  }
  return new MigrationError(
    "EXECUTION",
    error instanceof Error ? error.message : String(error),
    { cause: error }
  );
}

function labeledEmbeddedFailure(
  failed: string,
  notAttempted: readonly string[],
  error: unknown
): MigrationError {
  const detail = error instanceof Error ? error.message : String(error);
  return new MigrationError(
    "EXECUTION",
    [
      failed,
      `  ✗ ${detail}`,
      ...notAttempted.flatMap((name) => [name, "  - not attempted"]),
    ].join("\n"),
    { cause: error }
  );
}

async function applyEmbeddedAuthPrerequisites(input: {
  connectionString: string;
  modules: import("../generator/types.ts").AthenaConfig["modules"];
  options: RunMigrationsOptions;
  ui: import("../cli/ui/types.ts").AthenaCliUI;
}): Promise<void> {
  const { connectionString, modules, options, ui } = input;
  try {
    await applyEmbeddedAuthMigrations(options, connectionString, ui, modules);
  } catch (error) {
    throw labeledEmbeddedFailure(
      "Embedded Auth",
      ["Embedded Chat", "Event Ingress", "Embedded Billing"],
      error
    );
  }
  const packagedInspect = await inspectEmbeddedModuleSections({
    connectionString,
    modules,
    postgresRuntime: options.postgresRuntime,
  });
  if (embeddedModuleHasConflicts(packagedInspect)) {
    throw new MigrationError(
      "INTEGRITY",
      formatEmbeddedModuleConflicts(packagedInspect)
    );
  }
}

async function applyEmbeddedDependents(input: {
  connectionString: string;
  modules: import("../generator/types.ts").AthenaConfig["modules"];
  options: RunMigrationsOptions;
  ui: import("../cli/ui/types.ts").AthenaCliUI;
}): Promise<void> {
  const { connectionString, modules, options, ui } = input;
  try {
    await applyEmbeddedChatMigrations(options, connectionString, ui, modules);
  } catch (error) {
    throw labeledEmbeddedFailure(
      "Embedded Chat",
      ["Event Ingress", "Embedded Billing"],
      error
    );
  }
  try {
    await applyEmbeddedEventIngressMigrations(
      options,
      connectionString,
      ui,
      modules
    );
  } catch (error) {
    throw labeledEmbeddedFailure("Event Ingress", ["Embedded Billing"], error);
  }
  try {
    await applyEmbeddedBillingMigrations(
      options,
      connectionString,
      ui,
      modules
    );
  } catch (error) {
    throw labeledEmbeddedFailure("Embedded Billing", [], error);
  }
}

async function applyPackagedEmbeddedMigrations(input: {
  connectionString: string;
  modules: import("../generator/types.ts").AthenaConfig["modules"];
  options: RunMigrationsOptions;
  ui: import("../cli/ui/types.ts").AthenaCliUI;
}): Promise<void> {
  await applyEmbeddedAuthPrerequisites(input);
  await applyEmbeddedDependents(input);
}

/**
 * Programmatic migration runner (Node/tooling only).
 *
 * Thin coordinator: application ledger and Embedded Auth ledger stay separate.
 */
async function discoverSqliteMigrations(
  options: RunMigrationsOptions,
): Promise<MigrationFile[]> {
  if (options.discover) {
    return options.discover(DEFAULT_MIGRATIONS_DIRECTORY);
  }
  return discoverMigrations({
    cwd: options.cwd ?? process.cwd(),
    directory: DEFAULT_MIGRATIONS_DIRECTORY,
  });
}

export async function runMigrations(
  options: RunMigrationsOptions = {}
): Promise<MigrationRunSummary> {
  if (options.sqliteExecutor) {
    const migrations =
      options.sqliteMigrations ??
      (await discoverSqliteMigrations(options));
    return runSqliteMigrations({
      dryRun: options.dryRun,
      executor: options.sqliteExecutor,
      migrations,
    });
  }
  const prepared = await prepareApplicationMigrationRun(options);
  const {
    cwd,
    ui,
    mode,
    dryRun,
    config,
    directoryDisplay,
    local,
    sourceControl,
    sourceSafety,
    gitWorktree,
    managedAuth,
    mutating,
  } = prepared;
  let backend: MigrationBackend | undefined;
  let connectionString = "";
  const newlyApplied: AppliedMigrationResult[] = [];
  let plan: MigrationPlan = { applied: [], conflicts: [], pending: [] };
  let authPlan: AthenaAuthMigrationPlan | undefined;
  let postgresRuntime = options.postgresRuntime;
  const ownsMigrationRuntime = options.postgresRuntime === undefined;

  try {
    const pg = assertDirectPostgres(config);
    connectionString = pg.connectionString;
    postgresRuntime ??= createAthenaPostgresRuntime({
      connectionString: pg.connectionString,
    });
    const optionsWithRuntime: RunMigrationsOptions = {
      ...options,
      postgresRuntime,
    };
    const applyPackaged = async (connection: string): Promise<void> => {
      await applyPackagedEmbeddedMigrations({
        connectionString: connection,
        modules: config.modules,
        options: optionsWithRuntime,
        ui,
      });
    };
    backend =
      (await options.createBackend?.({
        connectionString: pg.connectionString,
        database: pg.database,
        postgresRuntime,
      })) ??
      (await createPostgresMigrationBackend({
        connectionString: pg.connectionString,
        database: pg.database,
        postgresRuntime,
      }));

    if (mutating) {
      await backend.acquireLock();
    }
    if (mode === "apply" || mode === "repair") {
      await backend.ensureLedger();
    }
    const applied = await backend.listAppliedMigrations();
    plan = planMigrations({ applied, local });

    const gitDiagnostics =
      gitWorktree.dirty && !mutating
        ? [
            {
              code: "ATHENA-MIG-GIT-001",
              level: "warn" as const,
              message: [
                formatPlanProvenance(sourceControl),
                "",
                formatSourceSafetyWarning(sourceControl, sourceSafety),
              ].join("\n"),
            },
          ]
        : [];
    if (gitDiagnostics[0]) {
      ui.warn(gitDiagnostics[0].message);
    }

    const summaryBase = {
      databaseLabel: databaseLabel(config),
      directory: directoryDisplay,
      dryRun,
      gitWorktree,
      mode,
      plan,
      providerLabel: providerLabel(config),
      sourceControl,
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

      if (!(options.yes || dryRun)) {
        if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
          throw new MigrationError(
            "CONFIG",
            [
              "migrate repair requires confirmation.",
              "",
              "Re-run with --yes in CI/non-TTY environments:",
              "",
              `  ${ATHENA_MIGRATE_REPAIR_YES_COMMAND}`,
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

      await repairEmbeddedAuthMigrations(options, connectionString, dryRun);
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

    const inspectAuth =
      mode === "status" ||
      mode === "plan" ||
      mode === "apply" ||
      mode === "check" ||
      mode === "drift" ||
      mode === "verify";
    authPlan = await loadAuthPlan(options, connectionString, inspectAuth);

    if (!backend) {
      throw new MigrationError(
        "PROVIDER",
        "Migration backend was not initialized."
      );
    }

    const semantic = await compileApplicationSemantics({
      authPlan,
      backend,
      cacheDir: cwd,
      local,
      modules: config.modules,
      plan,
      strict: options.strict,
    });

    if (mode === "reconcile") {
      const reconciliation = await reconcileApplicationMigrations({
        backend,
        cwd,
        directoryDisplay,
        local,
        options,
        semantic,
        ui,
      });
      const eligible = reconciliation.diagnoses.filter(isHighAutoRepair);
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        reconciliation,
        semantic,
        skippedCount: options.applyReconcile ? 0 : eligible.length,
      };
    }

    if (mode === "graph") {
      ui.info(formatMigrationGraph(semantic.graph));
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        semantic,
        skippedCount: 0,
      };
    }

    if (mode === "explain") {
      const target = (options.explainTarget ?? "").trim();
      const analysis = semantic.analyses.find(
        (item) =>
          item.filename === target ||
          item.version === Number(target) ||
          item.filename.startsWith(`${target}_`) ||
          item.filename.includes(target)
      );
      if (!analysis) {
        throw new MigrationError(
          "CONFIG",
          `Unknown migration to explain: ${target || "(missing)"}. Use a version or filename.`
        );
      }
      ui.info(explainMigration(analysis, semantic.packagedProviders));
      return {
        ...summaryBase,
        appliedCount: plan.applied.length,
        authPlan,
        conflicts: plan.conflicts,
        diagnostics: [],
        failedCount: 0,
        newlyApplied: [],
        pendingCount: plan.pending.length,
        semantic,
        skippedCount: 0,
      };
    }

    if (
      mode === "status" ||
      mode === "plan" ||
      mode === "check" ||
      mode === "drift" ||
      mode === "verify"
    ) {
      const embeddedSections = await inspectEmbeddedModuleSections({
        connectionString,
        modules: config.modules,
        postgresRuntime,
      });
      return inspectCombinedLedgers({
        authPlan,
        embeddedSections,
        gitDiagnostics,
        managedAuth,
        mode,
        plan,
        semantic,
        strict: Boolean(options.strict),
        summaryBase,
        ui,
      });
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

    if (blockingSemantic(semantic)) {
      const message = formatPreflightFailure(semantic.diagnostics);
      const reports = semantic.diagnostics
        .filter(
          (item) =>
            item.classification !== "dynamic_sql" &&
            item.classification !== "unresolved_search_path" &&
            item.classification !== "unverified"
        )
        .map((item) => ({
          code: item.code,
          level: "error" as const,
          message: item.message,
        }));
      renderReport(
        ui,
        summaryBase,
        authPlan,
        "Migration preflight failed.",
        reports.length > 0
          ? reports
          : [{ code: "ATHENA-MIG-PREFLIGHT", level: "error", message }]
      );
      throw new MigrationError("SEMANTIC", message);
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
        semantic,
        skippedCount: plan.pending.length,
      };
    }

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
        `  ${ATHENA_MIGRATE_REPAIR_COMMAND}`,
      ].join("\n");
      renderReport(ui, summaryBase, authPlan, "Embedded Auth schema drift.", [
        {
          code: "ATHENA_AUTH_SCHEMA_DRIFT",
          level: "error",
          message: driftMessage,
        },
      ]);
      throw new MigrationError("HISTORY", driftMessage);
    }

    if (local.length === 0 && plan.pending.length === 0) {
      ui.info(`No application SQL files in ${directoryDisplay}.`);
      await applyPackaged(connectionString);
      authPlan = await loadAuthPlan(options, connectionString, true);
      const embeddedSections = await inspectEmbeddedModuleSections({
        connectionString,
        modules: config.modules,
        postgresRuntime,
      });
      renderReport(
        ui,
        summaryBase,
        authPlan,
        `No application SQL files in ${directoryDisplay}. Packaged ledgers listed above.`,
        [],
        embeddedSections.map((section) => section.section)
      );
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
      await applyPackaged(connectionString);
      authPlan = await loadAuthPlan(options, connectionString, true);
      const embeddedSections = await inspectEmbeddedModuleSections({
        connectionString,
        modules: config.modules,
        postgresRuntime,
      });
      renderReport(
        ui,
        summaryBase,
        authPlan,
        `${plan.applied.length} application migrations current.`,
        [],
        embeddedSections.map((section) => section.section)
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

    const catalogFingerprint = fingerprintProjectedSchema(semantic.physical);
    const recatalog = await backend.inspectCatalog();
    if (fingerprintProjectedSchema(recatalog.schema) !== catalogFingerprint) {
      throw new MigrationError(
        "SEMANTIC",
        "Physical catalog changed after preflight; re-run migrate."
      );
    }

    await applyEmbeddedAuthPrerequisites({
      connectionString,
      modules: config.modules,
      options,
      ui,
    });
    newlyApplied.push(
      ...(await applyApplicationMigrations(
        backend,
        plan.pending,
        ui,
        options.transactionScope,
      ))
    );
    await applyEmbeddedDependents({
      connectionString,
      modules: config.modules,
      options,
      ui,
    });
    authPlan = await loadAuthPlan(options, connectionString, true);
    const embeddedSections = await inspectEmbeddedModuleSections({
      connectionString,
      modules: config.modules,
      postgresRuntime,
    });

    const outcome = `${newlyApplied.length} migration(s) applied`;
    renderReport(
      ui,
      summaryBase,
      authPlan,
      outcome,
      [],
      embeddedSections.map((section) => section.section)
    );

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
    throw translateRunError(error);
  } finally {
    if (backend) {
      await backend.close();
    }
    if (ownsMigrationRuntime && postgresRuntime) {
      await postgresRuntime.close();
    }
  }
}

function managedAuthDiagnostics(
  managedAuth: ManagedAuthInspection,
  level: "warn" | "error"
): NonNullable<MigrationRunSummary["diagnostics"]> {
  if (!managedAuth.drifted) {
    return [];
  }
  return [
    {
      code: "ATHENA-MIG-AUTH-MANAGED-001",
      level,
      message: formatManagedAuthDrift(managedAuth),
    },
  ];
}

function describeCombinedLedgerStatus(input: {
  authPlan: AthenaAuthMigrationPlan | undefined;
  embeddedAdopt: boolean;
  embeddedConflicts: boolean;
  embeddedPending: boolean;
  plan: MigrationPlan;
  semanticBlocked: boolean;
  unknownAuth: boolean;
}): string {
  if (planHasBlockingConflicts(input.plan)) {
    return "Application migration history has conflicts.";
  }
  if (input.semanticBlocked) {
    return "Application schema drift / unsatisfied dependencies.";
  }
  if (input.authPlan?.hasBlockingDrift) {
    return "Embedded Auth schema drift detected.";
  }
  if (input.unknownAuth || (input.authPlan?.conflictCount ?? 0) > 0) {
    return "Embedded Auth ledger has unknown or conflicting generations.";
  }
  if (input.embeddedConflicts) {
    return "Packaged module ledger checksum mismatch.";
  }
  if (input.embeddedAdopt) {
    return "Packaged module ledger reconciliation required.";
  }
  const applicationIdle = input.plan.pending.length === 0;
  const authIdle = (input.authPlan?.pendingCount ?? 0) === 0;
  if (applicationIdle && authIdle && !input.embeddedPending) {
    return "Database is up to date.";
  }
  return "Pending migrations remain.";
}

function inspectCombinedLedgers(input: {
  authPlan: AthenaAuthMigrationPlan | undefined;
  embeddedSections: readonly EmbeddedModuleSection[];
  gitDiagnostics: NonNullable<MigrationRunSummary["diagnostics"]>;
  managedAuth: ManagedAuthInspection;
  mode: Extract<
    MigrationCommandMode,
    "status" | "plan" | "check" | "drift" | "verify"
  >;
  plan: MigrationPlan;
  semantic: NonNullable<MigrationRunSummary["semantic"]>;
  strict: boolean;
  summaryBase: Pick<
    MigrationRunSummary,
    | "providerLabel"
    | "databaseLabel"
    | "directory"
    | "plan"
    | "mode"
    | "dryRun"
    | "gitWorktree"
    | "sourceControl"
  >;
  ui: import("../cli/ui/types.ts").AthenaCliUI;
}): MigrationRunSummary {
  const {
    authPlan,
    embeddedSections,
    gitDiagnostics,
    managedAuth,
    mode,
    plan,
    semantic,
    strict,
    summaryBase,
    ui,
  } = input;
  const semanticBlocked = blockingSemantic(semantic);
  const unknownAuth = hasUnknownAuthGenerations(authPlan);
  const embeddedConflicts = embeddedModuleHasConflicts(embeddedSections);
  const embeddedPending = embeddedModuleHasPending(embeddedSections);
  const embeddedAdopt = embeddedModuleNeedsAdoption(embeddedSections);
  const moduleViews = embeddedSections.map((section) => section.section);

  const outcome = describeCombinedLedgerStatus({
    authPlan,
    embeddedAdopt,
    embeddedConflicts,
    embeddedPending,
    plan,
    semanticBlocked,
    unknownAuth,
  });

  const semanticDiagnostics = semantic.diagnostics.map((item) => ({
    code: item.code,
    level: "error" as const,
    message: formatDiagnostic(item),
  }));
  const verification =
    mode === "check" || mode === "drift" || mode === "verify";
  const managedLevel =
    strict && (mode === "check" || mode === "verify") ? "error" : "warn";
  const combinedDiagnostics = [
    ...gitDiagnostics,
    ...semanticDiagnostics,
    ...unknownAuthLedgerDiagnostics(authPlan, verification ? "error" : "warn"),
    ...managedAuthDiagnostics(managedAuth, managedLevel),
  ];

  if (mode === "plan" || mode === "check" || mode === "drift") {
    ui.info(formatMigrationGraph(semantic.graph));
  }

  renderReport(
    ui,
    summaryBase,
    authPlan,
    outcome,
    combinedDiagnostics,
    moduleViews
  );

  if (planHasBlockingConflicts(plan)) {
    throw new MigrationError("HISTORY", formatConflictBlock(plan));
  }
  if (
    semanticBlocked &&
    (mode === "check" || mode === "drift" || mode === "plan")
  ) {
    throw new MigrationError(
      "SEMANTIC",
      formatPreflightFailure(semantic.diagnostics)
    );
  }
  if (verification && unknownAuth && authPlan) {
    throw new MigrationError("HISTORY", formatUnknownAuthLedgerError(authPlan));
  }
  if (verification && embeddedConflicts) {
    throw new MigrationError(
      "INTEGRITY",
      "Packaged module ledger checksum mismatch."
    );
  }
  if (verification && embeddedAdopt) {
    throw new MigrationError(
      "INTEGRITY",
      "Packaged module ledger reconciliation required."
    );
  }
  if (managedLevel === "error" && managedAuth.drifted) {
    throw new MigrationError("INTEGRITY", formatManagedAuthDrift(managedAuth));
  }

  return {
    ...summaryBase,
    appliedCount: plan.applied.length,
    authPlan,
    conflicts: plan.conflicts,
    diagnostics: combinedDiagnostics,
    embedded: embeddedSections,
    failedCount: semanticBlocked ? 1 : 0,
    newlyApplied: [],
    pendingCount: plan.pending.length,
    semantic,
    skippedCount: 0,
  };
}
