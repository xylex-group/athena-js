/**
 * EXAMPLE: L0 — raw SQLite SQL + bind params on D1.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv, UserRow } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });
    const url = new URL(request.url);

    if (url.pathname === "/params") {
      const active = Number(url.searchParams.get("active") ?? "1");
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const result = await athena.query<UserRow>(
        `SELECT id, email, name, role, active
         FROM users
         WHERE active = ?
         ORDER BY email
         LIMIT ?`,
        { params: [active, limit] }
      );
      return Response.json({
        count: result.count,
        data: result.data,
        error: result.error?.message ?? null,
        example: "05-l0-raw-query",
      });
    }

    // Multi-statement without params (DDL / seed helpers)
    if (url.pathname === "/multi" && request.method === "POST") {
      const result = await athena.query("SELECT 1 AS a; SELECT 2 AS b");
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "05-l0-raw-query multi-statement",
        note: "No bind params on multi-statement; sessions use batch(prepare)",
      });
    }

    const health = await athena.query<{ ok: number }>("SELECT 1 AS ok");
    return Response.json({
      example: "05-l0-raw-query",
      health: health.data,
      routes: ["GET /", "GET /params?active=1&limit=10", "POST /multi"],
    });
  },
};
