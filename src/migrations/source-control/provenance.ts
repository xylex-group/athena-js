import { relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { MigrationFile } from "../types.ts";
import { gitBlobSha, gitLsTracked, toPosix } from "./git.ts";
import { classifySourceSafety } from "./safety.ts";
import type {
  MigrationFileProvenance,
  MigrationSourceControlState,
  MigrationSourceProvenance,
  PreparedMigration,
} from "./types.ts";

export function attachFileProvenance(
  file: MigrationFile,
  state: MigrationSourceControlState
): MigrationFileProvenance | undefined {
  if (!state.available || !state.repositoryRoot || !state.headCommit) {
    return undefined;
  }
  const relativePath = toPosix(relative(state.repositoryRoot, resolve(file.path)));
  const dirty = state.changedFiles.some(
    (change) =>
      change.affectsMigrations &&
      (change.path === relativePath ||
        change.path.endsWith(`/${file.filename}`) ||
        change.path.endsWith(file.filename))
  );
  const tracked = gitLsTracked(state.repositoryRoot, relativePath);
  return {
    branch: state.branch,
    dirty,
    gitBlobSha: tracked ? gitBlobSha(state.repositoryRoot, relativePath) : undefined,
    headCommit: state.headCommit,
    relativePath,
    repositoryRoot: state.repositoryRoot,
    tracked,
    vcs: "git",
  };
}

export function freezePreparedMigrations(
  files: readonly MigrationFile[],
  state: MigrationSourceControlState
): PreparedMigration[] {
  const safety = classifySourceSafety(state);
  const executionId = randomUUID();
  const source: MigrationSourceProvenance = {
    executionId,
    safety,
    sourceDirty: safety !== "verified-clean" && safety !== "not-a-repository",
    worktree: state,
  };
  return files.map((file) => {
    const provenance = attachFileProvenance(file, state);
    return {
      checksum: file.checksum,
      filename: file.filename,
      name: file.name,
      provenance,
      source,
      sourcePath: file.path,
      sql: file.sql,
      version: file.version,
    };
  });
}

export function preparedToMigrationFile(
  prepared: PreparedMigration
): MigrationFile {
  return {
    checksum: prepared.checksum,
    executionId: prepared.source.executionId,
    filename: prepared.filename,
    name: prepared.name,
    path: prepared.sourcePath,
    provenance: prepared.provenance,
    sourceDirty: prepared.source.sourceDirty,
    sql: prepared.sql,
    version: prepared.version,
  };
}
