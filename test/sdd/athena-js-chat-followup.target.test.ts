import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createLocalChatRuntime } from "../../src/chat/local/runtime.ts";
import { createMemoryChatStore } from "../../src/chat/local/store.ts";
import { createRemoteChatRuntime } from "../../src/chat/remote/runtime.ts";
import type {
  AthenaChatRealtimeEvent,
  AthenaChatWebSocketLike,
} from "../../src/chat/types.ts";
import { getAthenaDevtoolsProcessEventBuffer } from "../../src/devtools/buffer/index.ts";
import type { AthenaRightKey } from "../../src/rights/key.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaResolvedPrincipal } from "../../src/runtime/data/principal.ts";

const AUTH_UI_PROVIDER = join(
  process.cwd(),
  "..",
  "athena-auth-ui",
  "src",
  "components",
  "auth",
  "chat",
  "athena",
  "provider.tsx",
);
const RUST_RIGHTS_CATALOG = join(
  process.cwd(),
  "..",
  "..",
  "crates",
  "athena-rights",
  "src",
  "lib.rs",
);

function resolvedPrincipal(
  userId: string,
  rights: readonly string[],
  organizationId = "org-1",
  authority: AthenaResolvedPrincipal["authority"] = "custom-trusted",
): AthenaResolvedPrincipal {
  return {
    authority,
    principal: {
      authenticated: true,
      grants: [],
      organizationId,
      rights: rights.map(parseAthenaRightKey),
      userId,
    },
  };
}

class FakeChatSocket implements AthenaChatWebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void {
    const listeners =
      this.#listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void {
    this.#listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  emit(type: "open" | "message" | "error" | "close", data: unknown): void {
    if (type === "open") {
      this.readyState = 1;
    }
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(type === "message" ? { data: JSON.stringify(data) } : data);
    }
  }
}

test("Chat authorization uses canonical Rights while payload identity stays inert", async () => {
  let rights = ["*"];
  const runtime = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => resolvedPrincipal("user-a", rights),
    store: createMemoryChatStore(),
  });

  const room = await runtime.room.create({ kind: "group", title: "ops" });
  rights = ["chat.messages.write"];

  const sent = await runtime.room.message.send(room.data.id, {
    body_text: "hello",
    organization_id: "attacker-org",
    sender_id: "attacker",
  } as { body_text: string });

  assert.equal(sent.data.sender_id, "user-a");
  assert.equal(sent.data.room_id, room.data.id);

  rights = ["chat.rooms.read"];
  await assert.rejects(
    runtime.room.message.send(room.data.id, { body_text: "denied" }),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      (error as { status: number }).status === 403,
  );
});

test("Chat retains service authority and rejects grants or malformed Rights", async () => {
  const store = createMemoryChatStore();
  let principal = resolvedPrincipal(
    "service-worker",
    ["*"],
    "org-1",
    "service",
  );
  const runtime = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => principal,
    store,
  });

  const room = await runtime.room.create({ kind: "group" });
  assert.equal(room.data.created_by, "service-worker");

  principal = {
    ...principal,
    principal: {
      ...principal.principal,
      grants: ["role:chat-admin"],
      rights: [],
    },
  };
  await assert.rejects(
    runtime.room.message.send(room.data.id, { body_text: "grants-only" }),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      (error as { status: number }).status === 403,
  );
});

test("Rust owns the canonical Chat Right vocabulary", () => {
  const catalog = readFileSync(RUST_RIGHTS_CATALOG, "utf8");

  assert.match(catalog, /chat\.rooms\.read/);
  assert.match(catalog, /chat\.messages\.write/);
  assert.match(catalog, /source: "chat"/);
});

test("malformed Rights are rejected before Chat authorization", async () => {
  let rights: readonly string[] = ["*"];
  const runtime = createLocalChatRuntime({
    authorization: { mode: "compatibility" },
    resolvePrincipal: async () => ({
      authority: "custom-trusted" as const,
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: rights as unknown as readonly AthenaRightKey[],
        userId: "user-a",
      },
    }),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group" });
  rights = ["chat:messages.write"];

  await assert.rejects(
    runtime.room.message.send(room.data.id, { body_text: "must-deny" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      "errorNumber" in error &&
      (error as { code?: string }).code ===
      "ATHENA_CHAT_AUTHORIZATION_DENIED" &&
      (error as { errorNumber?: number }).errorNumber === 5009,
  );
});

test("durable Chat mutations share one canonical outbox event stream", async () => {
  const store = createMemoryChatStore();
  const runtime = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => resolvedPrincipal("user-a", ["*"]),
    store,
  });
  const seen: string[] = [];
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  const session = runtime.realtime.createSession({
    onEvent: (event) => {
      if ("type" in event && typeof event.type === "string") {
        seen.push(event.type);
      }
    },
  });

  session.start();
  await session.subscribe(room.data.id);
  await runtime.room.update(room.data.id, { title: "renamed" });
  await runtime.room.message.send(room.data.id, { body_text: "hello" });
  await runtime.room.message.delete(
    room.data.id,
    (await runtime.room.message.list(room.data.id)).items[0]?.id ?? "",
  );
  await runtime.room.archive(room.data.id);
  session.stop();

  assert.deepEqual(
    store.listOutbox().map((event) => event.payload.type),
    [
      "chat.room.created",
      "chat.room.updated",
      "chat.message.created",
      "chat.message.deleted",
      "chat.room.archived",
    ],
  );
  assert.deepEqual(seen, [
    "chat.room.updated",
    "chat.message.created",
    "chat.message.deleted",
    "chat.room.archived",
  ]);
});

test("Chat search cursors and delta reads remain stable and monotonic", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => resolvedPrincipal("user-a", []),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group" });
  await runtime.room.message.send(room.data.id, { body_text: "same" });
  await runtime.room.message.send(room.data.id, { body_text: "same" });
  await runtime.room.message.send(room.data.id, { body_text: "same" });

  const first = await runtime.message.search({ limit: 1, query: "same" });
  const second = await runtime.message.search({
    cursor: first.next_cursor,
    limit: 1,
    query: "same",
  });
  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0]?.message.id, second.items[0]?.message.id);

  const delta = await runtime.room.message.list(room.data.id, {
    after_seq: 1,
    limit: 10,
  });
  assert.deepEqual(
    delta.items.map((message) => message.room_seq),
    [2, 3],
  );
});

test("Chat member ownership and read cursors are enforced transactionally", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => resolvedPrincipal("user-a", []),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({
    kind: "group",
    member_user_ids: ["user-b"],
  });
  await runtime.room.member.add(room.data.id, {
    role: "owner",
    user_ids: ["user-b"],
  });
  await assert.rejects(
    runtime.room.member.remove(room.data.id, "user-a"),
    /founding owner/,
  );

  await runtime.room.message.send(room.data.id, { body_text: "one" });
  const read = await runtime.room.readCursor.upTo(room.data.id, { seq: 99 });
  assert.equal(read.last_read_seq, 1);
  const backwards = await runtime.room.readCursor.upTo(room.data.id, {
    seq: 0,
  });
  assert.equal(backwards.last_read_seq, 1);
});

test("concurrent local sends allocate a monotonic room sequence", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => resolvedPrincipal("user-a", []),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group" });
  const sent = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runtime.room.message.send(room.data.id, {
        body_text: `message-${index}`,
      }),
    ),
  );

  assert.deepEqual(
    sent.map((response) => response.data.room_seq).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("post-commit realtime publication failure does not roll back Chat state", async () => {
  const store = createMemoryChatStore();
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => resolvedPrincipal("user-a", []),
    store,
  });
  const room = await runtime.room.create({ kind: "group" });
  const connection = runtime.realtime.connect({
    onMessage: () => {
      throw new Error("subscriber unavailable");
    },
  });
  connection.subscribe(room.data.id, 0);

  await assert.rejects(
    runtime.room.message.send(room.data.id, { body_text: "committed" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "ATHENA_CHAT_PUBLICATION_FAILED",
  );
  connection.close();

  assert.equal(store.listOutbox().length, 2);
  assert.equal(
    (await runtime.room.message.list(room.data.id)).items[0]?.body_text,
    "committed",
  );
});

test("local realtime subscription checks both canonical Right and room membership", async () => {
  let rights = ["*"];
  const runtime = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => resolvedPrincipal("user-a", rights, "org-1"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group" });
  const session = runtime.realtime.createSession();
  session.start();

  rights = ["chat.rooms.write"];
  await assert.rejects(
    session.subscribe(room.data.id),
    /requires chat.rooms.read/,
  );
  session.stop();
});

test("Chat emits sanitized execution events into the shared DevTools buffer", async () => {
  const buffer = getAthenaDevtoolsProcessEventBuffer();
  buffer.clear();
  let rights = ["*"];
  const runtime = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => resolvedPrincipal("user-a", rights, "org-1"),
    store: createMemoryChatStore(),
  });

  await runtime.room.create(
    { kind: "group" },
    {
      headers: { "x-athena-trace-id": "trace-chat" },
    },
  );
  rights = ["chat.rooms.read"];
  await assert.rejects(
    runtime.room.message.send(
      "missing-room",
      { body_text: "sensitive body must not be logged" },
      { traceId: "trace-denied" },
    ),
  );

  const events = buffer.list();
  assert.ok(events.some((event) => event.domain === "chat"));
  assert.ok(events.some((event) => event.outcome === "success"));
  assert.ok(events.some((event) => event.outcome === "denied"));
  assert.ok(
    events.every(
      (event) =>
        !JSON.stringify(event).includes("sensitive body must not be logged"),
    ),
  );
});

test("remote Chat sessions own hello, reconnect, resume, and duplicate tolerance", async () => {
  const sockets: FakeChatSocket[] = [];
  const events: AthenaChatRealtimeEvent[] = [];
  const states: string[] = [];
  const gaps: string[] = [];
  const chat = createRemoteChatRuntime({
    apiKey: "test-key",
    baseUrl: "https://chat.example.test",
    webSocketFactory: (() => {
      const socket = new FakeChatSocket();
      sockets.push(socket);
      return socket;
    }) as unknown as new (
      url: string,
      protocols?: string | string[],
    ) => AthenaChatWebSocketLike,
    wsUrl: "wss://chat.example.test/wss/gateway",
  });
  const session = chat.realtime.createSession({
    onEvent: (event) => events.push(event),
    onStateChange: (state) => states.push(state),
    onSyncRequired: ({ reason }) => gaps.push(reason),
    reconnect: { baseDelayMs: 60_000, jitter: 0 },
  });

  session.start();
  assert.equal(sockets.length, 1);
  sockets[0]?.emit("open", {});
  await session.subscribe("room-1", { afterSeq: 0 });
  const message = {
    event_id: "event-1",
    room_id: "room-1",
    room_seq: 1,
    type: "chat.message.created",
  };
  sockets[0]?.emit("message", message);
  sockets[0]?.emit("message", message);
  sockets[0]?.emit("message", {
    event_id: "event-2",
    room_id: "room-1",
    room_seq: 3,
    type: "chat.message.created",
  });
  sockets[0]?.close();

  assert.equal(events.length, 2);
  assert.deepEqual(gaps, ["sequence_gap"]);
  assert.equal(session.state, "reconnecting");
  assert.ok(
    sockets[0]?.sent.some((value) => JSON.parse(value).type === "auth.hello"),
  );
  session.stop();
  assert.equal(session.state, "closed");
  assert.ok(states.includes("connected"));
});

test("Auth UI consumes the transport-neutral Chat session instead of raw lifecycle", () => {
  const provider = readFileSync(AUTH_UI_PROVIDER, "utf8");

  assert.match(provider, /\.createSession\(/);
  assert.doesNotMatch(provider, /\.realtime\.connect\(/);
  assert.doesNotMatch(provider, /\.hello\(\)/);
});

test("Chat errors are owned by chat/error.ts, not the remote runtime", () => {
  const moduleSource = readFileSync(
    join(process.cwd(), "src/chat/module.ts"),
    "utf8",
  );
  const localErrors = readFileSync(
    join(process.cwd(), "src/chat/local/errors.ts"),
    "utf8",
  );
  const mutation = readFileSync(
    join(process.cwd(), "src/chat/local/mutation.ts"),
    "utf8",
  );
  const remote = readFileSync(
    join(process.cwd(), "src/chat/remote/runtime.ts"),
    "utf8",
  );

  assert.match(moduleSource, /from ["']\.\/error\.ts["']/);
  assert.match(localErrors, /from ["']\.\.\/error\.ts["']/);
  assert.match(mutation, /from ["']\.\.\/error\.ts["']/);
  assert.doesNotMatch(localErrors, /from ["']\.\.\/module\.ts["']/);
  assert.match(remote, /from ["']\.\.\/error\.ts["']/);
  assert.doesNotMatch(remote, /export class AthenaChatError/);
});

test("omitted Chat authorization mode stays compatibility; enforce is explicit", async () => {
  const store = createMemoryChatStore();
  const compatible = createLocalChatRuntime({
    resolvePrincipal: async () => resolvedPrincipal("user-a", []),
    store,
  });
  const room = await compatible.room.create({ kind: "group" });
  assert.ok(room.data.id);

  const enforced = createLocalChatRuntime({
    authorization: { mode: "enforce" },
    resolvePrincipal: async () => resolvedPrincipal("user-b", []),
    store: createMemoryChatStore(),
  });
  await assert.rejects(
    enforced.room.create({ kind: "group" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ATHENA_CHAT_AUTHORIZATION_DENIED",
  );
});
