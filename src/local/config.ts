import type { AthenaLocalRuntimeConfig } from "../generator/types.ts";

export const DEFAULT_LOCAL_RUNTIME_CONFIG: Required<AthenaLocalRuntimeConfig> =
  {
    database: "postgres",
    host: "127.0.0.1",
    image: "postgres:17-alpine",
    port: 54_322,
    startupTimeoutMs: 60_000,
    user: "postgres",
    volume: "named",
  };

export function normalizeLocalRuntimeConfig(
  input: AthenaLocalRuntimeConfig | undefined
): Required<AthenaLocalRuntimeConfig> {
  const config = {
    ...DEFAULT_LOCAL_RUNTIME_CONFIG,
    ...(input ?? {}),
  };
  if (
    config.host !== "127.0.0.1" &&
    config.host !== "localhost" &&
    config.host !== "::1"
  ) {
    throw new Error(
      "Local PostgreSQL runtime host must be a loopback address (127.0.0.1, localhost, or ::1)."
    );
  }
  return {
    ...config,
    host: "127.0.0.1",
  };
}
