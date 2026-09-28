/**
 * Embedded Chat target — GREEN after P0 Phases 1–6.
 * See docs/sdd/xylex/athena-js-embedded-chat/SPEC.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveChatMode } from "../../src/chat/config.ts";
import type { AthenaChatDatabase } from "../../src/chat/local/database.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { createRootChatPrincipalResolver } from "../../src/chat/local/principal.ts";
import { createLocalChatRuntime } from "../../src/chat/local/runtime.ts";
import { createMemoryChatStore } from "../../src/chat/local/store.ts";
import {
  ATHENA_CHAT_RUNTIME_SCHEMA_COMPONENT,
  ATHENA_CHAT_RUNTIME_SCHEMA_VERSION,
} from "../../src/chat/schema-version.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { checksumMigrationSql } from "../../src/migrations/checksum.ts";
import { EMBEDDED_CHAT_MIGRATIONS } from "../../src/migrations/embedded-chat/catalog.ts";
import { shouldApplyEmbeddedChatMigrations } from "../../src/migrations/embedded-chat/enablement.ts";
import {
  getBoundPostgresRuntime,
} from "../../src/postgres/owned-runtime.ts";
import type { AthenaResolvedPrincipal } from "../../src/runtime/data/principal.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTs(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTs(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".sql")) {
      out.push(full);
    }
  }
  return out;
}

function principal(
  userId: string,
  organizationId = "org_1"
): AthenaResolvedPrincipal {
  return {
    authority: "custom-trusted",
    principal: {
      authenticated: true,
      grants: [],
      organizationId,
      rights: [],
      userId,
    },
  };
}

test("T-CHAT-RUNTIME: façade does not fetch; remote runtime owns HTTP", () => {
  assert.doesNotMatch(readSrc("chat/module.ts"), /\bfetch\s*\(/);
  assert.match(
    readSrc("chat/runtime.ts"),
    /export type AthenaChatRuntime = AthenaChatModule/
  );
  assert.match(
    readSrc("chat/remote/runtime.ts"),
    /export function createRemoteChatRuntime/
  );
});

test("T-CHAT-MODE: resolveChatMode matches Auth vocabulary", () => {
  assert.equal(resolveChatMode({ chat: undefined }), "disabled");
  assert.equal(resolveChatMode({ chat: false }), "disabled");
  assert.equal(
    resolveChatMode({ chat: true, databaseUrl: "postgres://local" }),
    "local"
  );
  assert.equal(
    resolveChatMode({ chat: { url: "https://chat.example.test" } }),
    "remote"
  );
  assert.throws(
    () =>
      resolveChatMode({
        chat: { mode: "local", url: "https://chat.example.test" },
      }),
    AthenaConfigurationError
  );
  assert.throws(
    () =>
      resolveChatMode({
        chat: { mode: "disabled" as "local" },
        databaseUrl: "postgres://local",
      }),
    AthenaConfigurationError
  );
  assert.throws(
    () => resolveChatMode({ chat: { mode: "local" } }),
    AthenaConfigurationError
  );
  assert.throws(
    () => resolveChatMode({ chat: true }),
    AthenaConfigurationError
  );
});

test("T-CHAT-LOCAL-MODE: createClient({ databaseUrl, chat: true }) plants local runtime", () => {
  const chatMaterializer = readSrc("runtime/materializers/chat.ts");
  assert.match(chatMaterializer, /createLocalChatRuntime/);
  assert.match(chatMaterializer, /createChatDatabaseFromRuntime/);
  const client = createClient({
    chat: true,
    chatRuntime: createLocalChatRuntime({
      resolvePrincipal: async () => principal("user_a"),
      store: createMemoryChatStore(),
    }),
    databaseUrl: "postgres://unused",
    key: "pk_test_embedded_chat",
  });
  assert.equal(typeof client.chat.room.create, "function");
  assert.equal(typeof client.chat.realtime.connect, "function");
});

test("T-CHAT-HYBRID: local Chat binds an unbound gateway transport to PostgreSQL", async () => {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  const gatewayTransport: AthenaGatewayClient = {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
  const client = createClient({
    chat: true,
    databaseUrl: "postgres://unused",
    gatewayTransport,
    key: "pk_test_embedded_chat",
  });
  assert.equal(typeof client.chat.room.create, "function");
  const postgresRuntime = getAthenaClientInternals(client)?.postgresRuntime;
  assert.ok(postgresRuntime);
  assert.equal(getBoundPostgresRuntime(gatewayTransport), postgresRuntime);
  await client.close();
});

test("T-CHAT-INJECTED: a pre-planted Chat runtime is reused", () => {
  const injected = createLocalChatRuntime({
    resolvePrincipal: async () => principal("injected-user"),
    store: createMemoryChatStore(),
  });
  const client = createClient({
    chat: true,
    chatRuntime: injected,
    databaseUrl: "postgres://unused",
    key: "pk_test_embedded_chat",
  });
  assert.equal(client.chat.room.create, injected.room.create);
  assert.equal(client.chat.realtime.connect, injected.realtime.connect);
});

test("T-CHAT-BORROW: local Chat database never creates a pool", () => {
  const source = readSrc("chat/local/database.ts");
  assert.doesNotMatch(source, /createPostgresPool\(/);
  assert.match(source, /ownership: "borrowed"/);
  assert.match(source, /async close\(\)/);
});

test("T-CHAT-PRINCIPAL: INV-CHAT-011 payload cannot override sender", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  const sent = await runtime.room.message.send(room.data.id, {
    body_text: "hello",
    sender_id: "attacker",
  } as { body_text: string });
  assert.equal(sent.data.sender_id, "user_a");
});

test("T-CHAT-IDEMPOTENCY: client_message_id replay returns the same message", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  const first = await runtime.room.message.send(room.data.id, {
    body_text: "once",
    client_message_id: "cmi_1",
  });
  const second = await runtime.room.message.send(room.data.id, {
    body_text: "once",
    client_message_id: "cmi_1",
  });
  assert.equal(first.data.id, second.data.id);
  assert.equal(first.data.room_seq, second.data.room_seq);
});

test("T-CHAT-DIRECT: resolveDirect is canonical for the same pair", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const first = await runtime.room.resolveDirect({
    participant_user_ids: ["user_a", "user_b"],
  });
  const second = await runtime.room.resolveDirect({
    participant_user_ids: ["user_b", "user_a"],
  });
  assert.equal(first.id, second.id);
  assert.equal(first.kind, "dm");
});

test("T-CHAT-SEARCH: local search is case-insensitive contains (ILIKE)", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  await runtime.room.message.send(room.data.id, { body_text: "Deploy Window" });
  const hits = await runtime.message.search({ query: "deploy" });
  assert.equal(hits.items.length, 1);
  assert.equal(hits.items[0]?.message.body_text, "Deploy Window");
});

test("T-CHAT-REALTIME-P0: subscribe receives in-process created events", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  const seen: string[] = [];
  const connection = runtime.realtime.connect({
    onMessage(event) {
      const record = event as { type?: string };
      if (record.type) {
        seen.push(record.type);
      }
    },
  });
  connection.subscribe(room.data.id, 0);
  await runtime.room.message.send(room.data.id, { body_text: "ping" });
  assert.ok(seen.includes("chat.message.created"));
  connection.close();
});

test("T-CHAT-CAPABILITIES: local realtime is honest and not interchangeable with remote", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  assert.equal(runtime.capabilities.transport, "local");
  assert.equal(runtime.capabilities.realtime.messages, true);
  assert.equal(runtime.capabilities.realtime.messageUpdates, true);
  assert.equal(runtime.capabilities.realtime.websocket, false);
  assert.equal(runtime.capabilities.realtime.typing, false);
  assert.equal(runtime.capabilities.realtime.presence, false);
  assert.equal(runtime.capabilities.realtime.replayPersisted, false);
  assert.equal(runtime.capabilities.realtime.crossProcess, false);
  const connection = runtime.realtime.connect();
  assert.throws(() => connection.typingStart("room_1"), {
    name: "AthenaChatError",
  });
  assert.throws(() => connection.presenceHeartbeat(), {
    name: "AthenaChatError",
  });
  assert.throws(() => connection.hello(), { name: "AthenaChatError" });
  connection.close();
});

test("T-CHAT-RESUME-LIVE: resume attaches a live cursor and does not replay", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user_a"),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  await runtime.room.message.send(room.data.id, { body_text: "before" });
  const seen: string[] = [];
  const connection = runtime.realtime.connect({
    onMessage(event) {
      const record = event as { message?: { body_text?: string } };
      if (record.message?.body_text) {
        seen.push(record.message.body_text);
      }
    },
  });
  connection.resume([{ last_seq: 0, room_id: room.data.id }]);
  await runtime.room.message.send(room.data.id, { body_text: "after" });
  assert.deepEqual(seen, ["after"]);
  connection.close();
});

test("T-CHAT-MIGRATE: modules.chat === true is the only migrate enablement", () => {
  assert.equal(shouldApplyEmbeddedChatMigrations(undefined), false);
  assert.equal(shouldApplyEmbeddedChatMigrations({ chat: false }), false);
  assert.equal(shouldApplyEmbeddedChatMigrations({ chat: true }), true);
  const runner = readSrc("migrations/runner.ts");
  assert.match(runner, /applyEmbeddedChatMigrations/);
  assert.match(runner, /config\.modules/);
  assert.doesNotMatch(runner, /createClient\(\s*\{\s*databaseUrl/);
  const apply = readSrc("migrations/embedded-chat/apply.ts");
  assert.doesNotMatch(apply, /fileURLToPath/);
  assert.doesNotMatch(apply, /readFile/);
  assert.match(apply, /applyEmbeddedSqlMigrations/);
  assert.match(readSrc("migrations/embedded-sql-apply.ts"), /to_regclass/);
  assert.match(readSrc("migrations/embedded-sql-apply.ts"), /BEGIN/);
  assert.doesNotMatch(readSrc("migrations/embedded-sql-apply.ts"), /42P01/);
  assert.ok(
    existsSync(join(srcRoot, "migrations", "embedded-chat", "apply.ts"))
  );
  assert.ok(collectTs(join(srcRoot, "migrations", "embedded-chat")).length > 0);
});

test("T-CHAT-PLANT-POSTGRES: production plant uses borrowed Postgres, not Memory", () => {
  const clientSource = readSrc("v3-client.ts");
  const chatMaterializer = readSrc("runtime/materializers/chat.ts");
  const runtimeSource = readSrc("chat/local/runtime.ts");
  assert.doesNotMatch(clientSource, /createMemoryChatStore/);
  assert.doesNotMatch(chatMaterializer, /createMemoryChatStore/);
  assert.match(chatMaterializer, /createRootChatPrincipalResolver/);
  assert.match(chatMaterializer, /createChatDatabaseFromRuntime/);
  assert.match(runtimeSource, /createPostgresChatStore/);
  assert.match(runtimeSource, /ATHENA_CHAT_LOCAL_DATABASE_REQUIRED/);
  assert.doesNotMatch(runtimeSource, /createMemoryChatStore/);
  const sql = readSrc("migrations/embedded-chat/sql/0001_chat_runtime_v4.sql");
  assert.match(sql, /athena\.chat_rooms/);
  assert.match(sql, /athena\.chat_direct_rooms/);
  assert.match(sql, /athena\.chat_message_attachments/);
  assert.match(sql, /athena\.chat_outbox/);
});

test("T-CHAT-SCHEMA-VERSION: JS catalog and Rust heal share runtime version 4", () => {
  assert.equal(ATHENA_CHAT_RUNTIME_SCHEMA_VERSION, 4);
  assert.equal(ATHENA_CHAT_RUNTIME_SCHEMA_COMPONENT, "chat_runtime");
  const sql = readSrc("migrations/embedded-chat/sql/0001_chat_runtime_v4.sql");
  assert.equal(
    EMBEDDED_CHAT_MIGRATIONS[0]?.checksum,
    checksumMigrationSql(sql)
  );
  assert.equal(EMBEDDED_CHAT_MIGRATIONS[0]?.sql, sql);
  const rust = readFileSync(
    join(pkgRoot, "..", "..", "crates", "athena-chat", "src", "schema.rs"),
    "utf8"
  );
  assert.match(
    rust,
    new RegExp(
      `pub const CHAT_RUNTIME_SCHEMA_VERSION: i32 = ${ATHENA_CHAT_RUNTIME_SCHEMA_VERSION};`
    )
  );
  assert.match(
    sql,
    new RegExp(
      `VALUES \\('${ATHENA_CHAT_RUNTIME_SCHEMA_COMPONENT}', ${ATHENA_CHAT_RUNTIME_SCHEMA_VERSION}, now\\(\\)\\)`
    )
  );
});

test("T-CHAT-PRINCIPAL-CONTEXT: root context supplies actor identity", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: createRootChatPrincipalResolver({
      context: { organizationId: "org_ctx", userId: "user_ctx" },
    }),
    store: createMemoryChatStore(),
  });
  const room = await runtime.room.create({ kind: "group", title: "ops" });
  assert.equal(room.data.created_by, "user_ctx");
  assert.equal(room.data.organization_id, "org_ctx");
});

test("T-CHAT-POSTGRES-STORE: createRoom writes athena.chat_rooms", async () => {
  const statements: string[] = [];
  const database: AthenaChatDatabase = {
    async close() {},
    ownership: "borrowed",
    async query(text) {
      statements.push(text);
      return { rows: [] };
    },
    async transaction(fn) {
      return fn(database);
    },
  };
  const runtime = createLocalChatRuntime({
    database,
    resolvePrincipal: async () => principal("user_a"),
  });
  await runtime.room.create({ kind: "group", title: "ops" });
  assert.ok(
    statements.some((sql) => /INSERT INTO athena\.chat_rooms/i.test(sql))
  );
  assert.ok(
    statements.some((sql) => /INSERT INTO athena\.chat_room_members/i.test(sql))
  );
});

test("T-CHAT-ADAPTER: FromClient is exported and uses client.chat", () => {
  const adapterClient = readFileSync(
    join(pkgRoot, "..", "chat-adapter-athena", "src", "client.ts"),
    "utf8"
  );
  const adapterIndex = readFileSync(
    join(pkgRoot, "..", "chat-adapter-athena", "src", "index.ts"),
    "utf8"
  );
  assert.match(adapterClient, /export function createAthenaAdapterFromClient/);
  assert.match(adapterIndex, /createAthenaAdapterFromClient/);
  assert.match(adapterClient, /createAthenaAdapterFromUrl/);
});

const LIVE_URI = (
  process.env.ATHENA_PG_DIRECT_URI ??
  process.env.DATABASE_URL ??
  ""
).trim();

test("T-CHAT-LIVE-PG: createClient({ databaseUrl, chat: true }) persists to athena.chat_*", {
  skip: !LIVE_URI,
}, async () => {
  const { createPostgresPool } = await import("../../src/postgres/driver.ts");
  const sql = readSrc("migrations/embedded-chat/sql/0001_chat_runtime_v4.sql");
  const pool = await createPostgresPool(LIVE_URI, { max: 2, min: 0 });
  try {
    await pool.query(sql);
    const client = createClient({
      chat: true,
      context: { organizationId: "org_live", userId: "user_live" },
      databaseUrl: LIVE_URI,
      key: "pk_test_embedded_chat",
    });
    const room = await client.chat.room.create({
      kind: "group",
      title: "live-ops",
    });
    const sent = await client.chat.room.message.send(room.data.id, {
      body_text: "from-pg",
    });
    assert.equal(sent.data.sender_id, "user_live");
    assert.equal(sent.data.room_seq, 1);
    const listed = await client.chat.room.message.list(room.data.id);
    assert.equal(
      listed.items.some((item) => item.body_text === "from-pg"),
      true
    );
  } finally {
    await pool.end();
  }
});
