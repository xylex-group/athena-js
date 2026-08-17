import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type SchemaColumn,
  type SchemaDiffOperation,
  type SchemaTable,
  SchemaDiffError,
  columnsEqual,
  diffSchemas,
  emptySchemaSnapshot,
  normalizeDefaultExpression,
  normalizeSchemaSnapshot,
  parseSchemaTypeString,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  validateSchemaSnapshot,
} from "../src/schema/diff/index.ts";
import { defineModel } from "../src/schema/definitions.ts";
import type { IntrospectionSnapshot } from "../src/schema/types.ts";

function col(
  name: string,
  typeName: string,
  opts: Partial<SchemaColumn> = {}
): SchemaColumn {
  return {
    name,
    type: parseSchemaTypeString(typeName, 0),
    nullable: opts.nullable ?? false,
    default: opts.default ?? null,
    isGenerated: opts.isGenerated ?? false,
  };
}

function table(
  schema: string,
  name: string,
  columns: SchemaColumn[],
  extras: Partial<SchemaTable> = {}
): SchemaTable {
  const hasId = columns.some((c) => c.name === "id");
  const defaultPk =
    extras.primaryKey !== undefined
      ? extras.primaryKey
      : hasId
        ? { name: null, columns: ["id"] }
        : columns[0]
          ? { name: null, columns: [columns[0].name] }
          : null;
  return {
    schema,
    name,
    columns,
    primaryKey: defaultPk,
    uniqueConstraints: extras.uniqueConstraints ?? [],
    foreignKeys: extras.foreignKeys ?? [],
    indexes: extras.indexes ?? [],
  };
}

function snap(
  tables: SchemaTable[],
  backend: string | null = "postgresql"
): AthenaSchemaSnapshot {
  const bySchema = new Map<string, SchemaTable[]>();
  for (const t of tables) {
    const list = bySchema.get(t.schema) ?? [];
    list.push(t);
    bySchema.set(t.schema, list);
  }
  return normalizeSchemaSnapshot({
    version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
    backend,
    schemas: [...bySchema.entries()].map(([schemaName, schemaTables]) => ({
      name: schemaName,
      tables: schemaTables,
    })),
  });
}

function kinds(ops: readonly SchemaDiffOperation[]): string[] {
  return ops.map((op) => op.kind);
}

// --- SDIFF-01: diff(A,A)=∅ ---
test("SDIFF-01: identical snapshots produce empty diff", () => {
  const a = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")]),
  ]);
  const diff = diffSchemas({ from: a, to: a });
  assert.equal(diff.isEmpty, true);
  assert.equal(diff.operations.length, 0);
  assert.equal(diff.summary.totalOperations, 0);
});

// --- SDIFF-02: input ordering ---
test("SDIFF-02: input ordering does not affect serialized diff", () => {
  const ordered = snap([
    table("public", "a", [col("id", "integer")]),
    table("billing", "b", [col("id", "integer"), col("x", "text")]),
  ]);
  const shuffled: AthenaSchemaSnapshot = {
    version: 1,
    backend: "postgresql",
    schemas: [
      {
        name: "billing",
        tables: [
          {
            schema: "billing",
            name: "b",
            columns: [col("x", "text"), col("id", "integer")],
            primaryKey: { name: null, columns: ["id"] },
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "a",
            columns: [col("id", "integer")],
            primaryKey: { name: null, columns: ["id"] },
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
    ],
  };

  const desired = snap([
    table("public", "a", [col("id", "integer"), col("name", "text")]),
    table("billing", "b", [col("id", "integer"), col("x", "text")]),
  ]);

  const d1 = diffSchemas({ from: ordered, to: desired });
  const d2 = diffSchemas({ from: shuffled, to: desired });
  assert.equal(JSON.stringify(d1.operations), JSON.stringify(d2.operations));
});

// --- SDIFF-03 multi-schema identity ---
test("SDIFF-03: multi-schema table identity prevents collisions", () => {
  const actual = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")]),
    table("billing", "users", [col("id", "uuid"), col("email", "text")]),
    table("audit", "users", [col("id", "uuid"), col("email", "text")]),
  ]);
  const desired = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")]),
    table("billing", "users", [
      col("id", "uuid"),
      col("email", "text"),
      col("plan", "text"),
    ]),
    table("audit", "users", [col("id", "uuid"), col("email", "text")]),
  ]);

  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(diff.operations.length, 1);
  const op = diff.operations[0];
  assert.equal(op.kind, "add_column");
  if (op.kind === "add_column") {
    assert.equal(op.table.schema, "billing");
    assert.equal(op.table.name, "users");
    assert.equal(op.column.name, "plan");
  }
});

// --- SDIFF-04 / SDIFF-05 type normalization ---
test("SDIFF-04: equivalent postgres type aliases do not differ", () => {
  const actual = snap([
    table("public", "t", [col("id", "int4"), col("flag", "bool")]),
  ]);
  const desired = snap([
    table("public", "t", [col("id", "integer"), col("flag", "boolean")]),
  ]);
  assert.equal(diffSchemas({ from: actual, to: desired }).isEmpty, true);
});

test("SDIFF-05: semantically different types do differ", () => {
  const actual = snap([table("public", "t", [col("n", "integer")])]);
  const desired = snap([table("public", "t", [col("n", "bigint")])]);
  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(diff.summary.columnsChanged, 1);
  assert.equal(diff.operations[0]?.kind, "alter_column");
});

test("normalization: varchar length and numeric precision retained", () => {
  const a = snap([table("public", "t", [col("c", "varchar(64)")])]);
  const b = snap([table("public", "t", [col("c", "varchar(255)")])]);
  assert.equal(diffSchemas({ from: a, to: b }).isEmpty, false);

  const n1 = snap([table("public", "t", [col("c", "numeric(18,2)")])]);
  const n2 = snap([table("public", "t", [col("c", "numeric(12,2)")])]);
  assert.equal(diffSchemas({ from: n1, to: n2 }).isEmpty, false);

  const ts1 = snap([table("public", "t", [col("c", "timestamp")])]);
  const ts2 = snap([table("public", "t", [col("c", "timestamptz")])]);
  assert.equal(diffSchemas({ from: ts1, to: ts2 }).isEmpty, false);
});

test("default normalization: cast and now() equivalents", () => {
  assert.equal(normalizeDefaultExpression("'active'::text"), "'active'");
  assert.equal(
    normalizeDefaultExpression("nextval('users_id_seq'::regclass)"),
    "nextval('users_id_seq')"
  );
  assert.equal(normalizeDefaultExpression("CURRENT_TIMESTAMP"), "now()");
  assert.equal(
    normalizeDefaultExpression("statement_timestamp()"),
    "statement_timestamp()"
  );
  assert.equal(normalizeDefaultExpression(undefined), null);
  assert.equal(normalizeDefaultExpression(null), null);

  const a = snap([
    table("public", "t", [
      col("id", "integer"),
      col("status", "text", { default: "'active'::text" }),
    ]),
  ]);
  const b = snap([
    table("public", "t", [
      col("id", "integer"),
      col("status", "text", { default: "'active'" }),
    ]),
  ]);
  assert.equal(diffSchemas({ from: a, to: b }).isEmpty, true);
});

// --- SDIFF-06 composite order ---
test("SDIFF-06: composite PK and index column order is semantic", () => {
  const a = snap([
    table(
      "public",
      "t",
      [col("a", "integer"), col("b", "integer")],
      {
        primaryKey: { name: null, columns: ["a", "b"] },
        indexes: [
          {
            name: null,
            unique: false,
            columns: [
              { name: "a", direction: "asc" },
              { name: "b", direction: "asc" },
            ],
          },
        ],
      }
    ),
  ]);
  const b = snap([
    table(
      "public",
      "t",
      [col("a", "integer"), col("b", "integer")],
      {
        primaryKey: { name: null, columns: ["b", "a"] },
        indexes: [
          {
            name: null,
            unique: false,
            columns: [
              { name: "b", direction: "asc" },
              { name: "a", direction: "asc" },
            ],
          },
        ],
      }
    ),
  ]);
  const diff = diffSchemas({ from: a, to: b });
  assert.ok(diff.summary.primaryKeysAdded >= 1);
  assert.ok(diff.summary.primaryKeysRemoved >= 1);
  assert.ok(diff.summary.indexesAdded >= 1);
  assert.ok(diff.summary.indexesRemoved >= 1);
});

// --- SDIFF-07 cross-schema FK ---
test("SDIFF-07: cross-schema FK identity survives normalize + diff", () => {
  const fk = {
    name: "invoice_org_fk",
    columns: ["organization_id"],
    target: { schema: "public", name: "organization" },
    targetColumns: ["id"],
    onDelete: "cascade" as const,
    onUpdate: "no_action" as const,
  };
  const actual = snap([
    table("public", "organization", [col("id", "uuid")]),
    table(
      "billing",
      "invoice",
      [col("id", "uuid"), col("organization_id", "uuid")],
      { foreignKeys: [fk] }
    ),
  ]);
  const desired = structuredClone(actual) as AthenaSchemaSnapshot;
  assert.equal(diffSchemas({ from: actual, to: desired }).isEmpty, true);

  const desiredChanged = snap([
    table("public", "organization", [col("id", "uuid")]),
    table(
      "billing",
      "invoice",
      [col("id", "uuid"), col("organization_id", "uuid")],
      {
        foreignKeys: [{ ...fk, onDelete: "restrict" }],
      }
    ),
  ]);
  const diff = diffSchemas({ from: actual, to: desiredChanged });
  assert.equal(diff.summary.foreignKeysChanged, 1);
  const alter = diff.operations.find((o) => o.kind === "alter_foreign_key");
  assert.ok(alter);
  if (alter?.kind === "alter_foreign_key") {
    assert.equal(alter.before.target.schema, "public");
    assert.equal(alter.after.onDelete, "restrict");
  }
});

// --- SDIFF-08 unmanaged / internal ---
test("SDIFF-08: athena internal schema excluded from introspection adapter", () => {
  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "app",
    generatedAt: new Date().toISOString(),
    schemas: {
      athena: {
        name: "athena",
        tables: {
          schema_migrations: {
            schema: "athena",
            name: "schema_migrations",
            columns: {
              version: {
                arrayDimensions: 0,
                dataType: "bigint",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "version",
                typeKind: "scalar",
                udtName: "int8",
              },
            },
            primaryKey: ["version"],
            relations: {},
          },
        },
      },
      public: {
        name: "public",
        tables: {
          users: {
            schema: "public",
            name: "users",
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "uuid",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "uuid",
              },
            },
            primaryKey: ["id"],
            relations: {},
          },
        },
      },
    },
  };

  const snapshot = schemaSnapshotFromIntrospection(intro);
  assert.equal(
    snapshot.schemas.some((s) => s.name === "athena"),
    false
  );
  assert.equal(snapshot.schemas.some((s) => s.name === "public"), true);
});

// --- SDIFF-09 before/after metadata ---
test("SDIFF-09: drop/alter retain before/after metadata", () => {
  const actual = snap([
    table("public", "users", [
      col("id", "uuid"),
      col("email", "text"),
      col("age", "integer"),
    ]),
  ]);
  const desired = snap([
    table("public", "users", [
      col("id", "uuid"),
      col("email", "text", { nullable: true }),
    ]),
  ]);
  const diff = diffSchemas({ from: actual, to: desired });
  const drop = diff.operations.find((o) => o.kind === "drop_column");
  assert.ok(drop && drop.kind === "drop_column");
  if (drop?.kind === "drop_column") {
    assert.equal(drop.column.name, "age");
    assert.equal(drop.column.type.name, "integer");
  }
  const alter = diff.operations.find((o) => o.kind === "alter_column");
  assert.ok(alter && alter.kind === "alter_column");
  if (alter?.kind === "alter_column") {
    assert.equal(alter.before.nullable, false);
    assert.equal(alter.after.nullable, true);
    assert.ok(alter.changes.nullable);
  }
});

// --- SDIFF-10 immutability ---
test("SDIFF-10: diff does not mutate inputs", () => {
  const from = snap([table("public", "t", [col("id", "integer")])]);
  const to = snap([
    table("public", "t", [col("id", "integer"), col("n", "text")]),
  ]);
  const fromJson = JSON.stringify(from);
  const toJson = JSON.stringify(to);
  diffSchemas({ from, to });
  assert.equal(JSON.stringify(from), fromJson);
  assert.equal(JSON.stringify(to), toJson);
});

// --- SDIFF-11 no SQL ---
test("SDIFF-11: operations never carry SQL strings", () => {
  const from = emptySchemaSnapshot();
  const to = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")], {
      uniqueConstraints: [{ name: null, columns: ["email"] }],
      indexes: [
        {
          name: "users_email_lookup",
          unique: false,
          columns: [{ name: "email", direction: "asc" }],
        },
      ],
    }),
  ]);
  const diff = diffSchemas({ from, to });
  const json = JSON.stringify(diff.operations);
  assert.equal(/CREATE |ALTER |DROP /i.test(json), false);
  assert.ok(kinds(diff.operations).includes("create_table"));
});

// --- SDIFF-12 no DB ---
test("SDIFF-12: diffSchemas is pure and does not need a database", () => {
  // Smoke: call with only in-memory objects (this test file has no pool).
  const diff = diffSchemas({
    from: emptySchemaSnapshot(),
    to: emptySchemaSnapshot(),
  });
  assert.equal(diff.isEmpty, true);
});

test("table/column/schema create and drop operations", () => {
  const from = snap([
    table("public", "old", [col("id", "integer")]),
    table("legacy", "t", [col("id", "integer")]),
  ]);
  const to = snap([
    table("public", "new", [col("id", "integer"), col("name", "text")]),
    table("app", "t", [col("id", "integer")]),
  ]);
  const diff = diffSchemas({ from, to });
  assert.ok(kinds(diff.operations).includes("drop_table"));
  assert.ok(kinds(diff.operations).includes("create_table"));
  assert.ok(kinds(diff.operations).includes("drop_schema"));
  assert.ok(kinds(diff.operations).includes("create_schema"));
});

test("unique constraints compare structurally ignoring generated names", () => {
  const a = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")], {
      uniqueConstraints: [{ name: "users_email_key", columns: ["email"] }],
    }),
  ]);
  const b = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")], {
      uniqueConstraints: [{ name: null, columns: ["email"] }],
    }),
  ]);
  assert.equal(diffSchemas({ from: a, to: b }).isEmpty, true);
});

test("indexes compare structurally ignoring generated names", () => {
  const a = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")], {
      indexes: [
        {
          name: "users_email_idx",
          unique: false,
          columns: [{ name: "email", direction: "asc" }],
        },
      ],
    }),
  ]);
  const b = snap([
    table("public", "users", [col("id", "uuid"), col("email", "text")], {
      indexes: [
        {
          name: null,
          unique: false,
          columns: [{ name: "email", direction: "asc" }],
        },
      ],
    }),
  ]);
  assert.equal(diffSchemas({ from: a, to: b }).isEmpty, true);
});

test("validateSchemaSnapshot rejects duplicate table identity", () => {
  assert.throws(
    () =>
      validateSchemaSnapshot({
        version: 1,
        schemas: [
          {
            name: "public",
            tables: [
              table("public", "users", [col("id", "uuid")]),
              table("public", "users", [col("id", "uuid")]),
            ],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof SchemaDiffError && err.code === "duplicate_table"
  );
});

test("normalize is idempotent", () => {
  const raw: AthenaSchemaSnapshot = {
    version: 1,
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "t",
            columns: [col("b", "int4"), col("a", "bool")],
            primaryKey: { name: null, columns: ["a"] },
            uniqueConstraints: [],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
    ],
  };
  const once = normalizeSchemaSnapshot(raw);
  const twice = normalizeSchemaSnapshot(once);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

test("schemaSnapshotFromModels extracts multi-schema tables", () => {
  const users = defineModel({
    meta: {
      schema: "public",
      model: "users",
      primaryKey: ["id"],
      columns: {
        id: { kind: "string", columnName: "id" },
        email: { kind: "string", columnName: "email" },
      },
    },
  });
  const invoice = defineModel({
    meta: {
      schema: "billing",
      model: "invoice",
      primaryKey: ["id"],
      columns: {
        id: { kind: "string", columnName: "id" },
        organization_id: { kind: "string", columnName: "organization_id" },
      },
      relations: {
        organization: {
          kind: "many-to-one",
          sourceColumns: ["organization_id"],
          targetColumns: ["id"],
          targetModel: "organization",
          targetSchema: "public",
        },
      },
    },
  });

  const snapshot = schemaSnapshotFromModels([users, invoice]);
  assert.ok(snapshot.schemas.some((s) => s.name === "billing"));
  const billing = snapshot.schemas.find((s) => s.name === "billing");
  const inv = billing?.tables.find((t) => t.name === "invoice");
  assert.ok(inv);
  assert.equal(inv?.foreignKeys.length, 1);
  assert.equal(inv?.foreignKeys[0]?.target.schema, "public");
});

test("schemaSnapshotFromIntrospection maps FK actions and defaults", () => {
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
                dataType: "uuid",
                defaultExpression: null,
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "uuid",
              },
              status: {
                arrayDimensions: 0,
                dataType: "text",
                defaultExpression: "'active'::text",
                hasDefault: true,
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
            uniqueConstraints: [{ name: "users_status_key", columns: ["status"] }],
            indexes: [
              {
                name: "users_status_idx",
                unique: false,
                columns: ["status"],
                method: "btree",
              },
            ],
          },
          profiles: {
            schema: "public",
            name: "profiles",
            columns: {
              user_id: {
                arrayDimensions: 0,
                dataType: "uuid",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "user_id",
                typeKind: "scalar",
                udtName: "uuid",
              },
            },
            primaryKey: ["user_id"],
            relations: {
              user: {
                kind: "one-to-one",
                name: "profiles_user_fk",
                onDelete: "c",
                onUpdate: "a",
                sourceColumns: ["user_id"],
                targetColumns: ["id"],
                targetModel: "users",
                targetSchema: "public",
              },
            },
          },
        },
      },
    },
  };

  const snapshot = schemaSnapshotFromIntrospection(intro);
  const users = snapshot.schemas[0]?.tables.find((t) => t.name === "users");
  const status = users?.columns.find((c) => c.name === "status");
  assert.equal(status?.default, "'active'");
  assert.equal(users?.uniqueConstraints.length, 1);
  assert.equal(users?.indexes.length, 1);

  const profiles = snapshot.schemas[0]?.tables.find((t) => t.name === "profiles");
  assert.equal(profiles?.foreignKeys[0]?.onDelete, "cascade");
});

test("performance: large synthetic schema diffs in linear-ish time", () => {
  const tables: SchemaTable[] = [];
  for (let i = 0; i < 500; i += 1) {
    const columns: SchemaColumn[] = [col("id", "integer")];
    for (let c = 0; c < 20; c += 1) {
      columns.push(col(`c_${c}`, "text"));
    }
    tables.push(
      table("public", `t_${String(i).padStart(4, "0")}`, columns, {
        indexes: [
          {
            name: null,
            unique: false,
            columns: [{ name: "c_0", direction: "asc" }],
          },
          {
            name: null,
            unique: false,
            columns: [{ name: "c_1", direction: "asc" }],
          },
        ],
      })
    );
  }
  const actual = snap(tables);
  const desiredTables = tables.map((t, i) =>
    i === 0
      ? table(t.schema, t.name, [...t.columns, col("extra", "text")], {
          indexes: t.indexes,
          primaryKey: t.primaryKey,
        })
      : t
  );
  const desired = snap(desiredTables);

  const start = performance.now();
  const diff = diffSchemas({ from: actual, to: desired });
  const elapsed = performance.now() - start;
  assert.equal(diff.summary.columnsAdded, 1);
  // Generous bound: catches accidental O(n²) on 500×20 schemas.
  assert.ok(
    elapsed < 5000,
    `diff took ${elapsed.toFixed(1)}ms (expected < 5000ms)`
  );
});

test("columnsEqual uses normalized types", () => {
  const a = col("n", "int4");
  const b = col("n", "integer");
  assert.equal(columnsEqual(a, b), true);
});
