import assert from "node:assert/strict";
import test from "node:test";
import type { AthenaChatDatabase } from "../src/chat/local/database.ts";
import { createPostgresChatStore } from "../src/chat/local/postgres-store.ts";

const actor = {
  organizationId: "org-1",
  traceId: "trace-1",
  userId: "user-1",
};

const messageRows = [
  {
    body_json: null,
    body_text: "one",
    client_message_id: null,
    created_at: "2026-01-01T00:00:01.000Z",
    deleted_at: null,
    edited_at: null,
    id: "11111111-1111-1111-1111-111111111111",
    metadata_json: null,
    reply_to_message_id: null,
    room_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    room_seq: 1,
    sender_id: "user-1",
  },
  {
    body_json: null,
    body_text: "two",
    client_message_id: null,
    created_at: "2026-01-01T00:00:02.000Z",
    deleted_at: null,
    edited_at: null,
    id: "22222222-2222-2222-2222-222222222222",
    metadata_json: null,
    reply_to_message_id: null,
    room_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    room_seq: 2,
    sender_id: "user-1",
  },
];

test("Postgres message listing hydrates attachments and reactions in batches", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const database: AthenaChatDatabase = {
    async close() {},
    ownership: "borrowed",
    async query<TRow>(text: string, values: unknown[] = []) {
      queries.push({ text, values });

      if (text.includes("FROM athena.chat_rooms AS r")) {
        return {
          rows: [
            {
              archived_at: null,
              hidden_at: null,
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              joined_at: "2026-01-01T00:00:00.000Z",
              last_message_seq: 2,
              last_read_message_id: null,
              last_read_seq: 0,
              muted: false,
              notification_mode: null,
              organization_id: "org-1",
              role: "member",
              room_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              user_id: "user-1",
            },
          ] as TRow[],
        };
      }
      if (text.includes("FROM athena.chat_messages")) {
        return { rows: messageRows as TRow[] };
      }
      if (text.includes("FROM athena.chat_message_attachments")) {
        const messageIds = Array.isArray(values[0])
          ? values[0].map(String)
          : [String(values[0])];
        return {
          rows: [
            {
              bucket: "bucket",
              content_type: "text/plain",
              extension: "txt",
              file_id: "file-1",
              file_name: "one.txt",
              message_id: "11111111-1111-1111-1111-111111111111",
              mime_type: "text/plain",
              ordinal: 0,
              original_name: "one.txt",
              size_bytes: 3,
              status: "ready",
              storage_key: "one.txt",
              url: null,
              visibility: "private",
            },
          ].filter((row) => messageIds.includes(row.message_id)) as TRow[],
        };
      }
      if (text.includes("FROM athena.chat_message_reactions")) {
        const messageIds = Array.isArray(values[0])
          ? values[0].map(String)
          : [String(values[0])];
        return {
          rows: [
            {
              count: 2,
              emoji: "👍",
              message_id: "22222222-2222-2222-2222-222222222222",
              reacted: true,
            },
          ].filter((row) => messageIds.includes(row.message_id)) as TRow[],
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
    async transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>) {
      return fn(database);
    },
  };

  const page = await createPostgresChatStore(database).listMessages(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    actor
  );

  assert.equal(queries.length, 4);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[1]?.attachments[0]?.file_id, "file-1");
  assert.deepEqual(page.items[0]?.reactions, [
    { count: 2, emoji: "👍", reacted: true },
  ]);
});

test("Postgres room listing sends the normalized pagination window to SQL", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const database: AthenaChatDatabase = {
    async close() {},
    ownership: "borrowed",
    async query<TRow>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      return { rows: [{} as TRow] };
    },
    async transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>) {
      return fn(database);
    },
  };

  await createPostgresChatStore(database).listRooms(actor, {
    include_archived: true,
    limit: 3,
    offset: 4,
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0]?.text ?? "", /LIMIT \$4 OFFSET \$5/);
  assert.deepEqual(queries[0]?.values, ["org-1", "user-1", true, 3, 4]);
});

test("Postgres message listing SQL count stays constant as page size grows", async () => {
  for (const pageSize of [1, 10, 50, 100]) {
    const queries: Array<{ text: string }> = [];
    const rows = Array.from({ length: pageSize }, (_, index) => ({
      ...messageRows[0],
      body_text: `msg-${index}`,
      id: `${String(index + 1).padStart(8, "1")}-1111-1111-1111-111111111111`,
      room_seq: index + 1,
    }));
    const database: AthenaChatDatabase = {
      async close() {},
      ownership: "borrowed",
      async query<TRow>(text: string) {
        queries.push({ text });
        if (text.includes("FROM athena.chat_rooms AS r")) {
          return {
            rows: [
              {
                organization_id: "org-1",
                user_id: "user-1",
                hidden_at: null,
              },
            ] as TRow[],
          };
        }
        if (text.includes("FROM athena.chat_messages")) {
          return { rows: rows as TRow[] };
        }
        if (text.includes("ANY($1::uuid[])")) {
          return { rows: [] as TRow[] };
        }
        throw new Error(`Unexpected SQL: ${text}`);
      },
      async transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>) {
        return fn(database);
      },
    };

    await createPostgresChatStore(database).listMessages(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      actor,
      { limit: pageSize }
    );

    assert.equal(queries.length, 4, `pageSize=${pageSize}`);
    assert.equal(
      queries.filter((query) => query.text.includes("ANY($1::uuid[])")).length,
      2
    );
  }
});

test("Postgres search hydrates attachments and reactions in batches", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const database: AthenaChatDatabase = {
    async close() {},
    ownership: "borrowed",
    async query<TRow>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("ILIKE")) {
        return { rows: messageRows as TRow[] };
      }
      if (text.includes("ANY($1::uuid[])")) {
        return { rows: [] as TRow[] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
    async transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>) {
      return fn(database);
    },
  };

  const page = await createPostgresChatStore(database).search(actor, {
    query: "one",
  });

  assert.equal(queries.length, 3);
  assert.equal(page.items.length, 2);
  assert.equal(
    queries.filter((query) => query.text.includes("ANY($1::uuid[])")).length,
    2
  );
});
