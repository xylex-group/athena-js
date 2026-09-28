import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { localRuntimeStatePath } from "./identity.ts";

export interface LocalRuntimeState {
  containerName: string;
  createdAt: string;
  database: string;
  identity: string;
  image: string;
  password: string;
  port: number;
  user: string;
  volumeName: string;
}

export type LocalRuntimeDiagnostics = Omit<LocalRuntimeState, "password">;

export function readLocalRuntimeState(
  projectRoot: string
): LocalRuntimeState | undefined {
  const path = localRuntimeStatePath(projectRoot);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isLocalRuntimeState(parsed)) {
      throw new Error(`Invalid local runtime state at ${path}.`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function writeLocalRuntimeState(
  projectRoot: string,
  state: LocalRuntimeState
): void {
  const path = resolve(localRuntimeStatePath(projectRoot));
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export function deleteLocalRuntimeState(projectRoot: string): void {
  try {
    unlinkSync(localRuntimeStatePath(projectRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function redactLocalRuntimeState(
  state: LocalRuntimeState
): LocalRuntimeDiagnostics {
  const { password: _password, ...diagnostics } = state;
  return diagnostics;
}

function isLocalRuntimeState(value: unknown): value is LocalRuntimeState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.containerName === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.database === "string" &&
    typeof record.identity === "string" &&
    typeof record.image === "string" &&
    typeof record.password === "string" &&
    typeof record.port === "number" &&
    typeof record.user === "string" &&
    typeof record.volumeName === "string"
  );
}
