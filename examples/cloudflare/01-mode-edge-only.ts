/**
 * EXAMPLE: Always edge (D1 bindings) — never gateway HTTP.
 *
 * Use when the Worker owns D1 and you do not want server mode.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB binding required" }, { status: 500 });
    }

    const athena = createCloudflareClient({ d1: env.DB });

    const { data, error } = await athena.query<{ ok: number }>(
      "SELECT 1 AS ok"
    );
    return Response.json({
      capabilities: athena.capabilities,
      data,
      error: error?.message ?? null,
      example: "01-mode-edge-only",
      mode: "edge (forced via createCloudflareClient)",
    });
  },
};
