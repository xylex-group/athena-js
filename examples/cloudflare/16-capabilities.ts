/**
 * EXAMPLE: Feature-detect with client.capabilities (edge vs gateway).
 */
import { createAthenaRuntime } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    const { mode, client: athena } = createAthenaRuntime({
      d1: env.DB,
      env: {
        ATHENA_EXECUTION_MODE: env.ATHENA_EXECUTION_MODE,
        ATHENA_EXECUTION_PREFER: env.ATHENA_EXECUTION_PREFER,
        ATHENA_URL: env.ATHENA_URL,
      },
      key: env.ATHENA_API_KEY,
      mode: env.ATHENA_EXECUTION_MODE ?? "auto",
      prefer: env.ATHENA_EXECUTION_PREFER,
      ...(env.FILES ? { r2: env.FILES } : {}),
      url: env.ATHENA_URL,
    });

    const caps = athena.capabilities;
    const canUseRpc = caps.db.layers.rpc;
    const canUseR2Objects = caps.storage.objects;
    const isLocalD1 = caps.db.local;

    return Response.json({
      capabilities: caps,
      checks: {
        canUseR2Objects,
        canUseRpc,
        isLocalD1,
        recommend: isLocalD1
          ? canUseRpc
            ? "D1 local: Query AST / CRUD / RPC"
            : "D1 local: Query AST / CRUD; RPC is unsupported"
          : "Full gateway features depend on server backend",
      },
      example: "16-capabilities",
      mode,
    });
  },
};
