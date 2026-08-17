/**
 * EXAMPLE: L1 — .eq('id', uuid) on edge (no Postgres ::text cast on D1).
 *
 * Shared SDK planners may emit "id"::text = '…'::text for UUID columns;
 * the edge transport rewrites that to SQLite-safe equality.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });
    const url = new URL(request.url);
    const id =
      url.searchParams.get("id") ?? "550e8400-e29b-41d4-a716-446655440000";

    const result = await athena
      .from("users")
      .eq("id", id)
      .select("id,email,name");

    return Response.json({
      data: result.data,
      error: result.error?.message ?? null,
      example: "13-l1-uuid-eq",
      id,
      note: "Safe on D1: Postgres ::text casts are stripped before execution",
    });
  },
};
