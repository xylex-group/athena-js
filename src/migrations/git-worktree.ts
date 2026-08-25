/** Compatibility shim. Git inspection lives in `source-control/`. */
import {
  applyWouldBeRefused,
  classifySourceSafety,
  formatSourceSafetyError,
  formatSourceSafetyWarning,
  formatWorktreeChangeLine,
  inspectSourceControl,
} from "./source-control/index.ts";
import { displayCode } from "./source-control/status.ts";
import type { InspectSourceControlInput } from "./source-control/types.ts";

export interface DirtyWorktreeEntry {
  code: string;
  origPath?: string;
  path: string;
}

export interface DirtyMigrationWorktree {
  dirty: boolean;
  entries: DirtyWorktreeEntry[];
  inGitWorktree: boolean;
}

export type InspectDirtyMigrationWorktreeInput = InspectSourceControlInput;

export function parseGitPorcelainLine(line: string): DirtyWorktreeEntry | undefined {
  if (line.length < 4) {
    return undefined;
  }
  const code = line.slice(0, 2).trim() || line.slice(0, 2);
  const rest = line.slice(3);
  const rename = rest.split(" -> ");
  if (rename.length === 2) {
    return {
      code: code.trim() || "R",
      origPath: rename[0],
      path: rename[1],
    };
  }
  return { code, path: rest };
}

export function inspectDirtyMigrationWorktree(
  input: InspectDirtyMigrationWorktreeInput
): DirtyMigrationWorktree {
  const state = inspectSourceControl(input);
  const safety = classifySourceSafety(state);
  const relevant = state.changedFiles.filter((item) => item.affectsMigrations);
  return {
    dirty: applyWouldBeRefused(safety),
    entries: relevant.map((item) => ({
      code: displayCode(item.kind),
      origPath: item.origPath,
      path: item.path,
    })),
    inGitWorktree: state.available,
  };
}

export function formatDirtyWorktreeLines(
  entries: readonly DirtyWorktreeEntry[]
): string[] {
  return entries.map((entry) => {
    if (entry.origPath) {
      return `  ${entry.code} ${entry.origPath} -> ${entry.path}`;
    }
    return `  ${entry.code} ${entry.path}`;
  });
}

export function formatDirtyMigrationError(
  worktree: DirtyMigrationWorktree
): string {
  return formatSourceSafetyError(
    {
      available: worktree.inGitWorktree,
      changedFiles: worktree.entries.map((entry) => ({
        affectsMigrations: true,
        kind:
          entry.code === "??"
            ? "untracked"
            : entry.code === "D"
              ? "deleted"
              : entry.code === "R"
                ? "renamed"
                : "modified",
        origPath: entry.origPath,
        path: entry.path,
      })),
      detached: false,
      migrationDirectory: "athena/migrations",
    },
    worktree.dirty ? "dirty" : "verified-clean"
  );
}

export function formatDirtyMigrationWarning(
  worktree: DirtyMigrationWorktree
): string {
  return formatSourceSafetyWarning(
    {
      available: worktree.inGitWorktree,
      changedFiles: worktree.entries.map((entry) => ({
        affectsMigrations: true,
        kind: entry.code === "??" ? "untracked" : "modified",
        origPath: entry.origPath,
        path: entry.path,
      })),
      detached: false,
      migrationDirectory: "athena/migrations",
    },
    worktree.dirty ? "untracked" : "verified-clean"
  );
}

export { formatWorktreeChangeLine };
