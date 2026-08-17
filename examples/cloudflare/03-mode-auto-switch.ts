/**
 * EXAMPLE: Auto switch — edge if D1 is bound, else gateway if ATHENA_URL is set.
 *
 * Default for apps that deploy both "local D1" and "remote Athena" environments.
 */
import { createAthenaRuntime } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    try {
      const { mode, client: athena } = createAthenaRuntime({
        d1: env.DB,
        env: {
          ATHENA_EXECUTION_MODE: env.ATHENA_EXECUTION_MODE,
          ATHENA_EXECUTION_PREFER: env.ATHENA_EXECUTION_PREFER,
          ATHENA_URL: env.ATHENA_URL,
        },
        key: env.ATHENA_API_KEY,
        mode: "auto",
        prefer: env.ATHENA_EXECUTION_PREFER,
        ...(env.FILES ? { r2: env.FILES } : {}),
        url: env.ATHENA_URL,
      });

      const { data, error } = await athena.query("SELECT 1 AS ok");
      return Response.json({
        capabilities: athena.capabilities,
        data,
        error: error?.message ?? null,
        example: "03-mode-auto-switch",
        howChosen:
          mode === "edge"
            ? "D1 binding present → edge"
            : "No D1 (or forced) + ATHENA_URL → gateway",
        mode,
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : String(error),
          example: "03-mode-auto-switch",
          hint: "Provide env.DB and/or ATHENA_URL + ATHENA_API_KEY",
        },
        { status: 500 }
      );
    }
  },
};
