/**
 * EXAMPLE: Always gateway (athena_rs server over HTTP).
 *
 * Same package entrypoint, but mode forced so D1 is ignored for DB.
 * Useful for staging against a real Athena cluster from a Worker.
 */
import { createAthenaRuntime } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    if (!(env.ATHENA_URL && env.ATHENA_API_KEY)) {
      return Response.json(
        { error: "ATHENA_URL and ATHENA_API_KEY required for gateway mode" },
        { status: 500 }
      );
    }

    const { mode, client: athena } = createAthenaRuntime({
      client: "edge-example-gateway",
      d1: env.DB, // optional; not used for DB when mode=gateway
      key: env.ATHENA_API_KEY,
      mode: "gateway", // force server; d1 is ignored for DB
      url: env.ATHENA_URL,
    });

    const { data, error } = await athena.query("SELECT 1 AS ok");
    return Response.json({
      capabilities: athena.capabilities,
      data,
      error: error?.message ?? null,
      example: "02-mode-gateway-only",
      mode,
    });
  },
};
