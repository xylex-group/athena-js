/**
 * EXAMPLE: L1 — paginated select with total count independent of page size.
 *
 * count: 'exact' runs a separate COUNT(*) so count is total matches, not page length.
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
      .range(0, 9)
      .select("id,email,name", { count: "exact" });

    const pageLen = Array.isArray(page.data) ? page.data.length : 0;

    return Response.json({
      data: page.data as UserRow[] | null,
      error: page.error?.message ?? null,
      example: "12-l1-exact-count",
      note: "page length may be 10 while count is the full filtered total",
      pageLength: pageLen,
      totalCount: page.count,
    });
  },
};
