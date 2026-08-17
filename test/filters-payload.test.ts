import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/v3-client.ts";

interface Captured {
  init?: RequestInit;
  url: string;
}

function withMockFetch(fn: (calls: Captured[]) => Promise<void> | void) {
  return async () => {
    const calls: Captured[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ init, url: String(url) });
      return new Response(JSON.stringify({ data: [], status: 200 }), {
        status: 200,
      });
    };
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = original;
    }
  };
}

const client = createClient({
  db: { url: "https://athena-db.com" },
  key: "secret",
});

test(
  "range sets limit/offset",
  withMockFetch(async (calls) => {
    await client.from("characters").range(5, 9).select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.offset, 5);
    assert.equal(payload.limit, 5);
  })
);

test(
  "match expands to multiple eq conditions",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .match({ active: true, role: "mage" })
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    // Object key insertion order: active then role.
    assert.deepEqual(payload.conditions, [
      {
        column: "active",
        eq_column: "active",
        eq_value: true,
        operator: "eq",
        value: true,
      },
      {
        column: "role",
        eq_column: "role",
        eq_value: "mage",
        operator: "eq",
        value: "mage",
      },
    ]);
  })
);

test(
  "not with operator/value encodes dot syntax",
  withMockFetch(async (calls) => {
    await client.from("characters").not("role", "eq", "banned").select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { operator: "not", value: "role.eq.banned" },
    ]);
  })
);

test(
  "not with raw expression passes through",
  withMockFetch(async (calls) => {
    await client.from("characters").not("role.eq.banned").select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { operator: "not", value: "role.eq.banned" },
    ]);
  })
);

test(
  "or expression is forwarded",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .or("role.eq.warrior,role.eq.mage")
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { operator: "or", value: "role.eq.warrior,role.eq.mage" },
    ]);
  })
);

test(
  "gt/gte/lt/lte payloads",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .gt("level", 1)
      .gte("level", 2)
      .lt("level", 10)
      .lte("level", 20)
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "level", operator: "gt", value: 1 },
      { column: "level", operator: "gte", value: 2 },
      { column: "level", operator: "lt", value: 10 },
      { column: "level", operator: "lte", value: 20 },
    ]);
  })
);

test(
  "like/ilike payloads",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .like("name", "%a%")
      .ilike("title", "%war%")
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "name", operator: "like", value: "%a%" },
      { column: "title", operator: "ilike", value: "%war%" },
    ]);
  })
);

test(
  "is null payload",
  withMockFetch(async (calls) => {
    await client.from("characters").is("deleted_at", null).select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "deleted_at", operator: "is", value: null },
    ]);
  })
);

test(
  "in array payload",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .in("role", ["mage", "warrior"])
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "role", operator: "in", value: ["mage", "warrior"] },
    ]);
  })
);

test(
  "contains payload",
  withMockFetch(async (calls) => {
    await client.from("characters").contains("tags", ["a"]).select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "tags", operator: "contains", value: ["a"] },
    ]);
  })
);

test(
  "containedBy payload",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .containedBy("tags", ["a", "b"])
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.conditions, [
      { column: "tags", operator: "containedBy", value: ["a", "b"] },
    ]);
  })
);

test(
  "offset/limit chaining after filters",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .eq("role", "mage")
      .limit(5)
      .offset(10)
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.limit, 5);
    assert.equal(payload.offset, 10);
    assert.deepEqual(payload.conditions, [
      {
        column: "role",
        eq_column: "role",
        eq_value: "mage",
        operator: "eq",
        value: "mage",
      },
    ]);
  })
);

test(
  "defaultToNull option passes to insert",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .insert({ name: "Bilbo" }, { defaultToNull: true })
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.default_to_null, true);
  })
);

test(
  "count/head options pass through select",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .select("id", { count: "exact", head: true });
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.count, "exact");
    assert.equal(payload.head, true);
  })
);

test(
  "upsert propagates update_body and on_conflict",
  withMockFetch(async (calls) => {
    await client
      .from("characters")
      .upsert(
        { id: 1, name: "Aragorn" },
        { onConflict: "id", updateBody: { name: "Strider" } }
      )
      .select("id");
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(payload.insert_body, { id: 1, name: "Aragorn" });
    assert.deepEqual(payload.update_body, { name: "Strider" });
    assert.equal(payload.on_conflict, "id");
  })
);

test("delete without filters throws", async () => {
  const builder = client.from("characters");
  let threw = false;
  try {
    builder.delete();
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "delete() without filters should throw");
});

test(
  "delete with resourceId option skips throw",
  withMockFetch(async (calls) => {
    await client.from("characters").delete({ resourceId: "abc" });
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.resource_id, "abc");
  })
);
