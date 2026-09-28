import { execSync } from "node:child_process";

export type AthenaBuildProvenance = {
  buildRevision: string | null;
  buildTimestamp: string;
  dirty: boolean;
  version: string;
};

export function readGitBuildProvenance(input: {
  cwd: string;
  version: string;
}): AthenaBuildProvenance {
  const buildTimestamp = new Date().toISOString();
  try {
    const buildRevision = execSync("git rev-parse HEAD", {
      cwd: input.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const porcelain = execSync("git status --porcelain", {
      cwd: input.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return {
      buildRevision: buildRevision.length > 0 ? buildRevision : null,
      buildTimestamp,
      dirty: porcelain.length > 0,
      version: input.version,
    };
  } catch {
    return {
      buildRevision: null,
      buildTimestamp,
      dirty: true,
      version: input.version,
    };
  }
}
