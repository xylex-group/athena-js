/**
 * EXAMPLE: L1 — delete by resource_id column, by primary key id, and paged delete.
 *
 * Note: `.eq("resource_id", …)` filters the `resource_id` column (see schema/users.sql).
 * It does **not** rewrite to `id`. Use `.eq("id", …)` for the primary key.
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

    // DELETE /by-resource/:resourceId — filter on users.resource_id
    if (
      url.pathname.startsWith("/by-resource/") &&
      request.method === "DELETE"
    ) {
      const resourceId = url.pathname.slice("/by-resource/".length);
      const result = await athena
        .from("users")
        .eq("resource_id", resourceId)
        .delete();
      return Response.json({
        count: result.count,
        error: result.error?.message ?? null,
        example: "10-l1-delete-by-resource-id",
        resourceId,
      });
    }

    // DELETE /by-id/:id — filter on users.id (primary key)
    if (url.pathname.startsWith("/by-id/") && request.method === "DELETE") {
      const id = url.pathname.slice("/by-id/".length);
      const result = await athena.from("users").eq("id", id).delete();
      return Response.json({
        count: result.count,
        error: result.error?.message ?? null,
        example: "10-l1-delete-by-id",
        id,
      });
    }

    // DELETE /page — only first 5 inactive users
    if (url.pathname === "/page" && request.method === "DELETE") {
      const result = await athena
        .from("users")
        .eq("active", 0)
        .order("id", { ascending: true })
        .range(0, 4)
        .delete();
      return Response.json({
        count: result.count,
        error: result.error?.message ?? null,
        example: "10-l1-delete-paged",
        note: "Bounded delete via identity/rowid subquery",
      });
    }

    return Response.json({
      example: "10-l1-delete",
      routes: [
        "DELETE /by-resource/:resourceId",
        "DELETE /by-id/:id",
        "DELETE /page",
      ],
    });
  },
};
