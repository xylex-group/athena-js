/**
 * EXAMPLE: Force mode via ATHENA_EXECUTION_MODE env (auto resolution respects it).
 *
 * Set in wrangler:
 *   vars: { ATHENA_EXECUTION_MODE: "gateway" }
 * or secret / dashboard env.
 *
 * Aliases: gateway|server|remote  ·  edge|d1|cloudflare  ·  auto
 */
import {
  ATHENA_EXECUTION_MODE_ENV_KEY,
  createAthenaRuntime,
  resolveAthenaExecutionMode,
} from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    const envMap = {
      [ATHENA_EXECUTION_MODE_ENV_KEY]: env.ATHENA_EXECUTION_MODE,
      ATHENA_URL: env.ATHENA_URL,
    };

    const resolved = resolveAthenaExecutionMode({
      // omit mode → read ATHENA_EXECUTION_MODE, else auto
      d1: env.DB,
      env: envMap,
      url: env.ATHENA_URL,
    });

    const { mode, client: athena } = createAthenaRuntime({
      d1: env.DB,
      env: envMap,
      key: env.ATHENA_API_KEY,
      // pass through so both explicit mode and env stay aligned
      mode: env.ATHENA_EXECUTION_MODE ?? "auto",
      url: env.ATHENA_URL,
    });

    return Response.json({
      capabilitiesMode: athena.capabilities.mode,
      envValue: env.ATHENA_EXECUTION_MODE ?? null,
      example: "04-mode-env-force",
      mode,
      resolvedBeforeCreate: resolved,
    });
  },
};
