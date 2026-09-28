import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { localRuntimeDirectory } from "./identity.ts";

const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 120_000;

export async function withLocalRuntimeLock<T>(
  projectRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const directory = localRuntimeDirectory(projectRoot);
  const path = join(directory, "postgres.lock");
  mkdirSync(directory, { recursive: true });
  const startedAt = Date.now();
  let acquired = false;
  while (!acquired) {
    try {
      writeFileSync(
        path,
        JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
        }),
        { encoding: "utf8", flag: "wx" }
      );
      acquired = true;
    } catch (error) {
      if (!isLockContention(error)) {
        throw error;
      }
      if (reclaimStaleLock(path)) {
        continue;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for the local PostgreSQL lifecycle lock at ${path}.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  try {
    return await operation();
  } finally {
    try {
      unlinkSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
    }
  }
}

function isLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "EPERM" || code === "EACCES";
}

function reclaimStaleLock(path: string): boolean {
  const snapshot = readLockSnapshot(path);
  if (!snapshot) {
    return false;
  }
  const metadata = snapshot.metadata;
  if (
    typeof metadata.pid !== "number" ||
    !Number.isInteger(metadata.pid) ||
    typeof metadata.createdAt !== "string" ||
    !Number.isFinite(Date.parse(metadata.createdAt))
  ) {
    return reclaimLockFile(path, snapshot);
  }
  if (isProcessAlive(metadata.pid)) {
    return false;
  }
  return reclaimLockFile(path, snapshot);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw error;
  }
}

interface LockSnapshot {
  content: string;
  metadata: { createdAt?: unknown; pid?: unknown };
  stat: LockStat;
}

interface LockStat {
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}

function readLockSnapshot(path: string): LockSnapshot | undefined {
  try {
    const before = readLockStat(path);
    const content = readFileSync(path, "utf8");
    const after = readLockStat(path);
    if (!sameLockStat(before, after)) {
      return undefined;
    }
    let metadata: { createdAt?: unknown; pid?: unknown } = {};
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed && typeof parsed === "object") {
        metadata = parsed as { createdAt?: unknown; pid?: unknown };
      }
    } catch {
      // Invalid lock metadata remains reclaimable, as in the previous behavior.
    }
    return { content, metadata, stat: after };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EPERM") {
      return undefined;
    }
    throw error;
  }
}

function readLockStat(path: string): LockStat {
  const stat = statSync(path);
  return {
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function sameLockStat(left: LockStat, right: LockStat): boolean {
  return (
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function reclaimLockFile(path: string, expected: LockSnapshot): boolean {
  const claimPath = `${path}.reclaim`;
  const stalePath = `${path}.${process.pid}.${Date.now()}.stale`;
  try {
    mkdirSync(claimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    const current = readLockSnapshot(path);
    if (
      !current ||
      current.content !== expected.content ||
      !sameLockStat(current.stat, expected.stat)
    ) {
      releaseClaim(claimPath);
      return false;
    }
    renameSync(path, stalePath);
  } catch (error) {
    releaseClaim(claimPath);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EPERM" || code === "EACCES") {
      return false;
    }
    throw error;
  }
  releaseClaim(claimPath);
  unlinkSync(stalePath);
  return true;
}

function releaseClaim(claimPath: string): void {
  try {
    rmdirSync(claimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
