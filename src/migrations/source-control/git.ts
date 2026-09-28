import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

export const MIGRATION_CONFIG_BASENAMES = [
  "athena.config.ts",
  "athena.config.js",
  "athena-js.config.ts",
  "athena-js.config.js",
  ".athena.config.ts",
  ".athena.config.js",
] as const;

export interface GitCommandResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

function decodeSpawnOutput(value: Buffer | string | null | undefined): string {
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

export function runGit(cwd: string, args: string[]): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error && (result.error as { code?: string }).code === "ENOENT") {
    return { status: null, stderr: "git not found", stdout: "" };
  }
  return {
    status: result.status,
    stderr: decodeSpawnOutput(result.stderr),
    stdout: decodeSpawnOutput(result.stdout),
  };
}

export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || !(rel.startsWith("..") || rel.startsWith(`..${sep}`));
}

export interface PorcelainV2Record {
  kind: "ordinary" | "rename" | "untracked" | "unmerged" | "ignored";
  origPath?: string;
  path: string;
  xy: string;
}

/**
 * Parse `git status --porcelain=v2 -z` (NUL-separated machine records).
 */
export function parsePorcelainV2(buffer: string): PorcelainV2Record[] {
  const tokens = buffer.split("\0").filter((token) => token.length > 0);
  const records: PorcelainV2Record[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("? ")) {
      records.push({ kind: "untracked", path: token.slice(2), xy: "??" });
      continue;
    }
    if (token.startsWith("! ")) {
      records.push({ kind: "ignored", path: token.slice(2), xy: "!!" });
      continue;
    }
    if (token.startsWith("u ")) {
      const match = /^u (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(
        token
      );
      records.push({
        kind: "unmerged",
        path: match?.[2] ?? token.slice(2),
        xy: match?.[1] ?? "UU",
      });
      continue;
    }
    if (token.startsWith("2 ")) {
      const match = /^2 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(token);
      const path = match?.[2] ?? token.slice(2);
      const origPath = tokens[index + 1] ?? "";
      index += 1;
      records.push({
        kind: "rename",
        origPath,
        path,
        xy: match?.[1] ?? "R.",
      });
      continue;
    }
    if (token.startsWith("1 ")) {
      const match = /^1 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(token);
      records.push({
        kind: "ordinary",
        path: match?.[2] ?? token.slice(2),
        xy: match?.[1] ?? "M.",
      });
    }
  }
  return records;
}

export function gitShowToplevel(cwd: string): string | undefined {
  const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    return;
  }
  const root = result.stdout.trim();
  return root.length > 0 ? resolve(root) : undefined;
}

export function gitHeadCommit(cwd: string): string | undefined {
  const result = runGit(cwd, ["rev-parse", "HEAD"]);
  if (result.status !== 0) {
    return;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : undefined;
}

export function gitBranchName(cwd: string): {
  branch?: string;
  detached: boolean;
} {
  const result = runGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (result.status !== 0) {
    return { detached: true };
  }
  const branch = result.stdout.trim();
  return { branch: branch.length > 0 ? branch : undefined, detached: false };
}

export function gitLsTracked(cwd: string, relativePath: string): boolean {
  const result = runGit(cwd, [
    "ls-files",
    "--error-unmatch",
    "--",
    relativePath,
  ]);
  return result.status === 0;
}

export function gitBlobSha(
  cwd: string,
  relativePath: string,
  commit = "HEAD"
): string | undefined {
  const result = runGit(cwd, ["rev-parse", `${commit}:${relativePath}`]);
  if (result.status !== 0) {
    return;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : undefined;
}

export function gitStatusPorcelainV2(
  cwd: string,
  pathspecs: readonly string[]
): PorcelainV2Record[] {
  const result = runGit(cwd, [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--",
    ...pathspecs,
  ]);
  if (result.status !== 0) {
    return [];
  }
  return parsePorcelainV2(result.stdout);
}
