import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { resolveGeneratorProvider } from "../src/generator/index.ts";
import {
  type AthenaSchemaSnapshot,
  type SchemaColumn,
  type SchemaDiffOperation,
  diffSchemas,
  normalizeDefaultExpression,
  parseSchemaTypeString,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
} from "../src/schema/diff/index.ts";
import { defineModel } from "../src/schema/definitions.ts";
import type { IntrospectionSnapshot } from "../src/schema/types.ts";

test("P1: Export schema-diff APIs from the package root", async () => {
  const root = await import("../src/index.ts");
  assert.equal(typeof root.diffSchemas, "function");
  assert.equal(typeof root.schemaSnapshotFromModels, "function");
  assert.equal(typeof root.schemaSnapshotFromIntrospection, "function");
  assert.equal(typeof root.normalizeSchemaSnapshot, "function");
  const browser = await import("../src/browser.ts");
  assert.equal(typeof browser.diffSchemas, "function");
  assert.equal(typeof browser.schemaSnapshotFromModels, "function");
  assert.equal(typeof browser.schemaSnapshotFromIntrospection, "function");
});

test("P1: Represent generated serial keys using their emitted schema", () => {
  const users = defineModel({
    meta: {
      schema: "public",
      model: "users",
      primaryKey: ["id"],
      columns: {
        id: {
          kind: "number",
          columnName: "id",
          isGenerated: true,
          nullable: false,
        },
        email: { kind: "string", columnName: "email" },
      },
    },
  });

  const desired = schemaSnapshotFromModels(users);

  // PostgreSQL BIGSERIAL introspects as bigint + nextval(...) with attgenerated=false
  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "db",
    generatedAt: "2020-01-01T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          users: {
            schema: "public",
            name: "users",
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "bigint",
                defaultExpression: "nextval('users_id_seq'::regclass)",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "int8",
              },
              email: {
                arrayDimensions: 0,
                dataType: "text",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "email",
                typeKind: "scalar",
                udtName: "text",
              },
            },
            primaryKey: ["id"],
            relations: {},
          },
        },
      },
    },
  };

  const actual = schemaSnapshotFromIntrospection(intro);
  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(
    diff.isEmpty,
    true,
    `expected empty diff for BIGSERIAL model vs introspected DB, got: ${JSON.stringify(diff.operations)}`
  );
});

test("P1: Align model enum snapshots with CHECK-backed DDL", () => {
  const users = defineModel({
    meta: {
      schema: "public",
      model: "users",
      primaryKey: ["id"],
      columns: {
        id: { kind: "string", columnName: "id" },
        status: {
          kind: "enumeration",
          columnName: "status",
          enumValues: ["active", "inactive"],
        },
      },
    },
  });

  const desired = schemaSnapshotFromModels(users);
  const statusCol = desired.schemas
    .flatMap((s) => s.tables)
    .flatMap((t) => t.columns)
    .find((c) => c.name === "status");
  assert.ok(statusCol);
  assert.equal(statusCol?.type.name, "text");
  assert.equal(
    statusCol?.type.enumValues,
    null,
    "model enums are CHECK-backed TEXT, not pg_enum labels"
  );

  // DB created from modelsToSql: TEXT + CHECK, no pg_enum
  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "db",
    generatedAt: "2020-01-01T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          users: {
            schema: "public",
            name: "users",
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "text",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "text",
              },
              status: {
                arrayDimensions: 0,
                dataType: "text",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "status",
                typeKind: "scalar",
                udtName: "text",
              },
            },
            primaryKey: ["id"],
            relations: {},
          },
        },
      },
    },
  };

  const actual = schemaSnapshotFromIntrospection(intro);
  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(
    diff.isEmpty,
    true,
    `expected empty enum/CHECK alignment, got: ${JSON.stringify(diff.operations)}`
  );
});

test("P2: Include enum-label changes in the type delta", () => {
  const make = (enumValues: string[] | null): AthenaSchemaSnapshot => ({
    version: 1,
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "t",
            columns: [
              {
                name: "status",
                type: {
                  ...parseSchemaTypeString("text", 0),
                  enumValues,
                },
                nullable: false,
                default: null,
                isGenerated: false,
              } satisfies SchemaColumn,
            ],
            primaryKey: { name: null, columns: ["status"] },
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
    ],
  });

  const from = make(["a", "b"]);
  const to = make(["a", "b", "c"]);
  const diff = diffSchemas({ from, to });
  const alter = diff.operations.find(
    (op): op is Extract<SchemaDiffOperation, { kind: "alter_column" }> =>
      op.kind === "alter_column"
  );
  assert.ok(alter, "expected alter_column for enum label change");
  assert.ok(
    alter.changes.type,
    "enum-label-only change must populate changes.type"
  );
  assert.deepEqual(alter.changes.type?.from.enumValues, ["a", "b"]);
  assert.deepEqual(alter.changes.type?.to.enumValues, ["a", "b", "c"]);
});

test("P2: Execute the new catalog queries in gateway mode", async () => {
  const calls: { query: string }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    calls.push({ query: payload.query });
    const sqlText = payload.query;

    if (sqlText.includes("FROM pg_attribute")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              array_dimensions: 0,
              column_name: "id",
              data_type: "uuid",
              has_default: false,
              is_generated: false,
              is_nullable: false,
              schema_name: "public",
              table_name: "users",
              type_kind_code: "b",
              type_oid: 1,
              udt_name: "uuid",
            },
            {
              array_dimensions: 0,
              column_name: "email",
              data_type: "text",
              has_default: false,
              is_generated: false,
              is_nullable: false,
              schema_name: "public",
              table_name: "users",
              type_kind_code: "b",
              type_oid: 2,
              udt_name: "text",
            },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }
    if (sqlText.includes("FROM pg_type t") && sqlText.includes("JOIN pg_enum")) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }
    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return new Response(
        JSON.stringify({
          data: [
            { columns: ["id"], schema_name: "public", table_name: "users" },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }
    if (sqlText.includes("WHERE con.contype = 'f'")) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }
    if (sqlText.includes("WHERE con.contype = 'u'")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              columns: ["email"],
              constraint_name: "users_email_key",
              schema_name: "public",
              table_name: "users",
            },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }
    if (
      sqlText.includes("FROM pg_index") ||
      sqlText.includes("pg_get_indexdef") ||
      (sqlText.includes("pg_class") && sqlText.includes("relkind = 'i'")) ||
      sqlText.includes("AS index_name")
    ) {
      return new Response(
        JSON.stringify({
          data: [
            {
              columns: ["email"],
              index_name: "users_email_idx",
              is_unique: false,
              method: "btree",
              predicate: null,
              schema_name: "public",
              table_name: "users",
            },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        error: `Unexpected SQL: ${sqlText.slice(0, 120)}`,
      }),
      { status: 400 }
    );
  };

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect({ schemas: ["public"] });
    const table = snapshot.schemas.public.tables.users;

    assert.ok(
      calls.some((c) => c.query.includes("WHERE con.contype = 'u'")),
      "gateway mode must execute unique-constraint catalog query"
    );
    assert.ok(
      calls.some(
        (c) =>
          c.query.includes("AS index_name") ||
          c.query.includes("pg_index") ||
          c.query.includes("pg_get_indexdef")
      ),
      "gateway mode must execute index catalog query"
    );
    assert.ok(
      (table.uniqueConstraints ?? []).some((u) =>
        u.columns.includes("email")
      ),
      "unique constraints must be assembled in gateway mode"
    );
    assert.ok(
      (table.indexes ?? []).some((i) => i.name === "users_email_idx"),
      "indexes must be assembled in gateway mode"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("P2: Keep statement timestamps distinct from transaction timestamps", () => {
  // statement_timestamp() is statement-start; now()/CURRENT_TIMESTAMP are
  // transaction-start. Long multi-statement txns can store different values.
  const statement = normalizeDefaultExpression("statement_timestamp()");
  const now = normalizeDefaultExpression("now()");
  const currentTs = normalizeDefaultExpression("CURRENT_TIMESTAMP");
  const transaction = normalizeDefaultExpression("transaction_timestamp()");

  assert.equal(now, "now()");
  assert.equal(currentTs, "now()");
  assert.equal(transaction, "now()");
  assert.equal(
    statement,
    "statement_timestamp()",
    "statement_timestamp() must not collapse to now()"
  );
  assert.notEqual(
    statement,
    now,
    "statement vs transaction timestamps must remain distinct after normalize"
  );

  const make = (defaultExpr: string): AthenaSchemaSnapshot => ({
    version: 1,
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "events",
            columns: [
              {
                name: "created_at",
                type: parseSchemaTypeString("timestamptz", 0),
                nullable: false,
                default: defaultExpr,
                isGenerated: false,
              } satisfies SchemaColumn,
            ],
            primaryKey: null,
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
    ],
  });

  const diff = diffSchemas({
    from: make("now()"),
    to: make("statement_timestamp()"),
  });
  assert.equal(
    diff.isEmpty,
    false,
    "default change now() → statement_timestamp() must surface in the diff"
  );
  assert.ok(
    diff.operations.some((op) => op.kind === "alter_column"),
    "expected alter_column for statement vs transaction timestamp default"
  );
});

test("P2: Preserve descending index directions during introspection", () => {
  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "db",
    generatedAt: "2020-01-01T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          events: {
            schema: "public",
            name: "events",
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "text",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "text",
              },
              created_at: {
                arrayDimensions: 0,
                dataType: "timestamp with time zone",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "created_at",
                typeKind: "scalar",
                udtName: "timestamptz",
              },
            },
            primaryKey: ["id"],
            relations: {},
            indexes: [
              {
                name: "events_created_at_desc_idx",
                unique: false,
                columns: ["created_at"],
                columnDirections: ["desc"],
                method: "btree",
                predicate: null,
              },
            ],
          },
        },
      },
    },
  };

  const actual = schemaSnapshotFromIntrospection(intro);
  const table = actual.schemas
    .flatMap((s) => s.tables)
    .find((t) => t.name === "events");
  assert.ok(table, "events table present");
  const idx = table?.indexes.find(
    (i) => i.name === "events_created_at_desc_idx"
  );
  assert.ok(idx, "descending index present on snapshot");
  assert.equal(
    idx?.columns[0]?.direction,
    "desc",
    "DESC key from introspection must not be forced to asc"
  );

  // Desired ascending index must not be treated as structurally identical
  const desired: AthenaSchemaSnapshot = {
    version: 1,
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "events",
            columns: table!.columns.map((c) => ({ ...c, type: { ...c.type } })),
            primaryKey: table!.primaryKey
              ? { name: null, columns: [...table!.primaryKey.columns] }
              : null,
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [
              {
                name: "events_created_at_desc_idx",
                unique: false,
                predicate: null,
                method: "btree",
                columns: [{ name: "created_at", direction: "asc" }],
              },
            ],
          },
        ],
      },
    ],
  };

  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(
    diff.isEmpty,
    false,
    "DESC actual vs ASC desired must not collapse to empty structural identity"
  );
});
