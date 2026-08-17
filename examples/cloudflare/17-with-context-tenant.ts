/**
 * EXAMPLE: withContext for identity headers (hybrid remote) + app tenant filters.
 *
 * On edge D1, withContext does NOT apply automatic RLS — always filter in SQL/builders.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }

    const userId = request.headers.get("x-user-id");
    const organizationId = request.headers.get("x-organization-id");

    const athena = createCloudflareClient({
      d1: env.DB,
      // optional hybrid services still receive context headers
      ...(env.ATHENA_URL
        ? { key: env.ATHENA_API_KEY, url: env.ATHENA_URL }
        : {}),
    });

    if (!userId) {
      return Response.json(
        {
          error: "Pass X-User-Id header",
          example: "17-with-context-tenant",
        },
        { status: 401 }
      );
    }

    const scoped = athena.withContext({ organizationId, userId });

    // Explicit tenant filter on edge (required for isolation)
    const notes = await scoped.query(
      "SELECT id, body, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      { params: [userId] }
    );

    return Response.json({
      error: notes.error?.message ?? null,
      example: "17-with-context-tenant",
      note: "withContext sets hybrid headers; D1 isolation is your WHERE clause",
      notes: notes.data,
      organizationId,
      userId,
    });
  },
};
