import assert from "node:assert/strict";
import test from "node:test";
import { createChatModule } from "../src/chat/module.ts";
import { createClient } from "../src/v3-client.ts";

test("chat GET builds a single deterministic URL without path probing", async () => {
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetches.push(url);
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
    });

    await chat.room.message.list("11111111-1111-1111-1111-111111111111", {
      limit: 50,
    });

    assert.equal(fetches.length, 1);
    assert.equal(
      fetches[0],
      "https://gateway.example.com/chat/rooms/11111111-1111-1111-1111-111111111111/messages?limit=50"
    );
    assert.equal(
      fetches.some((url) => /\/c($|\?)/.test(url) || /\/ca($|\?)/.test(url)),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent identical chat GETs coalesce to one network fetch", async () => {
  let fetchCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    await gate;
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
    });

    const roomId = "22222222-2222-2222-2222-222222222222";
    const p1 = chat.room.message.list(roomId, { limit: 30 });
    const p2 = chat.room.message.list(roomId, { limit: 30 });
    const p3 = chat.room.message.list(roomId, { limit: 30 });

    // Allow the first fetch to start and register siblings before release.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fetchCount, 1);
    release();

    const results = await Promise.all([p1, p2, p3]);
    assert.equal(fetchCount, 1);
    assert.equal(results.length, 3);
    for (const page of results) {
      assert.deepEqual(page.items, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P1: Key GET coalescing by the session credential", async () => {
  let fetchCount = 0;
  const seenSessionHeaders: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const headers = new Headers(init?.headers);
    seenSessionHeaders.push(headers.get("X-Athena-Auth-Session-Token") ?? "");
    await gate;
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const roomId = "33333333-3333-3333-3333-333333333333";
    const chatA = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
      sessionToken: "session-user-a",
    });
    const chatB = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
      sessionToken: "session-user-b",
    });

    const p1 = chatA.room.message.list(roomId, { limit: 20 });
    const p2 = chatB.room.message.list(roomId, { limit: 20 });

    await new Promise((resolve) => setTimeout(resolve, 15));
    // Different session tokens must not share one in-flight GET.
    assert.equal(fetchCount, 2);
    release();
    await Promise.all([p1, p2]);
    assert.equal(fetchCount, 2);
    assert.deepEqual(seenSessionHeaders.sort(), [
      "session-user-a",
      "session-user-b",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("context-scoped Chat GETs do not share an in-flight response", async () => {
  let fetchCount = 0;
  const seenOrganizationHeaders: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const headers = new Headers(init?.headers);
    seenOrganizationHeaders.push(headers.get("X-Organization-Id") ?? "");
    await gate;
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
      sessionToken: "shared-session",
    });
    const roomId = "55555555-5555-5555-5555-555555555555";

    const p1 = chat.room.message.list(
      roomId,
      { limit: 20 },
      { headers: { "X-Organization-Id": "org-a" } }
    );
    const p2 = chat.room.message.list(
      roomId,
      { limit: 20 },
      { headers: { "X-Organization-Id": "org-b" } }
    );

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(fetchCount, 2);
    release();
    await Promise.all([p1, p2]);
    assert.deepEqual(seenOrganizationHeaders.sort(), ["org-a", "org-b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("withContext organization scopes do not share an in-flight Chat GET", async () => {
  let fetchCount = 0;
  const seenOrganizationHeaders: string[] = [];
  const seenBodies: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const headers = new Headers(init?.headers);
    const organizationId = headers.get("X-Organization-Id") ?? "";
    seenOrganizationHeaders.push(organizationId);
    await gate;
    return new Response(
      JSON.stringify({
        items: [{ organization_id: organizationId }],
        next_before_seq: null,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      }
    );
  }) as typeof fetch;

  try {
    const root = createClient({
      chat: { url: "https://gateway.example.com/chat" },
      client: "demo",
      key: "test-key",
    });
    const roomId = "66666666-6666-6666-6666-666666666666";
    const chatA = root.withContext({
      organizationId: "org-a",
      sessionToken: "shared-session",
    }).chat;
    const chatB = root.withContext({
      organizationId: "org-b",
      sessionToken: "shared-session",
    }).chat;

    const p1 = chatA.room.message.list(roomId, { limit: 20 });
    const p2 = chatB.room.message.list(roomId, { limit: 20 });

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(fetchCount, 2);
    release();
    const [pageA, pageB] = await Promise.all([p1, p2]);
    seenBodies.push(String(pageA.items[0]?.organization_id ?? ""));
    seenBodies.push(String(pageB.items[0]?.organization_id ?? ""));
    assert.deepEqual(seenOrganizationHeaders.sort(), ["org-a", "org-b"]);
    assert.deepEqual(seenBodies.sort(), ["org-a", "org-b"]);
    assert.notEqual(
      pageA.items[0]?.organization_id,
      pageB.items[0]?.organization_id
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("x-athena-organization concurrent GETs do not share an in-flight response", async () => {
  let fetchCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    await gate;
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
      sessionToken: "shared-session",
    });
    const roomId = "77777777-7777-7777-7777-777777777777";
    const p1 = chat.room.message.list(
      roomId,
      { limit: 20 },
      { headers: { "x-athena-organization": "org-a" } }
    );
    const p2 = chat.room.message.list(
      roomId,
      { limit: 20 },
      { headers: { "x-athena-organization": "org-b" } }
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(fetchCount, 2);
    release();
    await Promise.all([p1, p2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote room.list forwards limit and offset on the query string", async () => {
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    return new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
    });
    await chat.room.list({ include_archived: true, limit: 7, offset: 14 });
    assert.equal(fetches.length, 1);
    const url = new URL(fetches[0] ?? "");
    assert.equal(url.pathname, "/chat/rooms");
    assert.equal(url.searchParams.get("include_archived"), "true");
    assert.equal(url.searchParams.get("limit"), "7");
    assert.equal(url.searchParams.get("offset"), "14");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P2: Preserve AbortSignal semantics when coalescing GETs", async () => {
  let fetchCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        reject(
          Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
          })
        );
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener("abort", onAbort, { once: true });
      void gate.then(() => {
        init?.signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
    return new Response(JSON.stringify({ items: [], next_before_seq: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const chat = createChatModule({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/chat",
      client: "demo",
    });
    const roomId = "44444444-4444-4444-4444-444444444444";
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const p1 = chat.room.message.list(
      roomId,
      { limit: 10 },
      { signal: controllerA.signal }
    );
    const p2 = chat.room.message.list(
      roomId,
      { limit: 10 },
      { signal: controllerB.signal }
    );

    await new Promise((resolve) => setTimeout(resolve, 15));
    // Signaled GETs must not coalesce onto a shared promise.
    assert.equal(fetchCount, 2);

    controllerA.abort();
    await assert.rejects(p1, (err: unknown) => {
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      return name === "AbortError" || /abort/i.test(String(err));
    });

    release();
    const pageB = await p2;
    assert.deepEqual(pageB.items, []);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
