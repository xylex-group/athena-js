/**
 * EXAMPLE: L3a — R2 put / get / list / delete via createCloudflareClient({ r2 }).
 *
 * Requires D1 (constructor) + R2 binding. Catalogs/backups are not available.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(request: Request, env: ExampleEnv): Promise<Response> {
    if (!(env.DB && env.FILES)) {
      return Response.json(
        { error: "DB and FILES bindings required" },
        { status: 500 }
      );
    }

    const athena = createCloudflareClient({
      d1: env.DB,
      r2: env.FILES,
      storagePrefix: "demo/",
    });

    if (!athena.capabilities.storage.objects) {
      return Response.json({ error: "storage.objects false" }, { status: 500 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/upload" && request.method === "POST") {
      const key = url.searchParams.get("key") ?? `note-${Date.now()}.txt`;
      const body = await request.text();
      const put = await athena.storage.putObject({
        body,
        contentType: "text/plain",
        key,
      });
      return Response.json({ example: "14-l3a-put", put });
    }

    if (url.pathname === "/object" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) {
        return Response.json({ error: "key required" }, { status: 400 });
      }
      const object = await athena.storage.getObject({ key });
      if (!object) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(await object.body.text(), {
        headers: {
          "content-type": object.contentType ?? "text/plain",
          "x-key": object.key,
        },
      });
    }

    if (url.pathname === "/list") {
      const listed = await athena.storage.listObjects({
        limit: 50,
        prefix: url.searchParams.get("prefix") ?? "",
      });
      return Response.json({ example: "14-l3a-list", ...listed });
    }

    if (url.pathname === "/object" && request.method === "DELETE") {
      const key = url.searchParams.get("key");
      if (!key) {
        return Response.json({ error: "key required" }, { status: 400 });
      }
      const deleted = await athena.storage.deleteObject({ key });
      return Response.json({ deleted, example: "14-l3a-delete" });
    }

    return Response.json({
      capabilities: athena.capabilities.storage,
      example: "14-l3a-r2-storage",
      note: "Keys are stored under storagePrefix demo/. D1+R2 are not transactional.",
      routes: [
        "POST /upload?key=path.txt",
        "GET /object?key=path.txt",
        "GET /list?prefix=",
        "DELETE /object?key=path.txt",
      ],
    });
  },
};
