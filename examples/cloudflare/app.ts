/**
 * Unified demo Worker — one process, every 01–17 example surface.
 *
 * Point wrangler `main` at this file to try modes + L0/L1/R2 without swapping files.
 *
 *   GET  /                    catalog (maps routes → example #)
 *   GET  /mode                01–04 resolved execution mode
 *   GET  /health              smoke SELECT 1
 *   GET  /users               06 L1 select
 *   GET  /users/count         11 head count
 *   GET  /users/page          12 exact total + page
 *   POST /users               07 insert
 *   POST /users/upsert        07 upsert
 *   POST /users/sparse        08 sparse multi-row
 *   POST /users/default-values  08 DEFAULT VALUES
 *   POST /users/default-to-null 08 defaultToNull
 *   POST /users/page-update   09 paged update
 *   DELETE /users/page        10 paged delete
 *   DELETE /users/by-resource/:id  10 delete by resource_id
 *   DELETE /users/by-id/:id   10 delete by primary key
 *   DELETE /users/:id         10 smart delete (resource_id then id)
 *   GET  /uuid?id=            13 uuid eq
 *   POST /query               05 raw SQL { sql, params? }
 *   /storage/*                14 R2 (needs FILES)
 *   GET  /capabilities        16 feature flags
 *   GET  /session             15 hybrid auth (needs ATHENA_AUTH_URL)
 *   GET  /tenant              17 withContext + tenant WHERE
 */
import {
  type AthenaRuntimeResult,
  type AthenaWorkerEnv,
  createAthenaFromWorkerEnv,
} from "@xylex-group/athena/cloudflare";
import { deleteUserByIdOrResourceId } from "./shared/delete-user.ts";

export type Env = AthenaWorkerEnv;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function errorResponse(error: unknown, status = 500): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message, ok: false }, status);
}

/** Avoid TS2589 (instantiation depth) on createAthenaFromWorkerEnv generics. */
function buildDemoRuntime(env: Env): AthenaRuntimeResult {
  const build = createAthenaFromWorkerEnv as unknown as (
    workerEnv: Env,
    options: { storagePrefix: string }
  ) => AthenaRuntimeResult;
  return build(env, { storagePrefix: "demo/" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    let mode: string;
    let athena: AthenaRuntimeResult["client"];
    let capabilities: AthenaRuntimeResult["capabilities"];
    try {
      ({ mode, client: athena, capabilities } = buildDemoRuntime(env));
    } catch (error) {
      return errorResponse(error, 500);
    }

    try {
      if (path === "/" || path === "") {
        return json({
          app: "athena-cloudflare-demo",
          capabilities,
          examples: {
            "01-04-modes": "GET /mode (+ ATHENA_EXECUTION_MODE / bindings)",
            "05-l0-raw-query": "POST /query",
            "06-l1-select-filter": "GET /users",
            "07-l1-insert-upsert": "POST /users | POST /users/upsert",
            "08-l1-insert-sparse-and-defaults":
              "POST /users/sparse | /users/default-values | /users/default-to-null",
            "09-l1-update-paged": "POST /users/page-update",
            "10-l1-delete":
              "DELETE /users/page | /users/by-resource/:id | /users/by-id/:id | /users/:id",
            "11-l1-head-count": "GET /users/count",
            "12-l1-exact-count": "GET /users/page",
            "13-l1-uuid-eq": "GET /uuid?id=",
            "14-l3a-r2-storage": "GET|POST|DELETE /storage…",
            "15-hybrid-auth": "GET /session",
            "16-capabilities": "GET /capabilities",
            "17-with-context-tenant": "GET /tenant (header X-User-Id)",
          },
          mode,
          routes: [
            "GET /mode",
            "GET /health",
            "GET /users",
            "GET /users/count",
            "GET /users/page",
            "POST /users",
            "POST /users/upsert",
            "POST /users/sparse",
            "POST /users/default-values",
            "POST /users/default-to-null",
            "POST /users/page-update",
            "DELETE /users/page",
            "DELETE /users/by-resource/:id",
            "DELETE /users/by-id/:id",
            "DELETE /users/:id",
            "GET /uuid?id=",
            "POST /query  { sql, params? }",
            "GET|POST|DELETE /storage… (R2)",
            "GET /capabilities",
            "GET /session",
            "GET /tenant  (X-User-Id, optional X-Organization-Id)",
          ],
          tip: "Set ATHENA_EXECUTION_MODE=edge|gateway|auto and ATHENA_EXECUTION_PREFER when both D1 and ATHENA_URL exist",
        });
      }

      if (path === "/mode") {
        return json({
          capabilities,
          env: {
            ATHENA_EXECUTION_MODE: env.ATHENA_EXECUTION_MODE ?? null,
            ATHENA_EXECUTION_PREFER: env.ATHENA_EXECUTION_PREFER ?? null,
            hasD1: Boolean(env.DB),
            hasR2: Boolean(env.FILES),
            hasUrl: Boolean(env.ATHENA_URL),
          },
          mode,
        });
      }

      if (path === "/health") {
        const result = await athena.query<{ ok: number }>("SELECT 1 AS ok");
        return json({
          data: result.data,
          error: result.error?.message ?? null,
          mode,
        });
      }

      if (path === "/users" && request.method === "GET") {
        const page = await athena
          .from("users")
          .eq("active", 1)
          .order("email", { ascending: true })
          .limit(20)
          .select("id,email,name,role,active");
        return json({
          count: page.count,
          data: page.data,
          error: page.error?.message,
          mode,
        });
      }

      if (path === "/users/count" && request.method === "GET") {
        const head = await athena
          .from("users")
          .eq("active", 1)
          .select("*", { head: true });
        return json({
          count: head.count,
          data: head.data,
          error: head.error?.message,
          mode,
        });
      }

      if (path === "/users/page" && request.method === "GET") {
        const page = await athena
          .from("users")
          .eq("active", 1)
          .range(0, 9)
          .select("id,email", { count: "exact" });
        return json({
          data: page.data,
          error: page.error?.message,
          mode,
          pageLength: Array.isArray(page.data) ? page.data.length : 0,
          totalCount: page.count,
        });
      }

      if (path === "/users" && request.method === "POST") {
        const body = (await request.json()) as {
          email: string;
          name?: string;
          role?: string;
          resource_id?: string;
        };
        const result = await athena.from("users").insert({
          active: 1,
          email: body.email,
          name: body.name ?? null,
          resource_id: body.resource_id ?? null,
          role: body.role ?? "member",
        });
        return json({ data: result.data, error: result.error?.message, mode });
      }

      if (path === "/users/upsert" && request.method === "POST") {
        const body = (await request.json()) as { email: string; name?: string };
        const result = await athena
          .from("users")
          .upsert(
            { active: 1, email: body.email, name: body.name ?? null },
            { onConflict: "email" }
          );
        return json({ data: result.data, error: result.error?.message, mode });
      }

      if (path === "/users/sparse" && request.method === "POST") {
        const result = await athena.from("users").insert([
          {
            active: 1,
            email: `a-${Date.now()}@example.com`,
            name: "Ada",
            role: "admin",
          },
          { active: 1, email: `b-${Date.now()}@example.com`, name: "Grace" },
        ]);
        return json({
          data: result.data,
          error: result.error?.message,
          example: "08-sparse-multi-row",
          mode,
          note: "Second row omits role → table DEFAULT",
        });
      }

      if (path === "/users/default-values" && request.method === "POST") {
        // INSERT DEFAULT VALUES — may fail if email NOT NULL has no default.
        const result = await athena.from("users").insert({});
        return json({
          data: result.data,
          error: result.error?.message,
          example: "08-default-values",
          mode,
          note: "INSERT INTO users DEFAULT VALUES",
        });
      }

      if (path === "/users/default-to-null" && request.method === "POST") {
        const stamp = Date.now();
        const result = await athena.from("users").insert(
          [
            { active: 1, email: `c-${stamp}@example.com` },
            { active: 1, email: `d-${stamp}@example.com` },
          ],
          { defaultToNull: true }
        );
        return json({
          data: result.data,
          error: result.error?.message,
          example: "08-default-to-null",
          mode,
          note: "Missing name/role bound as NULL (not DEFAULT)",
        });
      }

      if (path === "/users/page-update" && request.method === "POST") {
        const result = await athena
          .from("users")
          .eq("active", 1)
          .order("id", { ascending: true })
          .range(0, 9)
          .update({ name: "bulk-renamed" });
        return json({
          count: result.count,
          error: result.error?.message,
          example: "09-l1-update-paged",
          mode,
        });
      }

      if (path === "/users/page" && request.method === "DELETE") {
        const result = await athena
          .from("users")
          .eq("active", 0)
          .order("id", { ascending: true })
          .range(0, 4)
          .delete();
        return json({
          count: result.count,
          error: result.error?.message,
          example: "10-l1-delete-paged",
          mode,
          note: "Bounded delete of first 5 inactive users",
        });
      }

      if (
        path.startsWith("/users/by-resource/") &&
        request.method === "DELETE"
      ) {
        const resourceId = path.slice("/users/by-resource/".length);
        const result = await athena
          .from("users")
          .eq("resource_id", resourceId)
          .delete();
        return json({
          count: result.count,
          error: result.error?.message,
          example: "10-l1-delete-by-resource-id",
          mode,
          resourceId,
        });
      }

      if (path.startsWith("/users/by-id/") && request.method === "DELETE") {
        const id = path.slice("/users/by-id/".length);
        const result = await athena.from("users").eq("id", id).delete();
        return json({
          count: result.count,
          error: result.error?.message,
          example: "10-l1-delete-by-id",
          id,
          mode,
        });
      }

      if (path.startsWith("/users/") && request.method === "DELETE") {
        const id = path.slice("/users/".length);
        // Prefer resource_id (app key); fall back to primary key id.
        const deleted = await deleteUserByIdOrResourceId(
          athena as Parameters<typeof deleteUserByIdOrResourceId>[0],
          id
        );
        return json({
          count: deleted.count,
          error: deleted.error,
          example: "10-l1-delete",
          id,
          matched: deleted.matched,
          mode,
        });
      }

      if (path === "/uuid" && request.method === "GET") {
        const id =
          url.searchParams.get("id") ?? "550e8400-e29b-41d4-a716-446655440000";
        const result = await athena
          .from("users")
          .eq("id", id)
          .select("id,email");
        return json({
          data: result.data,
          error: result.error?.message,
          id,
          mode,
        });
      }

      if (path === "/query" && request.method === "POST") {
        const body = (await request.json()) as {
          sql: string;
          params?: unknown[];
        };
        const result = await athena.query(body.sql, { params: body.params });
        return json({
          count: result.count,
          data: result.data,
          error: result.error?.message,
          mode,
        });
      }

      if (path.startsWith("/storage")) {
        if (!capabilities.storage.objects) {
          return json(
            {
              capabilities: capabilities.storage,
              error:
                "R2 not available in this mode (bind FILES and use edge mode)",
              mode,
            },
            400
          );
        }
        const storage = athena.storage as {
          putObject: (i: {
            key: string;
            body: string;
            contentType?: string;
          }) => Promise<unknown>;
          getObject: (i: { key: string }) => Promise<{
            body: { text: () => Promise<string> };
            key: string;
          } | null>;
          listObjects: (i?: { prefix?: string }) => Promise<unknown>;
          deleteObject: (i: { key: string }) => Promise<unknown>;
        };

        if (path === "/storage/upload" && request.method === "POST") {
          const key = url.searchParams.get("key") ?? `note-${Date.now()}.txt`;
          const put = await storage.putObject({
            body: await request.text(),
            contentType: "text/plain",
            key,
          });
          return json({ mode, put });
        }
        if (path === "/storage/object" && request.method === "GET") {
          const key = url.searchParams.get("key");
          if (!key) {
            return json({ error: "key required" }, 400);
          }
          const object = await storage.getObject({ key });
          if (!object) {
            return new Response("Not found", { status: 404 });
          }
          return new Response(await object.body.text(), {
            headers: { "content-type": "text/plain", "x-key": object.key },
          });
        }
        if (path === "/storage/list") {
          const listed = await storage.listObjects({
            prefix: url.searchParams.get("prefix") ?? "",
          });
          return json({
            mode,
            ...(typeof listed === "object" && listed !== null
              ? (listed as Record<string, unknown>)
              : { listed }),
          });
        }
        if (path === "/storage/object" && request.method === "DELETE") {
          const key = url.searchParams.get("key");
          if (!key) {
            return json({ error: "key required" }, 400);
          }
          return json({ deleted: await storage.deleteObject({ key }), mode });
        }
        return json({
          routes: [
            "POST /storage/upload?key=",
            "GET /storage/object?key=",
            "GET /storage/list?prefix=",
            "DELETE /storage/object?key=",
          ],
        });
      }

      if (path === "/capabilities") {
        return json({ capabilities, mode });
      }

      if (path === "/session") {
        if (!capabilities.auth.remote) {
          return json(
            {
              error: "Set ATHENA_AUTH_URL for hybrid auth",
              example: "15-hybrid-auth",
              mode,
            },
            400
          );
        }
        const session = await athena.auth.getSession();
        return json({ example: "15-hybrid-auth", mode, session });
      }

      if (path === "/tenant" && request.method === "GET") {
        const userId = request.headers.get("x-user-id");
        const organizationId = request.headers.get("x-organization-id");
        if (!userId) {
          return json(
            {
              error: "Pass X-User-Id header",
              example: "17-with-context-tenant",
              mode,
            },
            401
          );
        }
        // withContext returns a request view (not the root client).
        const scoped = athena.withContext({ organizationId, userId });
        const notes = await scoped.query(
          "SELECT id, body, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
          { params: [userId] }
        );
        return json({
          error: notes.error?.message ?? null,
          example: "17-with-context-tenant",
          mode,
          note: "withContext sets hybrid headers; D1 isolation is your WHERE clause",
          notes: notes.data,
          organizationId,
          userId,
        });
      }

      return json({ error: "not found", path }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
