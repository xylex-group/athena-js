/**
 * Minimal Cloudflare Worker using Athena edge-local D1.
 *
 * Copy into a Worker project as `src/index.ts` and point wrangler `main` at it.
 * Single-concern sibling: 01-mode-edge-only.ts
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { D1DatabaseLike, ExampleEnv } from "./shared/env.ts";

export type Env = ExampleEnv & { DB: D1DatabaseLike };

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB binding required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });

    const health = await athena.query<{ ok: number }>("SELECT 1 AS ok");
    if (health.error) {
      return Response.json(
        {
          capabilities: athena.capabilities,
          error: health.error.message,
          ok: false,
        },
        { status: 500 }
      );
    }

    const connection = await athena.verifyConnection();
    return Response.json({
      connection,
      engine: athena.capabilities.db.engine,
      mode: athena.capabilities.mode,
      ok: true,
      rows: health.data,
    });
  },
};
