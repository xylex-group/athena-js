import { type AthenaCliUI, createCliUi } from "../../cli/ui/index.ts";
import {
  loadGeneratorConfig,
  normalizeGeneratorConfig,
} from "../../generator/config.ts";
import { resolveGeneratorDatabaseAuthority } from "../../generator/database-authority.ts";
import type { NormalizedAthenaGeneratorConfig } from "../../generator/types.ts";
import { ATHENA_MIGRATE_ALLOW_DIRTY_YES_COMMAND } from "../commands.ts";
import { discoverMigrations } from "../discovery.ts";
import type { DirtyMigrationWorktree } from "../git-worktree.ts";
import {
  ensureAthenaProjectLayout,
  formatManagedAuthDrift,
  inspectManagedAuthMigrations,
  type ManagedAuthInspection,
  materializeManagedAuthMigrations,
} from "../managed-auth.ts";
import {
  applyWouldBeRefused,
  classifySourceSafety,
  formatOverridePrompt,
  formatSourceSafetyError,
  formatSourceSafetyWarning,
  freezePreparedMigrations,
  inspectSourceControl,
  preparedToMigrationFile,
} from "../source-control/index.ts";
import type {
  MigrationSourceControlState,
  MigrationSourceSafety,
} from "../source-control/types.ts";
import {
  type MigrationCommandMode,
  MigrationError,
  type MigrationFile,
  type RunMigrationsOptions,
} from "../types.ts";
import {
  relativeDirectoryDisplay,
  resolveMigrationsDirectory,
} from "./authority.ts";

export interface PreparedApplicationMigrationRun {
  allowDirtyMigrations: boolean;
  config: NormalizedAthenaGeneratorConfig;
  cwd: string;
  directoryDisplay: string;
  dryRun: boolean;
  gitWorktree: DirtyMigrationWorktree;
  local: MigrationFile[];
  managedAuth: ManagedAuthInspection;
  mode: MigrationCommandMode;
  mutating: boolean;
  sourceControl: MigrationSourceControlState;
  sourceSafety: MigrationSourceSafety;
  ui: AthenaCliUI;
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

export async function prepareApplicationMigrationRun(
  options: RunMigrationsOptions
): Promise<PreparedApplicationMigrationRun> {
  const cwd = options.cwd ?? process.cwd();
  const ui = resolveUi(options);
  const mode: MigrationCommandMode =
    options.mode ?? (options.dryRun ? "dry-run" : "apply");
  const dryRun =
    mode === "dry-run" ||
    mode === "plan" ||
    mode === "verify" ||
    Boolean(options.dryRun);
  const explicitProvider = options.databaseUrl
    ? {
        connectionString: options.databaseUrl,
        kind: "postgres" as const,
        mode: "direct" as const,
      }
    : undefined;

  const loaded = options.config
    ? (() => {
        const provider = explicitProvider ?? options.config.provider;
        if (!provider) {
          throw new Error(
            "Migration runs require a provider or an explicit database URL."
          );
        }
        return {
          config: normalizeGeneratorConfig({
            ...options.config,
            provider,
          }),
          configPath: options.configPath ?? "athena.config.ts",
        };
      })()
    : await loadGeneratorConfig({
        configPath: options.configPath,
        cwd,
        ...(explicitProvider ? { providerOverride: explicitProvider } : {}),
      });
  const authority = resolveGeneratorDatabaseAuthority({
    applyProjectEnv: false,
    cwd,
    loaded,
    mode: "direct",
    ...(explicitProvider ? { provider: explicitProvider } : {}),
  });
  const config = {
    ...loaded.config,
    provider: authority.provider,
  };
  authority.restoreEnv();
  const absoluteDirectory = resolveMigrationsDirectory(config, cwd);
  const directoryDisplay = relativeDirectoryDisplay(cwd, absoluteDirectory);
  const layout = await ensureAthenaProjectLayout({
    applicationDirectory: absoluteDirectory,
    cwd,
    dryRun,
  });
  if (layout.createdApplicationMigrations && !dryRun) {
    ui.note(`Created application migrations directory ${directoryDisplay}`);
  }
  const mutating = mode === "apply" || mode === "repair";
  if (!dryRun) {
    const materialized = await materializeManagedAuthMigrations({
      cwd,
      overwrite: mutating,
    });
    if (
      mutating &&
      (materialized.written.length > 0 || materialized.restored.length > 0)
    ) {
      ui.note(
        "Materialized Embedded Auth migrations in athena/managed/auth/migrations"
      );
    }
  }
  const managedAuth = await inspectManagedAuthMigrations({ cwd });
  if (managedAuth.drifted) {
    ui.warn(formatManagedAuthDrift(managedAuth));
  }

  const discover =
    options.discover ??
    ((directory: string) => discoverMigrations({ cwd, directory }));

  const discovered = await discover(
    absoluteDirectory.startsWith(cwd)
      ? relativeDirectoryDisplay(cwd, absoluteDirectory)
      : absoluteDirectory
  );

  const resolvedConfigPath =
    options.configPath ??
    (loaded.configPath.startsWith("[") ? undefined : loaded.configPath);
  const sourceControl = (options.inspectSourceControl ?? inspectSourceControl)({
    configPath: resolvedConfigPath,
    cwd,
    migrationsDirectory: relativeDirectoryDisplay(cwd, absoluteDirectory),
  });
  const sourceSafety = classifySourceSafety(sourceControl);
  const allowDirtyMigrations = Boolean(
    options.allowDirtyMigrations ?? options.allowDirty
  );
  if (mutating && applyWouldBeRefused(sourceSafety) && !allowDirtyMigrations) {
    throw new MigrationError(
      "INTEGRITY",
      formatSourceSafetyError(sourceControl, sourceSafety)
    );
  }
  if (
    mutating &&
    applyWouldBeRefused(sourceSafety) &&
    allowDirtyMigrations &&
    !options.yes
  ) {
    if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
      throw new MigrationError(
        "CONFIG",
        [
          formatSourceSafetyWarning(sourceControl, sourceSafety),
          "",
          "Non-interactive override requires:",
          "",
          `  ${ATHENA_MIGRATE_ALLOW_DIRTY_YES_COMMAND}`,
        ].join("\n")
      );
    }
    const confirmed = await ui.confirm(formatOverridePrompt(sourceControl));
    if (!confirmed) {
      throw new MigrationError("CONFIG", "Dirty migration apply cancelled.");
    }
  }

  const prepared = freezePreparedMigrations(discovered, sourceControl);
  const local = prepared.map(preparedToMigrationFile);
  const gitWorktree = {
    dirty: applyWouldBeRefused(sourceSafety),
    entries: sourceControl.changedFiles
      .filter((item) => item.affectsMigrations)
      .map((item) => ({
        code:
          item.kind === "untracked"
            ? "??"
            : item.kind === "deleted"
              ? "D"
              : item.kind === "renamed"
                ? "R"
                : item.kind === "added"
                  ? "A"
                  : "M",
        origPath: item.origPath,
        path: item.path,
      })),
    inGitWorktree: sourceControl.available,
  };

  return {
    allowDirtyMigrations,
    config,
    cwd,
    directoryDisplay,
    dryRun,
    gitWorktree,
    local,
    managedAuth,
    mode,
    mutating,
    sourceControl,
    sourceSafety,
    ui,
  };
}
