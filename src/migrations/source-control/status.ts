import { relative, resolve } from "node:path";

import {
  gitBranchName,
  gitHeadCommit,
  gitShowToplevel,
  gitStatusPorcelainV2,
  isPathInside,
  MIGRATION_CONFIG_BASENAMES,
  type PorcelainV2Record,
  toPosix,
} from "./git.ts";
import type {
  InspectSourceControlInput,
  MigrationSourceControlState,
  MigrationWorktreeChange,
  MigrationWorktreeChangeKind,
} from "./types.ts";

function kindFromRecord(
  record: PorcelainV2Record
): MigrationWorktreeChangeKind {
  if (record.kind === "untracked") {
    return "untracked";
  }
  if (record.kind === "unmerged") {
    return "conflicted";
  }
  if (record.kind === "rename" || record.xy.includes("R")) {
    return "renamed";
  }
  if (record.xy.includes("D")) {
    return "deleted";
  }
  if (record.xy.includes("A")) {
    return "added";
  }
  return "modified";
}

function displayCode(kind: MigrationWorktreeChangeKind): string {
  switch (kind) {
    case "untracked":
      return "??";
    case "conflicted":
      return "UU";
    case "renamed":
      return "R";
    case "deleted":
      return "D";
    case "added":
      return "A";
    default:
      return "M";
  }
}

export { displayCode };

function relativeToCwd(
  cwd: string,
  repoPath: string,
  toplevel: string
): string {
  const absolute = resolve(toplevel, repoPath);
  return toPosix(relative(cwd, absolute) || repoPath);
}

function pathAffects(
  posixPath: string,
  origPath: string | undefined,
  migrationsPrefix: string,
  configRelatives: readonly string[]
): boolean {
  const candidates = [posixPath, origPath].filter((item): item is string =>
    Boolean(item)
  );
  return candidates.some((path) => {
    if (
      migrationsPrefix &&
      (path === migrationsPrefix || path.startsWith(`${migrationsPrefix}/`))
    ) {
      const base = path.split("/").pop() ?? "";
      // Scaffold keep-files are not migration SQL and must not block apply.
      if (base === ".gitkeep") {
        return false;
      }
      return true;
    }
    return configRelatives.includes(path);
  });
}

export function inspectSourceControl(
  input: InspectSourceControlInput
): MigrationSourceControlState {
  const cwd = resolve(input.cwd);
  const toplevel = gitShowToplevel(cwd);
  const migrationsAbs = resolve(cwd, input.migrationsDirectory);
  const empty: MigrationSourceControlState = {
    available: false,
    changedFiles: [],
    detached: false,
    migrationDirectory: toPosix(input.migrationsDirectory),
  };
  if (!(toplevel && isPathInside(toplevel, cwd))) {
    return empty;
  }

  const pathspecs: string[] = [];
  let migrationsPrefix = "";
  if (isPathInside(toplevel, migrationsAbs)) {
    migrationsPrefix = toPosix(relative(toplevel, migrationsAbs));
    pathspecs.push(migrationsPrefix);
  }
  const configRelatives: string[] = [];
  for (const basename of MIGRATION_CONFIG_BASENAMES) {
    const abs = resolve(cwd, basename);
    if (isPathInside(toplevel, abs)) {
      const rel = toPosix(relative(toplevel, abs));
      configRelatives.push(rel);
      pathspecs.push(rel);
    }
  }
  if (input.configPath && !input.configPath.startsWith("[")) {
    const abs = resolve(cwd, input.configPath);
    if (isPathInside(toplevel, abs)) {
      const rel = toPosix(relative(toplevel, abs));
      configRelatives.push(rel);
      pathspecs.push(rel);
    }
  }

  const uniqueSpecs = [...new Set(pathspecs.filter(Boolean))];
  const records =
    uniqueSpecs.length > 0 ? gitStatusPorcelainV2(cwd, uniqueSpecs) : [];
  const { branch, detached } = gitBranchName(cwd);

  const changedFiles: MigrationWorktreeChange[] = records
    .filter((record) => record.kind !== "ignored")
    .map((record) => {
      const path = relativeToCwd(cwd, record.path, toplevel);
      const origPath = record.origPath
        ? relativeToCwd(cwd, record.origPath, toplevel)
        : undefined;
      const repoPath = toPosix(relative(toplevel, resolve(cwd, path)));
      const repoOrig = origPath
        ? toPosix(relative(toplevel, resolve(cwd, origPath)))
        : undefined;
      return {
        affectsMigrations: pathAffects(
          repoPath,
          repoOrig,
          migrationsPrefix,
          configRelatives
        ),
        kind: kindFromRecord(record),
        origPath,
        path,
      };
    });

  return {
    available: true,
    branch,
    changedFiles,
    detached,
    headCommit: gitHeadCommit(cwd),
    migrationDirectory: toPosix(input.migrationsDirectory),
    repositoryRoot: toPosix(toplevel),
  };
}
