import { AthenaConfigurationError } from "../config/errors.ts";

/**
 * Direct PostgreSQL requires a Node.js server runtime (pg + sockets).
 */
export function assertNodePostgresRuntime(): void {
  const isNode =
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.node === "string" &&
    process.versions.node.length > 0;

  if (!isNode) {
    throw new AthenaConfigurationError(
      "ATHENA_NODE_RUNTIME_REQUIRED",
      "Direct PostgreSQL execution requires a Node.js server runtime. Use Athena Gateway or a runtime-native backend such as D1 in edge/client environments.",
      "db"
    );
  }
}

export function isNodePostgresRuntime(): boolean {
  try {
    assertNodePostgresRuntime();
    return true;
  } catch {
    return false;
  }
}
