/**
 * EXAMPLE: L1 — paged/bounded UPDATE (only one page of matches).
 *
 * Uses rowid IN (SELECT rowid … ORDER BY … LIMIT/OFFSET) on D1.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });

    if (request.method !== "POST") {
      return Response.json({
        example: "09-l1-update-paged",
        routes: ["POST / — rename first page of active users"],
      });
    }

    // First page of 10 active users, ordered by id
    const { data, count, error } = await athena
      .from("users")
      .eq("active", 1)
      .order("id", { ascending: true })
      .range(0, 9)
      .update({ name: "bulk-renamed" });
    console.log("data", data);

    return Response.json({
      count,
      data,
      error: error?.message ?? null,
      example: "09-l1-update-paged",
      note: "Only the first 10 matching rows are updated (not every active user)",
    });
  },
};
