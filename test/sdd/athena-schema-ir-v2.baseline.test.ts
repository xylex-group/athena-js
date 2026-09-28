/**
 * Additive-kept v1 compatibility characterization after Schema IR v2 P0.
 *
 * Target suite (`athena-schema-ir-v2.target.test.ts`, T-SIR-*) is the IR v2
 * source of truth. These B-SIR-* cases still correctly describe the v1
 * snapshot / validate / adapter surface (T-SIR-17 hold). Absence-pin IDs
 * B-SIR-07/08/09/15/16 live under test/sdd/superseded/.
 *
 * See docs/sdd/xylex/athena-schema-ir-v2/SPEC.md (B-SIR-*).
 */

import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as migrationsBarrel from "../../src/migrations/index.ts";
import { defineModel } from "../../src/schema/definitions.ts";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  emptySchemaSnapshot,
  SchemaDiffError,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  tableIdentityKey,
  validateSchemaSnapshot,
} from "../../src/schema/diff/index.ts";
import type {
  AthenaSchemaSnapshot,
  DiffSchemasInput,
  SchemaColumn,
  SchemaTable,
} from "../../src/schema/diff/types.ts";
import * as schemaBarrel from "../../src/schema/index.ts";
import { table } from "../../src/schema/table-builder.ts";
import { enumeration, string } from "../../src/schema/table-columns.ts";
import type { IntrospectionSnapshot } from "../../src/schema/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const schemaDiffTypesSrc = readFileSync(
  join(srcRoot, "schema", "diff", "types.ts"),
  "utf8"
);

function snapshotColumn(name: string, typeName = "text"): SchemaColumn {
  return {
    default: null,
    isGenerated: false,
    name,
    nullable: false,
    type: {
      arrayDimensions: 0,
      name: typeName,
    },
  };
}

function expectSchemaDiffError(
  fn: () => void,
  code: SchemaDiffError["code"]
): SchemaDiffError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SchemaDiffError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected SchemaDiffError ${code}`);
}

function snapshotTable(
  schema: string,
  name: string,
  extras: Partial<SchemaTable> = {}
): SchemaTable {
  const columns = extras.columns ?? [snapshotColumn("id", "uuid")];
  return {
    columns,
    foreignKeys: extras.foreignKeys ?? [],
    indexes: extras.indexes ?? [],
    name,
    primaryKey:
      extras.primaryKey === undefined
        ? { columns: ["id"], name: null }
        : extras.primaryKey,
    schema,
    uniqueConstraints: extras.uniqueConstraints ?? [],
  };
}

test("B-SIR-01: ATHENA_SCHEMA_SNAPSHOT_VERSION === 1", () => {
  assert.equal(ATHENA_SCHEMA_SNAPSHOT_VERSION, 1);
  assert.equal(schemaBarrel.ATHENA_SCHEMA_SNAPSHOT_VERSION, 1);
  assert.equal(migrationsBarrel.ATHENA_SCHEMA_SNAPSHOT_VERSION, 1);
  const empty = emptySchemaSnapshot("postgresql");
  assert.equal(empty.version, 1);
  assert.equal(empty.version, ATHENA_SCHEMA_SNAPSHOT_VERSION);
});

test("B-SIR-02: AthenaSchemaSnapshot has schemas + optional backend; no databases/kind/irVersion", () => {
  const empty = emptySchemaSnapshot(null);
  assert.deepEqual(Object.keys(empty).sort(), [
    "backend",
    "schemas",
    "version",
  ]);
  assert.equal(empty.backend, null);
  assert.ok(Array.isArray(empty.schemas));
  assert.equal("databases" in empty, false);
  assert.equal("kind" in empty, false);
  assert.equal("irVersion" in empty, false);
  assert.equal("metadata" in empty, false);
  assert.equal("database" in empty, false);

  const withBackend: AthenaSchemaSnapshot = {
    backend: "postgresql",
    schemas: [],
    version: 1,
  };
  assert.equal(withBackend.backend, "postgresql");

  assert.match(schemaDiffTypesSrc, /export interface AthenaSchemaSnapshot/);
  assert.equal(schemaDiffTypesSrc.includes("readonly schemas:"), true);
  assert.equal(schemaDiffTypesSrc.includes("readonly backend?:"), true);
  assert.equal(schemaDiffTypesSrc.includes("readonly databases"), false);
  assert.equal(schemaDiffTypesSrc.includes('kind: "athena.schema"'), false);
  assert.equal(schemaDiffTypesSrc.includes("irVersion"), false);
});

test("B-SIR-03: SchemaTableIdentity is { schema, name } with optional database", () => {
  assert.match(
    schemaDiffTypesSrc,
    /export interface SchemaTableIdentity \{[\s\S]*?readonly schema: string;[\s\S]*?readonly name: string;[\s\S]*?\}/
  );
  const identityBlock = schemaDiffTypesSrc.slice(
    schemaDiffTypesSrc.indexOf("export interface SchemaTableIdentity"),
    schemaDiffTypesSrc.indexOf("export interface SchemaColumnType")
  );
  assert.equal(identityBlock.includes("database?"), true);
  assert.equal(identityBlock.includes("namespace"), false);
  assert.equal(identityBlock.includes("physical"), false);
  assert.equal(identityBlock.includes("logical"), false);

  const key = tableIdentityKey({ name: "users", schema: "public" });
  assert.equal(key, "\u0000public\u0000users");
  assert.equal(
    tableIdentityKey({ database: "app", name: "users", schema: "public" }),
    "app\u0000public\u0000users"
  );
});

test("B-SIR-04: enums exist only as SchemaColumnType.enumValues; no SchemaEnum", () => {
  assert.match(
    schemaDiffTypesSrc,
    /export interface SchemaColumnType \{[\s\S]*readonly enumValues\?:/
  );
  assert.equal(
    schemaDiffTypesSrc.includes("export interface SchemaEnum"),
    false
  );
  assert.equal(schemaDiffTypesSrc.includes("export type SchemaEnum"), false);
  assert.equal(schemaDiffTypesSrc.includes("enumId"), false);

  const enumModel = defineModel<{ id: string; mood: string }>({
    meta: {
      columns: {
        id: { columnName: "id", kind: "string" },
        mood: {
          columnName: "mood",
          enumValues: ["happy", "sad"],
          kind: "enumeration",
        },
      },
      model: "moods",
      primaryKey: ["id"],
      schema: "public",
    },
  });
  const fromModels = schemaSnapshotFromModels([enumModel]);
  const moods = fromModels.schemas[0]?.tables.find((t) => t.name === "moods");
  const moodCol = moods?.columns.find((c) => c.name === "mood");
  assert.ok(moodCol);
  assert.equal(moodCol?.type.name, "text");
  assert.equal(moodCol?.type.enumValues ?? null, null);

  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "appdb",
    generatedAt: "2026-08-21T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          moods: {
            columns: {
              mood: {
                arrayDimensions: 0,
                dataType: "mood_enum",
                enumValues: ["happy", "sad"],
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "mood",
                typeKind: "enum",
                udtName: "mood_enum",
              },
            },
            name: "moods",
            primaryKey: ["mood"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };
  const fromIntro = schemaSnapshotFromIntrospection(intro);
  const introMood = fromIntro.schemas[0]?.tables[0]?.columns[0];
  assert.deepEqual(introMood?.type.enumValues, ["happy", "sad"]);
  assert.equal("enums" in fromIntro, false);
});

test("B-SIR-05: snapshot tables have PK/unique/FK/index; no CHECK field", () => {
  const tableBlockStart = schemaDiffTypesSrc.indexOf(
    "export interface SchemaTable {"
  );
  const tableBlock = schemaDiffTypesSrc.slice(
    tableBlockStart,
    schemaDiffTypesSrc.indexOf("export interface SchemaNamespace")
  );
  assert.equal(tableBlock.includes("readonly primaryKey:"), true);
  assert.equal(tableBlock.includes("readonly uniqueConstraints:"), true);
  assert.equal(tableBlock.includes("readonly foreignKeys:"), true);
  assert.equal(tableBlock.includes("readonly indexes:"), true);
  assert.equal(tableBlock.includes("check"), false);
  assert.equal(tableBlock.includes("CHECK"), false);
  assert.equal(schemaDiffTypesSrc.includes("SchemaConstraint"), false);
  assert.equal(
    schemaDiffTypesSrc.includes('"add_check"') ||
      schemaDiffTypesSrc.includes("add_check_constraint"),
    false
  );

  const tbl = snapshotTable("public", "t");
  assert.deepEqual(Object.keys(tbl).sort(), [
    "columns",
    "foreignKeys",
    "indexes",
    "name",
    "primaryKey",
    "schema",
    "uniqueConstraints",
  ]);
});

test("B-SIR-06: adapters collapse relations to SchemaForeignKey; M2M through dropped", () => {
  const models = [
    defineModel<{ id: string }>({
      meta: {
        columns: { id: { columnName: "id", kind: "string" } },
        model: "users",
        primaryKey: ["id"],
        schema: "public",
      },
    }),
    defineModel<{ id: string; author_id: string }>({
      meta: {
        columns: {
          author_id: { columnName: "author_id", kind: "string" },
          id: { columnName: "id", kind: "string" },
        },
        model: "posts",
        primaryKey: ["id"],
        relations: {
          author: {
            kind: "many-to-one",
            sourceColumns: ["author_id"],
            targetColumns: ["id"],
            targetModel: "users",
            targetSchema: "public",
          },
          comments: {
            kind: "one-to-many",
            sourceColumns: ["id"],
            targetColumns: ["post_id"],
            targetModel: "comments",
            targetSchema: "public",
          },
          tags: {
            kind: "many-to-many",
            sourceColumns: ["id"],
            targetColumns: ["id"],
            targetModel: "tags",
            targetSchema: "public",
            through: {
              model: "post_tags",
              schema: "public",
              sourceColumns: ["post_id"],
              targetColumns: ["tag_id"],
            },
          },
        },
        schema: "public",
      },
    }),
  ];
  const fromModels = schemaSnapshotFromModels(models);
  const posts = fromModels.schemas[0]?.tables.find((t) => t.name === "posts");
  assert.ok(posts);
  assert.equal(posts?.foreignKeys.length, 1);
  assert.deepEqual(posts?.foreignKeys[0]?.columns, ["author_id"]);
  assert.deepEqual(posts?.foreignKeys[0]?.target, {
    database: "default",
    name: "users",
    schema: "public",
  });
  assert.equal(
    posts?.foreignKeys.some((fk) => fk.target.name === "tags"),
    false
  );
  assert.equal(
    posts?.foreignKeys.some((fk) => fk.target.name === "comments"),
    false
  );
  assert.equal("relations" in (posts ?? {}), false);

  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "appdb",
    generatedAt: "2026-08-21T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          posts: {
            columns: {
              author_id: {
                arrayDimensions: 0,
                dataType: "uuid",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "author_id",
                typeKind: "scalar",
                udtName: "uuid",
              },
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
            name: "posts",
            primaryKey: ["id"],
            relations: {
              author: {
                kind: "many-to-one",
                name: "posts_author_fk",
                sourceColumns: ["author_id"],
                targetColumns: ["id"],
                targetModel: "users",
                targetSchema: "public",
              },
              tags: {
                kind: "many-to-many",
                name: "posts_tags_m2m",
                sourceColumns: ["id"],
                targetColumns: ["id"],
                targetModel: "tags",
                targetSchema: "public",
                through: {
                  model: "post_tags",
                  schema: "public",
                  sourceColumns: ["post_id"],
                  targetColumns: ["tag_id"],
                },
              },
            },
            schema: "public",
          },
          users: {
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
            name: "users",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };
  const fromIntro = schemaSnapshotFromIntrospection(intro);
  const introPosts = fromIntro.schemas[0]?.tables.find(
    (t) => t.name === "posts"
  );
  assert.equal(introPosts?.foreignKeys.length, 1);
  assert.equal(introPosts?.foreignKeys[0]?.name, "posts_author_fk");
  assert.equal(introPosts?.foreignKeys[0]?.target.name, "users");
});

test("B-SIR-09: table() returns AthenaTableDef / ModelDef; v1 snapshot projection remains", () => {
  const users = table("users")
    .schema("public")
    .columns({
      email: string(),
      id: string().generated(),
      mood: enumeration(["happy", "sad"] as const).optional(),
    })
    .primaryKey("id");

  assert.equal(users.kind, "table");
  assert.equal(users.name, "users");
  assert.equal(users.tableName, "users");
  assert.equal(users.schemaName, "public");
  assert.ok(users.meta);
  assert.equal(users.meta.model, "users");

  const snapshot = schemaSnapshotFromModels([users]);
  assert.equal(snapshot.version, 1);
  assert.equal("kind" in snapshot, false);
});

test("B-SIR-10: inspect() contract is IntrospectionSnapshot; conversion is schemaSnapshotFromIntrospection → v1", () => {
  const typesSrc = readFileSync(join(srcRoot, "schema", "types.ts"), "utf8");
  assert.match(
    typesSrc,
    /inspect:\s*\(\s*options\?: IntrospectionInspectOptions\s*\)\s*=> Promise<IntrospectionSnapshot>/
  );
  const providerSrc = readFileSync(
    join(srcRoot, "schema", "postgres-provider.ts"),
    "utf8"
  );
  assert.match(providerSrc, /Promise<IntrospectionSnapshot>/);

  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "prod",
    generatedAt: "2026-08-21T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          t: {
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
            name: "t",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };
  const snapshot = schemaSnapshotFromIntrospection(intro);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.backend, "postgresql");
  assert.equal(snapshot.schemas[0]?.name, "public");
  assert.equal(typeof schemaBarrel.schemaSnapshotFromIntrospection, "function");
});

test("B-SIR-11: ModelMetadataBase is authored (defineModel / table meta), not derived from IR", () => {
  const authored = defineModel<{ id: string }>({
    meta: {
      columns: { id: { columnName: "id", kind: "string" } },
      database: "analytics",
      model: "events",
      primaryKey: ["id"],
      schema: "public",
      tableName: "evt",
    },
  });
  assert.equal(authored.meta.database, "analytics");
  assert.equal(authored.meta.tableName, "evt");
  const snapshot = schemaSnapshotFromModels([authored]);
  assert.equal("database" in snapshot, false);
  assert.equal("databases" in snapshot, false);
  const physical = snapshot.schemas[0]?.tables.find((t) => t.name === "evt");
  assert.ok(physical);
  assert.equal(physical?.schema, "public");
  assert.equal(
    snapshot.schemas[0]?.tables.some((t) => t.name === "events"),
    false
  );

  const built = table("accounts")
    .schema("billing")
    .columns({ id: string() })
    .primaryKey("id");
  assert.equal(built.meta.schema, "billing");
  assert.equal(built.meta.model, "accounts");
  assert.equal(built.meta.database, undefined);
  assert.deepEqual(built.meta.primaryKey, ["id"]);
});

test("B-SIR-12: validateSchemaSnapshot rejects version !== 1 and non-array schemas", () => {
  expectSchemaDiffError(
    () =>
      validateSchemaSnapshot({
        schemas: [],
        version: 2,
      } as unknown as AthenaSchemaSnapshot),
    "unsupported_snapshot_version"
  );

  expectSchemaDiffError(
    () =>
      validateSchemaSnapshot({
        schemas: [],
        version: 0,
      } as unknown as AthenaSchemaSnapshot),
    "unsupported_snapshot_version"
  );

  expectSchemaDiffError(
    () =>
      validateSchemaSnapshot({
        schemas: { public: { name: "public", tables: [] } },
        version: 1,
      } as unknown as AthenaSchemaSnapshot),
    "invalid_snapshot"
  );

  expectSchemaDiffError(
    () => validateSchemaSnapshot(null as unknown as AthenaSchemaSnapshot),
    "invalid_snapshot"
  );

  const danglingFk: AthenaSchemaSnapshot = {
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          snapshotTable("public", "child", {
            columns: [snapshotColumn("parent_id", "uuid")],
            foreignKeys: [
              {
                columns: ["parent_id"],
                name: null,
                onDelete: "no_action",
                onUpdate: "no_action",
                target: { name: "missing_parent", schema: "public" },
                targetColumns: ["id"],
              },
            ],
            primaryKey: null,
          }),
        ],
      },
    ],
    version: 1,
  };
  validateSchemaSnapshot(danglingFk);
});

test("B-SIR-13: IntrospectionSnapshot.database is not a v1 document field; table identities keep it", () => {
  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "tenant_prod",
    generatedAt: "2026-08-21T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          users: {
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
            name: "users",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };
  assert.equal(intro.database, "tenant_prod");
  const snapshot = schemaSnapshotFromIntrospection(intro);
  assert.equal("database" in snapshot, false);
  assert.equal("databases" in snapshot, false);
  assert.equal(snapshot.backend, "postgresql");
  assert.equal(snapshot.schemas[0]?.database, "tenant_prod");
  assert.equal(snapshot.schemas[0]?.tables[0]?.database, "tenant_prod");
});

test("B-SIR-14: canonical types re-exported from schema/diff via schema/index.ts and /migrations", () => {
  assert.equal(typeof schemaBarrel.validateSchemaSnapshot, "function");
  assert.equal(typeof schemaBarrel.schemaSnapshotFromModels, "function");
  assert.equal(typeof schemaBarrel.schemaSnapshotFromIntrospection, "function");
  assert.equal(typeof schemaBarrel.diffSchemas, "function");
  assert.equal(typeof migrationsBarrel.validateSchemaSnapshot, "function");
  assert.equal(typeof migrationsBarrel.schemaSnapshotFromModels, "function");
  assert.equal(
    typeof migrationsBarrel.schemaSnapshotFromIntrospection,
    "function"
  );
  assert.equal(typeof migrationsBarrel.diffSchemas, "function");

  const schemaIndexSrc = readFileSync(
    join(srcRoot, "schema", "index.ts"),
    "utf8"
  );
  assert.equal(schemaIndexSrc.includes('from "./diff/index.ts"'), true);
  const migrationsSrc = readFileSync(
    join(srcRoot, "migrations", "index.ts"),
    "utf8"
  );
  assert.equal(migrationsSrc.includes('from "../schema/diff/index.ts"'), true);

  const from = emptySchemaSnapshot();
  const to = emptySchemaSnapshot();
  const inputType: DiffSchemasInput = { from, to };
  assert.equal(from.version, ATHENA_SCHEMA_SNAPSHOT_VERSION);
  assert.equal(inputType.from, from);
});
