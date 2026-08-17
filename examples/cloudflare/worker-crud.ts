/**
 * L0/L1 CRUD cookbook for Athena edge-local D1.
 *
 * Expects schema/users.sql (id, resource_id, email, name, role, active, …).
 * For a single Worker with every route, prefer app.ts.
 */
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import { deleteUserByIdOrResourceId } from "./shared/delete-user.ts";
import type { ExampleEnv, UserRow } from "./shared/env.ts";

export type Env = ExampleEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB binding required" }, { status: 500 });
    }
    const athena = createCloudflareClient({ d1: env.DB });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/seed" && request.method === "POST") {
        // Sparse multi-row: second row omits role → SQLite DEFAULT via per-row insert batch
        const insert = await athena.from("users").insert([
          {
            active: 1,
            email: "ada@example.com",
            id: "u1",
            name: "Ada",
            resource_id: "res-ada",
            role: "admin",
          },
          {
            active: 1,
            email: "grace@example.com",
            id: "u2",
            name: "Grace",
            resource_id: "res-grace",
          },
        ]);
        if (insert.error) {
          throw new Error(insert.error.message);
        }
        return Response.json({ seeded: true });
      }

      if (url.pathname === "/users" && request.method === "GET") {
        const page = await athena
          .from("users")
          .eq("active", 1)
          .order("email", { ascending: true })
          .limit(20)
          .select("id,resource_id,email,name,role,active");
        if (page.error) {
          throw new Error(page.error.message);
        }
        return Response.json({
          count: page.count,
          data: page.data as UserRow[] | null,
        });
      }

      if (url.pathname === "/users/count" && request.method === "GET") {
        // Head-only: no row body, COUNT(*) under the hood
        const head = await athena
          .from("users")
          .eq("active", 1)
          .select("*", { head: true });
        if (head.error) {
          throw new Error(head.error.message);
        }
        return Response.json({ count: head.count ?? 0, data: head.data });
      }

      if (url.pathname === "/users/upsert" && request.method === "POST") {
        const body = (await request.json()) as {
          email: string;
          name?: string;
          resource_id?: string;
        };
        const result = await athena.from("users").upsert(
          {
            active: 1,
            email: body.email,
            id: crypto.randomUUID(),
            name: body.name ?? null,
            resource_id: body.resource_id ?? null,
          },
          { onConflict: "email" }
        );
        if (result.error) {
          throw new Error(result.error.message);
        }
        return Response.json({ data: result.data, upserted: true });
      }

      if (url.pathname === "/users/page-update" && request.method === "POST") {
        // Bounded update: only one page of matches (identity subquery)
        const result = await athena
          .from("users")
          .eq("active", 1)
          .order("id", { ascending: true })
          .range(0, 9)
          .update({ name: "bulk-renamed" });
        if (result.error) {
          throw new Error(result.error.message);
        }
        return Response.json({ count: result.count, updated: true });
      }

      if (url.pathname.startsWith("/users/") && request.method === "DELETE") {
        const id = url.pathname.slice("/users/".length);
        const deleted = await deleteUserByIdOrResourceId(
          athena as Parameters<typeof deleteUserByIdOrResourceId>[0],
          id
        );
        if (deleted.error) {
          throw new Error(deleted.error);
        }
        return Response.json({
          count: deleted.count,
          deleted: true,
          matched: deleted.matched,
        });
      }

      if (url.pathname === "/query" && request.method === "POST") {
        const body = (await request.json()) as {
          sql: string;
          params?: unknown[];
        };
        const result = await athena.query(body.sql, { params: body.params });
        if (result.error) {
          throw new Error(result.error.message);
        }
        return Response.json({ count: result.count, data: result.data });
      }

      return Response.json({
        capabilities: athena.capabilities,
        routes: [
          "POST /seed",
          "GET /users",
          "GET /users/count",
          "POST /users/upsert",
          "POST /users/page-update",
          "DELETE /users/:id  (resource_id then id)",
          "POST /query { sql, params? }",
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  },
};
