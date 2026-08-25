import { displayCode } from "./status.ts";
import type {
  MigrationSourceControlState,
  MigrationSourceSafety,
  MigrationWorktreeChange,
} from "./types.ts";

export function classifySourceSafety(
  state: MigrationSourceControlState
): MigrationSourceSafety {
  if (!state.available) {
    return "not-a-repository";
  }
  if (state.available && !state.headCommit) {
    return "commit-unresolved";
  }
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  if (relevant.some((item) => item.kind === "conflicted")) {
    return "conflicted";
  }
  if (relevant.some((item) => item.kind === "untracked")) {
    return "untracked";
  }
  if (relevant.length > 0) {
    return "dirty";
  }
  return "verified-clean";
}

export function applyWouldBeRefused(safety: MigrationSourceSafety): boolean {
  return (
    safety === "dirty" ||
    safety === "untracked" ||
    safety === "conflicted" ||
    safety === "commit-unresolved"
  );
}

export function formatWorktreeChangeLine(change: MigrationWorktreeChange): string {
  if (change.origPath) {
    return `  ${displayCode(change.kind)} ${change.origPath} -> ${change.path}`;
  }
  return `  ${displayCode(change.kind)} ${change.path}`;
}

export function formatSourceSafetyError(
  state: MigrationSourceControlState,
  safety: MigrationSourceSafety
): string {
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  const lines = relevant.map(formatWorktreeChangeLine);
  const heading =
    safety === "conflicted"
      ? "Migration source tree has unresolved merge conflicts."
      : "The migration source tree is not reproducible.";
  return [
    "Migration safety check failed",
    "",
    heading,
    "",
    "Uncommitted migration state:",
    ...(lines.length > 0 ? lines : ["  (source commit could not be resolved)"]),
    "",
    "athena-js refuses to apply migration files that are not represented",
    "by a committed repository state.",
    "",
    "Commit or stash migration changes and retry.",
    "",
    "Override:",
    "  athena-js migrate --allow-dirty-migrations",
  ].join("\n");
}

export function formatSourceSafetyWarning(
  state: MigrationSourceControlState,
  safety: MigrationSourceSafety
): string {
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  return [
    "WARNING: migration provenance cannot be guaranteed.",
    "",
    ...relevant.map((change) =>
      `${change.path} is ${change.kind === "untracked" ? "uncommitted" : change.kind}.`
    ),
    "",
    "If applied, the database may contain migration history that cannot",
    "be reconstructed from Git.",
    "",
    safety === "verified-clean" ? "" : "migrate plan continues; apply would be refused.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatOverridePrompt(
  state: MigrationSourceControlState
): string {
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  const names = relevant.map((item) => item.path).join("\n");
  return [
    "WARNING: migration provenance cannot be guaranteed.",
    "",
    names,
    "",
    "If applied, the database may contain migration history that cannot",
    "be reconstructed from Git.",
    "",
    "Continue?",
  ].join("\n");
}

export function formatPlanProvenance(state: MigrationSourceControlState): string {
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  const lines = [
    "Repository",
    `Commit      ${state.headCommit ?? "(unresolved)"}`,
    `Branch      ${state.detached ? "(detached)" : state.branch ?? "(unknown)"}`,
    `Worktree    ${relevant.length > 0 ? "DIRTY" : "CLEAN"}`,
  ];
  if (relevant.length > 0) {
    lines.push("", "Migration source warnings");
    for (const change of relevant) {
      lines.push(change.path.split("/").pop() ?? change.path);
      lines.push(`  ⚠ ${change.kind}`);
      lines.push("  ⚠ not reproducible from HEAD");
      lines.push("  ⚠ apply would be refused");
    }
  }
  return lines.join("\n");
}
