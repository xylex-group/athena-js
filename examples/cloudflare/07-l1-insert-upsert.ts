/**
 * EXAMPLE: L1 — insert and upsert (ON CONFLICT).
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

    if (url.pathname === "/insert" && request.method === "POST") {
      const body = (await request.json()) as {
        email: string;
        name?: string;
        role?: string;
      };
      const result = await athena.from("users").insert({
        active: 1,
        email: body.email,
        name: body.name ?? null,
        role: body.role ?? "member",
      });
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "07-l1-insert",
      });
    }

    if (url.pathname === "/upsert" && request.method === "POST") {
      const body = (await request.json()) as { email: string; name?: string };
      const result = await athena.from("users").upsert(
        {
          active: 1,
          email: body.email,
          name: body.name ?? null,
        },
        { onConflict: "email" }
      );
      return Response.json({
        data: result.data,
        error: result.error?.message ?? null,
        example: "07-l1-upsert",
      });
    }

    return Response.json({
      example: "07-l1-insert-upsert",
      routes: [
        "POST /insert  { email, name?, role? }",
        "POST /upsert  { email, name? }  — onConflict email",
      ],
    });
  },
};
