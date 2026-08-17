/**
 * EXAMPLE: Hybrid — local D1 for app data + remote Athena Auth for sessions.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    if (!(env.ATHENA_AUTH_URL && env.ATHENA_API_KEY)) {
      return Response.json(
        {
          error: "ATHENA_AUTH_URL and ATHENA_API_KEY required for hybrid auth",
        },
        { status: 500 }
      );
    }

    const cookie = request.headers.get("cookie");
    const authorization = request.headers.get("authorization");

    const athena = createCloudflareClient({
      auth: { url: env.ATHENA_AUTH_URL },
      context: {
        bearerToken: authorization?.toLowerCase().startsWith("bearer ")
          ? authorization.slice(7)
          : undefined,
        cookie,
      },
      d1: env.DB,
      key: env.ATHENA_API_KEY,
    });

    const session = await athena.auth.getSession();
    const userId =
      session &&
      typeof session === "object" &&
      session !== null &&
      "data" in session
        ? ((session as { data?: { user?: { id?: string } } }).data?.user?.id ??
          null)
        : null;

    // App-enforced tenant filter (no automatic RLS on edge D1)
    const notes = userId
      ? await athena
          .withContext({ userId })
          .query(
            "SELECT id, body FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
            { params: [userId] }
          )
      : { count: 0, data: [], error: null };

    return Response.json({
      authenticated: Boolean(userId),
      capabilities: athena.capabilities,
      example: "15-hybrid-auth",
      notes: notes.data,
      notesError: notes.error?.message ?? null,
      userId,
    });
  },
};
