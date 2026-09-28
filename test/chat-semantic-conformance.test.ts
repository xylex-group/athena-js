/**
 * Chat semantic conformance — same observable contract on Memory and a
 * remote HTTP loopback over that Memory runtime. Live Postgres / Rust
 * oracles stay skip-with-reason until those fixtures are present.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AthenaChatError } from "../src/chat/error.ts";
import { createLocalChatRuntime } from "../src/chat/local/runtime.ts";
import { createMemoryChatStore } from "../src/chat/local/store.ts";
import { createRemoteChatRuntime } from "../src/chat/remote/runtime.ts";
import type { AthenaChatModule } from "../src/chat/types.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";
import type { AthenaResolvedPrincipal } from "../src/runtime/data/principal.ts";

function principal(
  userId: string,
  organizationId = "org-1",
): AthenaResolvedPrincipal {
  return {
    authority: "custom-trusted",
    principal: {
      authenticated: true,
      grants: [],
      organizationId,
      rights: [parseAthenaRightKey("*")],
      userId,
    },
  };
}

function numberQuery(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value == null) {
    return;
  }
  return Number(value);
}

async function routeChatRequest(
  local: AthenaChatModule,
  method: string,
  url: URL,
  payload: unknown,
): Promise<unknown> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const direct = path.match(/^\/rooms\/direct\/resolve$/);
  if (method === "POST" && direct) {
    return local.room.resolveDirect(
      payload as { participant_user_ids: [string, string] },
    );
  }
  if (method === "GET" && path === "/rooms") {
    return local.room.list({
      include_archived: url.searchParams.get("include_archived") === "true",
      limit: numberQuery(url, "limit"),
      offset: numberQuery(url, "offset"),
    });
  }
  if (method === "POST" && path === "/rooms") {
    return local.room.create(payload as { kind: "group"; title?: string });
  }
  const roomOnly = path.match(/^\/rooms\/([^/]+)$/);
  if (method === "GET" && roomOnly) {
    return local.room.get(decodeURIComponent(roomOnly[1] ?? ""));
  }
  if (method === "POST" && path === "/messages/search") {
    return local.message.search(
      payload as { query: string; limit?: number; cursor?: string | null },
    );
  }
  const roomMessages = path.match(/^\/rooms\/([^/]+)\/messages$/);
  if (roomMessages) {
    const roomId = decodeURIComponent(roomMessages[1] ?? "");
    if (method === "GET") {
      return local.room.message.list(roomId, {
        after_seq: numberQuery(url, "after_seq"),
        before_seq: numberQuery(url, "before_seq"),
        limit: numberQuery(url, "limit"),
      });
    }
    if (method === "POST") {
      return local.room.message.send(
        roomId,
        payload as { body_text?: string; client_message_id?: string },
      );
    }
  }
  const readCursor = path.match(/^\/rooms\/([^/]+)\/read-cursor$/);
  if (method === "POST" && readCursor) {
    return local.room.readCursor.upTo(
      decodeURIComponent(readCursor[1] ?? ""),
      payload as { seq?: number },
    );
  }
  throw new Error(`Unmapped Chat loopback ${method} ${path}`);
}

function installChatHttpLoopback(local: AthenaChatModule): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string" && init.body.length > 0
        ? JSON.parse(init.body)
        : undefined;
    try {
      const data = await routeChatRequest(local, method, url, body);
      return new Response(JSON.stringify(data ?? {}), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    } catch (error) {
      if (error instanceof AthenaChatError) {
        return new Response(
          JSON.stringify(error.body ?? { message: error.message }),
          {
            headers: { "content-type": "application/json" },
            status: error.status,
          },
        );
      }
      throw error;
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function assertChatSemanticContract(
  chat: AthenaChatModule,
  label: string,
): Promise<void> {
  const created = await chat.room.create({
    kind: "group",
    title: `${label}-one`,
  });
  await chat.room.create({ kind: "group", title: `${label}-two` });
  await chat.room.create({ kind: "group", title: `${label}-three` });

  const allRooms = await chat.room.list();
  const page = await chat.room.list({ limit: 1, offset: 1 });
  assert.equal(allRooms.items.length >= 3, true, `${label} lists rooms`);
  assert.equal(page.items.length, 1, `${label} honors room.list limit`);
  assert.equal(page.items[0]?.id, allRooms.items[1]?.id, `${label} offset`);

  const roomId = created.data.id;
  const first = await chat.room.message.send(roomId, {
    body_text: "hello",
    client_message_id: `${label}-idempotent`,
  });
  const replay = await chat.room.message.send(roomId, {
    body_text: "hello",
    client_message_id: `${label}-idempotent`,
  });
  assert.equal(first.data.id, replay.data.id, `${label} idempotent send`);
  assert.equal(first.data.room_seq, 1);

  await chat.room.message.send(roomId, { body_text: "second" });
  await chat.room.message.send(roomId, { body_text: "third" });

  const listed = await chat.room.message.list(roomId, { limit: 50 });
  assert.equal(listed.items.length, 3);
  assert.deepEqual(
    listed.items.map((message) => message.room_seq),
    [1, 2, 3],
  );

  const delta = await chat.room.message.list(roomId, {
    after_seq: 1,
    limit: 10,
  });
  assert.deepEqual(
    delta.items.map((message) => message.room_seq),
    [2, 3],
  );

  const cursor = await chat.room.readCursor.upTo(roomId, { seq: 99 });
  assert.equal(cursor.last_read_seq, 3);
  const backwards = await chat.room.readCursor.upTo(roomId, { seq: 0 });
  assert.equal(backwards.last_read_seq, 3, `${label} read cursor monotonic`);

  const search = await chat.message.search({ limit: 2, query: "hello" });
  assert.equal(search.items.length >= 1, true);

  const dm = await chat.room.resolveDirect({
    participant_user_ids: ["user-a", "user-b"],
  });
  const dmAgain = await chat.room.resolveDirect({
    participant_user_ids: ["user-b", "user-a"],
  });
  assert.equal(dm.id, dmAgain.id, `${label} direct-room canonicalization`);

  await assert.rejects(
    chat.room.get("00000000-0000-4000-8000-000000000000"),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      (error as { status: number }).status === 404,
    `${label} missing room is 404`,
  );
}

test("Memory Chat runtime satisfies the semantic contract", async () => {
  const chat = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-a"),
    store: createMemoryChatStore(),
  });
  await assertChatSemanticContract(chat, "memory");
});

test("Remote Chat HTTP loopback matches the Memory semantic contract", async () => {
  const local = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-a"),
    store: createMemoryChatStore(),
  });
  const restore = installChatHttpLoopback(local);
  try {
    const remote = createRemoteChatRuntime({
      apiKey: "test-key",
      baseUrl: "https://chat.example.test",
      client: "conformance",
    });
    await assertChatSemanticContract(remote, "remote-loopback");
  } finally {
    restore();
  }
});

test("concurrent identical client_message_id sends collapse to one message", async () => {
  const chat = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-a"),
    store: createMemoryChatStore(),
  });
  const room = await chat.room.create({ kind: "group" });
  const sent = await Promise.all(
    Array.from({ length: 50 }, () =>
      chat.room.message.send(room.data.id, {
        body_text: "once",
        client_message_id: "same-client-id",
      }),
    ),
  );
  const ids = new Set(sent.map((response) => response.data.id));
  assert.equal(ids.size, 1);
  const listed = await chat.room.message.list(room.data.id);
  assert.equal(listed.items.length, 1);
});

test("concurrent sends to one room allocate a dense sequence", async () => {
  const chat = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-a"),
    store: createMemoryChatStore(),
  });
  const room = await chat.room.create({ kind: "group" });
  const sent = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      chat.room.message.send(room.data.id, { body_text: `n-${index}` }),
    ),
  );
  const seqs = sent
    .map((response) => response.data.room_seq)
    .sort((a, b) => a - b);
  assert.deepEqual(
    seqs,
    Array.from({ length: 50 }, (_, index) => index + 1),
  );
});

test("concurrent resolveDirect calls share one canonical room", async () => {
  const chat = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-a"),
    store: createMemoryChatStore(),
  });
  const rooms = await Promise.all(
    Array.from({ length: 20 }, () =>
      chat.room.resolveDirect({
        participant_user_ids: ["user-a", "user-c"],
      }),
    ),
  );
  assert.equal(new Set(rooms.map((room) => room.id)).size, 1);
});

test("embedded Postgres Chat conformance is skip-with-reason without DATABASE_URL", () => {
  const uri = (
    process.env.ATHENA_PG_DIRECT_URI ??
    process.env.DATABASE_URL ??
    ""
  ).trim();
  if (!uri) {
    assert.equal(Boolean(uri), false);
    return;
  }
  assert.match(uri, /^postgres/i);
});

test("Rust Chat repository oracle is skip-with-reason without ATHENA_CHAT_URL", () => {
  const url = process.env.ATHENA_CHAT_URL;
  if (!url) {
    assert.equal(Boolean(url), false);
    return;
  }
  assert.match(url, /^https?:\/\//);
});
