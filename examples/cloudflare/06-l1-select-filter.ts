/**
 * EXAMPLE: L1 — fluent select with filters, order, limit/offset.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv, UserRow } from "./shared/env.ts";

export default {
  async fetch(_request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });

    const page = await athena
      .from("users")
      .eq("active", 1)
      .order("email", { ascending: true })
      .limit(20)
      .offset(0)
      .select("id,email,name,role,active");

    const one = await athena
      .from("users")
      .eq("email", "ada@example.com")
      .maybeSingle("id,email,name");

    return Response.json({
      example: "06-l1-select-filter",
      one: {
        data: one.data,
        error: one.error?.message ?? null,
      },
      page: {
        count: page.count,
        data: page.data as UserRow[] | null,
        error: page.error?.message ?? null,
      },
    });
  },
};
