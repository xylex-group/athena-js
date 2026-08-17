/**
 * EXAMPLE: L1 — sparse multi-row insert + DEFAULT VALUES + defaultToNull.
 *
 * Sparse multi-row (omit role) → batch of single-row inserts so SQLite defaults apply.
 * Single {} → INSERT INTO users DEFAULT VALUES.
 * defaultToNull: true → missing columns bound as NULL instead of default.
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

    if (url.pathname === "/sparse" && request.method === "POST") {
      // Second row omits role → DB DEFAULT 'member' (not NULL)
      const result = await athena.from("users").insert([
        { active: 1, email: "a@example.com", name: "Ada", role: "admin" },
        { active: 1, email: "b@example.com", name: "Grace" },
      ]);
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "08-sparse-multi-row",
        note: "Compiled as two INSERTs; role on row 2 uses table DEFAULT",
      });
    }

    if (url.pathname === "/default-values" && request.method === "POST") {
      // All columns from table defaults (id, role, active, created_at, …)
      // Requires email NOT NULL without default → may fail; for demo tables with defaults only.
      const result = await athena.from("users").insert({});
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "08-default-values",
        note: "INSERT INTO users DEFAULT VALUES — needs table defaults for NOT NULL cols",
      });
    }

    if (url.pathname === "/default-to-null" && request.method === "POST") {
      const result = await athena.from("users").insert(
        [
          { active: 1, email: "c@example.com" },
          { active: 1, email: "d@example.com" },
        ],
        { defaultToNull: true }
      );
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "08-default-to-null",
        note: "Missing name/role bound as NULL (not DEFAULT)",
      });
    }

    return Response.json({
      example: "08-l1-insert-sparse-and-defaults",
      routes: ["POST /sparse", "POST /default-values", "POST /default-to-null"],
    });
  },
};
