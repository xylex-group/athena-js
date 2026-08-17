/**
 * Switch between edge (D1/R2) and gateway (athena_rs) with one factory.
 *
 * Prefer createAthenaFromWorkerEnv in new code (app.ts). This file shows
 * createAthenaRuntime with explicit bindings for clarity.
 *
 * Env:
 *   ATHENA_EXECUTION_MODE=auto|edge|gateway   (optional; default auto)
 *   ATHENA_EXECUTION_PREFER=edge|gateway      when both D1 and URL exist
 *   DB binding → edge when mode is auto/edge
 *   ATHENA_URL + ATHENA_API_KEY → gateway when mode is auto/gateway or no DB
 */
import {
  type AthenaResolvedExecutionMode,
  createAthenaRuntime,
} from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export type Env = ExampleEnv;

function buildRuntime(env: Env) {
  return createAthenaRuntime({
    d1: env.DB,
    env: {
      ATHENA_EXECUTION_MODE: env.ATHENA_EXECUTION_MODE,
      ATHENA_EXECUTION_PREFER: env.ATHENA_EXECUTION_PREFER,
      ATHENA_URL: env.ATHENA_URL,
    },
    key: env.ATHENA_API_KEY,
    mode: env.ATHENA_EXECUTION_MODE ?? "auto",
    prefer: env.ATHENA_EXECUTION_PREFER,
    // Only pass R2 when bound — undefined r2 is not the same as storage-only.
    ...(env.FILES ? { r2: env.FILES, storagePrefix: "app/" } : {}),
    url: env.ATHENA_URL,
    ...(env.ATHENA_AUTH_URL ? { auth: { url: env.ATHENA_AUTH_URL } } : {}),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    let mode: AthenaResolvedExecutionMode;
    let client: ReturnType<typeof buildRuntime>["client"];
    try {
      ({ mode, client } = buildRuntime(env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }

    if (url.pathname === "/mode") {
      return Response.json({
        capabilities: client.capabilities,
        hint: {
          auto: "D1 present → edge (default prefer); both D1+URL → ATHENA_EXECUTION_PREFER",
          forceEdge: "Set ATHENA_EXECUTION_MODE=edge and bind D1",
          forceGateway:
            "Set ATHENA_EXECUTION_MODE=gateway and ATHENA_URL + ATHENA_API_KEY",
        },
        mode,
      });
    }

    const health = await client.query("SELECT 1 AS ok");
    return Response.json({
      capabilities: client.capabilities,
      health: {
        data: health.data,
        error: health.error?.message ?? null,
      },
      mode,
    });
  },
};
