/**
 * EXAMPLE: L1 — head-only select (COUNT, no row body).
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });

    const head = await athena
      .from("users")
      .eq("active", 1)
      .select("*", { head: true });

    return Response.json({
      count: head.count ?? 0,
      data: head.data,
      error: head.error?.message ?? null,
      example: "11-l1-head-count",
      note: "Compiles SELECT COUNT(*) …; data is empty",
    });
  },
};
