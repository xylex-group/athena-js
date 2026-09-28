import { strict as assert } from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  compileD1Fetch,
  normalizeD1TableName,
} from "../src/cloudflare/d1/sql.ts";
import {
  schemaIrFromModels,
  schemaSnapshotFromIr,
} from "../src/schema/ir/index.ts";
import {
  diffSchemas,
  schemaSnapshotFromIntrospection,
} from "../src/schema/diff/index.ts";
import { defineModel } from "../src/schema/definitions.ts";
import type { IntrospectionSnapshot } from "../src/schema/types.ts";
import {
  bigint,
  boolean,
  defineRegistry,
  defineSchema,
  enumeration,
  integer,
  json,
  modelsToSqlFiles,
  number,
  smallint,
  sqlD1,
  sqlPostgres,
  string,
  table,
  writeModelSqlFiles,
} from "../src/index.ts";

const users = table("users")
  .schema("public")
  .columns({
    active: boolean().defaulted(false),
    email: string(),
    id: string(),
    meta: json().optional(),
    role: enumeration(["admin", "member"] as const),
  })
  .primaryKey("id");

test("normalizeD1TableName strips Postgres schema for edge drop-in", () => {
  assert.equal(normalizeD1TableName("public.users"), "users");
  assert.equal(normalizeD1TableName("analytics.events"), "events");
  assert.equal(normalizeD1TableName("users"), "users");
});

test("D1 compiler accepts schema-qualified table_name from AthenaModels", () => {
  const compiled = compileD1Fetch({
    columns: ["id", "email"],
    table_name: "public.users",
  });
  assert.match(compiled.sql, /FROM "users"/);
  assert.doesNotMatch(compiled.sql, /public/);
});

test("sqlPostgres emits schema-qualified CREATE TABLE", () => {
  const sql = sqlPostgres(users);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "public"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\."users"/);
  assert.match(sql, /"id" TEXT NOT NULL PRIMARY KEY/);
  assert.match(sql, /"email" TEXT NOT NULL/);
  assert.match(sql, /"active" BOOLEAN/);
  assert.match(sql, /"meta" JSONB/);
  assert.match(sql, /CHECK \("role" IN \('admin', 'member'\)\)/);
});

test("sqlPostgres resolves logical primary keys to physical column names", () => {
  const usersWithPhysicalId = table("users")
    .columns({
      id: string().from("user_id"),
      email: string(),
    })
    .primaryKey("id");

  const sql = sqlPostgres(usersWithPhysicalId);

  assert.match(sql, /"user_id" TEXT NOT NULL PRIMARY KEY/);
  assert.doesNotMatch(sql, /"id" TEXT NOT NULL PRIMARY KEY/);
});

test("sqlPostgres emits stored generated expressions instead of defaults", () => {
  const events = defineModel({
    meta: {
      columns: {
        payload: {
          columnName: "payload",
          default: {
            dialect: "postgres",
            expression: "json_build_object('id', id)",
            kind: "sql",
          },
          generationStrategy: { kind: "generated-always" },
          hasDefault: true,
          isGenerated: true,
          kind: "json",
          nullable: true,
        },
        id: {
          columnName: "id",
          kind: "integer",
          nullable: false,
        },
      },
      model: "events",
      primaryKey: ["id"],
      schema: "public",
    },
  });

  const sql = sqlPostgres(events);

  assert.match(
    sql,
    /"payload" JSONB GENERATED ALWAYS AS \(json_build_object\('id', id\)\) STORED/
  );
  assert.doesNotMatch(sql, /"payload" JSONB DEFAULT/);
});

test("sqlPostgres does not project canonical stored generated integer PKs as SERIAL", () => {
  const generated = defineModel({
    meta: {
      columns: {
        id: {
          columnName: "id",
          default: {
            dialect: "postgres",
            expression: "id_source",
            kind: "sql",
          },
          generationStrategy: { kind: "generated-always" },
          hasDefault: true,
          isGenerated: true,
          kind: "integer",
          nullable: false,
        },
      },
      model: "generated_ids",
      primaryKey: ["id"],
    },
  });

  const sql = sqlPostgres(generated);

  assert.match(
    sql,
    /"id" INTEGER GENERATED ALWAYS AS \(id_source\) STORED NOT NULL PRIMARY KEY/
  );
  assert.doesNotMatch(sql, /SERIAL/);
});

test("sqlD1 emits stored generated expressions instead of defaults", () => {
  const events = defineModel({
    meta: {
      columns: {
        a: {
          columnName: "a",
          kind: "integer",
          nullable: false,
        },
        b: {
          columnName: "b",
          kind: "integer",
          nullable: false,
        },
        total: {
          columnName: "total",
          default: {
            dialect: "d1",
            expression: "a + b",
            kind: "sql",
          },
          generationStrategy: { kind: "generated-always" },
          hasDefault: true,
          isGenerated: true,
          kind: "integer",
          nullable: false,
        },
      },
      model: "events",
      primaryKey: ["a"],
      schema: "public",
    },
  });

  const sql = sqlD1(events);

  assert.match(
    sql,
    /"total" INTEGER GENERATED ALWAYS AS \(a \+ b\) STORED/
  );
  assert.match(
    sql,
    /"total" INTEGER GENERATED ALWAYS AS \(a \+ b\) STORED NOT NULL/
  );
  assert.doesNotMatch(sql, /"total" INTEGER DEFAULT/);
});

test("sqlPostgres accepts canonical generation strategies without legacy mirrors", () => {
  const identities = defineModel({
    meta: {
      columns: {
        id: {
          generationStrategy: { kind: "identity", mode: "always" },
          hasDefault: true,
          kind: "integer",
        },
      },
      model: "identities",
      primaryKey: ["id"],
      schema: "public",
    },
  });

  assert.match(
    sqlPostgres(identities),
    /"id" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY/
  );
});

test("sqlPostgres rejects an explicit default alongside canonical identity metadata", () => {
  const invalid = defineModel({
    meta: {
      columns: {
        id: {
          default: { kind: "literal", value: 1 },
          generationStrategy: { kind: "identity", mode: "always" },
          hasDefault: true,
          kind: "integer",
        },
      },
      model: "invalid_identity_default",
      primaryKey: ["id"],
    },
  });

  assert.throws(
    () => sqlPostgres(invalid),
    /Identity column "id" cannot also define an explicit default/
  );
});

test("sqlPostgres rejects identity columns with incompatible native PostgreSQL types", () => {
  const invalid = table("invalid_native_identity")
    .columns({
      id: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "text",
        })
        .identity("always"),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlPostgres(invalid),
    /PostgreSQL identity column "id" must use a scalar zero-dimensional integer native type/
  );
});

test("sqlPostgres rejects identity columns with array native PostgreSQL types", () => {
  const invalid = table("invalid_array_native_identity")
    .columns({
      id: integer()
        .nativeType({
          arrayDimensions: 1,
          backend: "postgresql",
          name: "int4",
        })
        .identity("always"),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlPostgres(invalid),
    /PostgreSQL identity column "id" must use a scalar zero-dimensional integer native type/
  );
});

test("sqlPostgres rejects identity columns with native types from unsupported backends", () => {
  const invalid = table("invalid_backend_native_identity")
    .columns({
      id: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "mysql",
          name: "integer",
        })
        .identity("always"),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlPostgres(invalid),
    /PostgreSQL identity column "id" must use a scalar zero-dimensional integer native type/
  );
});

test("sqlPostgres accepts scalar PostgreSQL integer native type aliases for identity columns", () => {
  const identities = table("native_identity_aliases")
    .columns({
      bigint: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "bigint",
        })
        .identity("always"),
      int2: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "int2",
        })
        .identity("always"),
      int4: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "int4",
        })
        .identity("always"),
      int8: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "int8",
        })
        .identity("always"),
      integer: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "integer",
        })
        .identity("always"),
      smallint: integer()
        .nativeType({
          arrayDimensions: 0,
          backend: "postgresql",
          name: "smallint",
        })
        .identity("always"),
    })
    .primaryKey("bigint");

  const sql = sqlPostgres(identities);

  assert.match(sql, /"bigint" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.match(sql, /"int2" SMALLINT GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.match(sql, /"int4" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.match(sql, /"int8" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.match(sql, /"integer" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.match(sql, /"smallint" SMALLINT GENERATED ALWAYS AS IDENTITY NOT NULL/);
});

test("schemaIrFromModels preserves authored defaults and resolved physical primary keys", () => {
  const model = defineModel({
    meta: {
      columns: {
        enabled: {
          default: { kind: "literal", value: false },
          hasDefault: true,
          kind: "boolean",
        },
        id: {
          columnName: "next",
          kind: "string",
        },
        next: {
          columnName: "final",
          kind: "string",
        },
        occurredAt: {
          default: {
            dialect: "postgres",
            expression: "CURRENT_TIMESTAMP",
            kind: "sql",
          },
          hasDefault: true,
          kind: "string",
        },
      },
      model: "events",
      primaryKey: ["id"],
      schema: "public",
    },
  });

  const sql = sqlPostgres(model);
  assert.match(sql, /"next" TEXT NOT NULL PRIMARY KEY/);
  assert.doesNotMatch(sql, /"final" TEXT NOT NULL PRIMARY KEY/);

  const ir = schemaIrFromModels([model]);
  const irTable = ir.databases
    .flatMap((database) => database.namespaces)
    .flatMap((namespace) => namespace.tables)
    .find((table) => table.identity.physical.name === "events");
  assert.ok(irTable);
  const primaryKey = irTable.constraints.find(
    (constraint) => constraint.kind === "primary_key"
  );
  assert.ok(primaryKey && primaryKey.kind === "primary_key");
  assert.deepEqual(primaryKey.columns, ["next"]);

  const serialized = JSON.stringify(ir);

  assert.match(serialized, /"default":"FALSE"/);
  assert.match(serialized, /"default":"CURRENT_TIMESTAMP"/);
});

test("schema IR preserves table-builder defaults through the v1 snapshot projection", () => {
  const settings = table("settings")
    .schema("public")
    .columns({
      created_at: string().defaulted({
        dialect: "postgres",
        expression: "CURRENT_TIMESTAMP",
      }),
      enabled: boolean().defaulted(false),
    })
    .withoutPrimaryKey();

  const ir = schemaIrFromModels([settings]);
  const irTable = ir.databases
    .flatMap((database) => database.namespaces)
    .flatMap((namespace) => namespace.tables)
    .find((model) => model.identity.physical.name === "settings");
  assert.ok(irTable);

  const irDefaults = new Map(
    irTable.columns.map((column) => [
      column.identity.physical.name,
      column.default,
    ])
  );
  assert.equal(irDefaults.get("enabled"), "FALSE");
  assert.equal(irDefaults.get("created_at"), "CURRENT_TIMESTAMP");

  const snapshot = schemaSnapshotFromIr(ir);
  const snapshotTable = snapshot.schemas
    .find((schema) => schema.name === "public")
    ?.tables.find((model) => model.name === "settings");
  assert.ok(snapshotTable);

  const snapshotDefaults = new Map(
    snapshotTable.columns.map((column) => [column.name, column.default])
  );
  assert.equal(snapshotDefaults.get("enabled"), "FALSE");
  assert.equal(snapshotDefaults.get("created_at"), "CURRENT_TIMESTAMP");
});

test("schema IR rejects SQL defaults authored for another backend", () => {
  const model = defineModel({
    meta: {
      columns: {
        created_at: {
          default: {
            dialect: "d1",
            expression: "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            kind: "sql",
          },
          hasDefault: true,
          kind: "string",
        },
      },
      model: "events",
      primaryKey: [],
    },
  });

  assert.throws(
    () => schemaIrFromModels([model], { backend: "postgresql" }),
    /default belongs to d1/
  );
});

test("schema IR preserves SQL defaults for the requested backend", () => {
  const model = defineModel({
    meta: {
      columns: {
        created_at: {
          default: {
            dialect: "d1",
            expression: "CURRENT_TIMESTAMP",
            kind: "sql",
          },
          hasDefault: true,
          kind: "string",
        },
      },
      model: "events",
      primaryKey: [],
    },
  });

  const ir = schemaIrFromModels([model], { backend: "d1" });
  const column = ir.databases[0]?.namespaces[0]?.tables[0]?.columns[0];
  assert.equal(column?.default, "CURRENT_TIMESTAMP");
});

test("schema IR keeps literal defaults backend-independent", () => {
  const model = table("settings")
    .columns({
      enabled: boolean().defaulted(false),
    })
    .withoutPrimaryKey();

  const ir = schemaIrFromModels([model], { backend: "d1" });
  const column = ir.databases[0]?.namespaces[0]?.tables[0]?.columns[0];
  assert.equal(column?.default, "FALSE");
});

test("schema IR only preserves native metadata for the requested backend", () => {
  const postgresNativeType = {
    arrayDimensions: 0,
    backend: "postgresql",
    name: "uuid",
  } as const;
  const model = table("users")
    .columns({
      id: string().nativeType(postgresNativeType),
    })
    .withoutPrimaryKey();

  const d1Ir = schemaIrFromModels([model], { backend: "d1" });
  const d1Native = d1Ir.databases[0]?.namespaces[0]?.tables[0]?.columns[0]
    ?.type.native;
  assert.equal(d1Native?.backend, "d1");
  assert.notEqual(d1Native?.name, "uuid");

  const postgresIr = schemaIrFromModels([model], { backend: "postgresql" });
  const postgresNative =
    postgresIr.databases[0]?.namespaces[0]?.tables[0]?.columns[0]?.type.native;
  assert.deepEqual(postgresNative, postgresNativeType);
});

test("schema IR preserves canonical generated physical primary keys through colliding logical names", () => {
  const model = defineModel({
    meta: {
      columns: {
        id: {
          columnName: "next",
          default: {
            dialect: "postgres",
            expression: "generated_next",
            kind: "sql",
          },
          generationStrategy: { kind: "generated-always" },
          hasDefault: true,
          isGenerated: true,
          kind: "integer",
          nullable: false,
        },
        next: {
          columnName: "final",
          kind: "string",
          nullable: false,
        },
      },
      model: "generated_events",
      primaryKey: ["id"],
      schema: "public",
    },
  });

  const generatedColumn = schemaIrFromModels([model]).databases[0]?.namespaces[0]
    ?.tables[0]?.columns.find(
      (column) => column.identity.physical.name === "next"
    );

  assert.equal(
    generatedColumn?.default,
    "generated_next"
  );
  assert.deepEqual(generatedColumn?.generationStrategy, {
    kind: "generated-always",
  });
  assert.equal(generatedColumn?.generated, true);
});

test("sqlPostgres preserves native PostgreSQL physical types from model metadata", () => {
  const users = {
    meta: {
      columns: {
        ratio: {
          kind: "number" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql",
            name: "float4",
          },
        },
        username: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql",
            length: 42,
            name: "varchar",
          },
        },
      },
      model: "users",
      primaryKey: ["username"],
    },
  };

  const sql = sqlPostgres(users);

  assert.match(sql, /"ratio" REAL NOT NULL/);
  assert.match(sql, /"username" VARCHAR\(42\) NOT NULL PRIMARY KEY/);
});

test("sqlPostgres preserves native PostgreSQL BIT and VARBIT lengths", () => {
  const users = {
    meta: {
      columns: {
        fixedBits: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            length: 8,
            name: "bit",
          },
        },
        variableBits: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            length: 17,
            name: "varbit",
          },
        },
      },
      model: "bit_values",
      primaryKey: ["fixedBits"],
    },
  };

  const sql = sqlPostgres(users);

  assert.match(sql, /"fixedBits" BIT\(8\) NOT NULL PRIMARY KEY/);
  assert.match(sql, /"variableBits" VARBIT\(17\) NOT NULL/);
});

test("sqlPostgres preserves native PostgreSQL datetime typmods", () => {
  const events = {
    meta: {
      columns: {
        createdAt: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "timestamp",
            precision: 3,
          },
        },
        observedAt: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "timestamptz",
            precision: 6,
          },
        },
        startsAt: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "time",
            precision: 2,
          },
        },
        endsAt: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "timetz",
            precision: 4,
          },
        },
        duration: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "interval",
            precision: 1,
          },
        },
        preciseDuration: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            intervalQualifier: "day to second" as const,
            name: "interval",
            precision: 3,
          },
        },
        hourMinuteDuration: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            intervalQualifier: "hour to minute" as const,
            name: "interval",
          },
        },
      },
      model: "events",
      primaryKey: ["createdAt"],
    },
  };

  const sql = sqlPostgres(events);

  assert.match(sql, /"createdAt" TIMESTAMP\(3\) NOT NULL PRIMARY KEY/);
  assert.match(sql, /"observedAt" TIMESTAMPTZ\(6\) NOT NULL/);
  assert.match(sql, /"startsAt" TIME\(2\) NOT NULL/);
  assert.match(sql, /"endsAt" TIMETZ\(4\) NOT NULL/);
  assert.match(sql, /"duration" INTERVAL\(1\) NOT NULL/);
  assert.match(
    sql,
    /"preciseDuration" INTERVAL DAY TO SECOND\(3\) NOT NULL/
  );
  assert.match(sql, /"hourMinuteDuration" INTERVAL HOUR TO MINUTE NOT NULL/);
  assert.doesNotMatch(sql, /"timestamp"/);
});

test("sqlPostgres preserves quoted and schema-qualified custom native types", () => {
  const users = {
    meta: {
      columns: {
        role: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "AccountStatus",
          },
        },
        auditRole: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: "audit.AccountStatus",
          },
        },
        quotedAuditRole: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 0,
            backend: "postgresql" as const,
            name: '"audit"."AccountStatus"',
          },
        },
        quotedAuditRoleHistory: {
          kind: "string" as const,
          nativeType: {
            arrayDimensions: 1,
            backend: "postgresql" as const,
            name: '"audit"."AccountStatus"',
          },
        },
      },
      model: "users",
      primaryKey: ["role"],
    },
  };

  const sql = sqlPostgres(users);

  assert.match(sql, /"role" "AccountStatus" NOT NULL PRIMARY KEY/);
  assert.match(sql, /"auditRole" "audit"\."AccountStatus" NOT NULL/);
  assert.match(
    sql,
    /"quotedAuditRole" "audit"\."AccountStatus" NOT NULL/
  );
  assert.match(
    sql,
    /"quotedAuditRoleHistory" "audit"\."AccountStatus"\[\] NOT NULL/
  );
  assert.doesNotMatch(sql, /"""audit"""\."""AccountStatus"""/);
});

test("sqlPostgres rejects primary keys that resolve to duplicate physical columns", () => {
  const invalid = {
    meta: {
      columns: {
        id: { columnName: "user_id", kind: "string" as const },
        userId: { columnName: "user_id", kind: "string" as const },
      },
      model: "users",
      primaryKey: ["id", "userId"],
    },
  };

  assert.throws(
    () => sqlPostgres(invalid),
    /map to the same physical column "user_id"/
  );
});

test("sqlPostgres rejects primary keys that reference unknown logical columns", () => {
  const invalid = {
    meta: {
      columns: {
        id: { kind: "string" as const },
      },
      model: "users",
      primaryKey: ["missing"],
    },
  };

  assert.throws(
    () => sqlPostgres(invalid),
    /Primary key logical column "missing" does not exist/
  );
});

test("sqlD1 rejects generated-always primary keys", () => {
  const generated = defineModel({
    meta: {
      columns: {
        id: {
          default: {
            dialect: "d1",
            expression: "lower(source)",
            kind: "sql",
          },
          generationStrategy: { kind: "generated-always" },
          hasDefault: true,
          isGenerated: true,
          kind: "string",
          nullable: false,
        },
      },
      model: "generated_ids",
      primaryKey: ["id"],
    },
  });

  assert.throws(
    () => sqlD1(generated),
    /D1 does not support generated columns in primary keys/
  );
});

test("sqlD1 maps generated number PK to INTEGER PRIMARY KEY AUTOINCREMENT", () => {
  const counters = table("counters")
    .columns({
      id: number().generated(),
      value: number(),
    })
    .primaryKey("id");
  const sql = sqlD1(counters);
  assert.match(sql, /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(sqlPostgres(counters), /"id" BIGSERIAL PRIMARY KEY/);
});

test("sqlD1 stores non-generated bigint columns as TEXT", () => {
  const ledger = table("ledger").columns({
    balance: bigint(),
    id: string(),
  }).primaryKey("id");

  const sql = sqlD1(ledger);

  assert.match(sql, /"balance" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /"balance" INTEGER/);
});

test("sqlD1 rejects generated bigint primary keys without lossless decoding", () => {
  const events = table("events")
    .columns({
      id: bigint().generated(),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlD1(events),
    /D1 cannot generate bigint primary keys without lossless decoding/
  );
});

test("sqlD1 rejects bigint identity primary keys", () => {
  const events = table("events")
    .columns({
      id: bigint().identity("always"),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlD1(events),
    /D1 does not support identity columns/
  );
});

test("sqlD1 rejects bigint identity columns outside primary keys", () => {
  const events = table("events")
    .columns({
      id: string(),
      sequence: bigint().identity("by-default"),
    })
    .primaryKey("id");

  assert.throws(
    () => sqlD1(events),
    /D1 does not support identity columns/
  );
});

test("sqlD1 rejects legacy number identity columns", () => {
  const events = table("events").columns({
    id: number().identity("by-default"),
    label: string(),
  }).primaryKey("id");

  assert.throws(
    () => sqlD1(events),
    /D1 does not support identity columns/
  );
});

test("sqlPostgres preserves PRIMARY KEY for generated integer-width columns", () => {
  const smallItems = table("small_items")
    .columns({
      small_id: smallint().generated(),
    })
    .primaryKey("small_id");
  const integerItems = table("integer_items")
    .columns({
      integer_id: integer().generated(),
    })
    .primaryKey("integer_id");

  const sql = `${sqlPostgres(smallItems)}\n${sqlPostgres(integerItems)}`;

  assert.match(sql, /"small_id" SMALLSERIAL PRIMARY KEY/);
  assert.match(sql, /"integer_id" SERIAL PRIMARY KEY/);
});

test("schema IR preserves generated integer primary-key semantics by width", () => {
  const models = [
    table("small_items")
      .columns({ id: smallint().generated() })
      .primaryKey("id"),
    table("integer_items")
      .columns({ id: integer().generated() })
      .primaryKey("id"),
    table("big_items")
      .columns({ id: bigint().generated() })
      .primaryKey("id"),
  ];

  const tables = schemaIrFromModels(models)
    .databases.flatMap((database) =>
      database.namespaces.flatMap((namespace) => namespace.tables)
    )
    .sort((left, right) =>
      left.identity.physical.name.localeCompare(right.identity.physical.name)
    );

  const columns = tables.map((model) => model.columns[0]);
  assert.deepEqual(columns[0]?.generationStrategy, {
    kind: "none",
  });
  assert.deepEqual(columns[1]?.generationStrategy, {
    kind: "none",
  });
  assert.deepEqual(columns[2]?.generationStrategy, {
    kind: "none",
  });

  assert.deepEqual(
    tables.map((model) =>
      model.columns[0]?.type.kind === "scalar"
        ? model.columns[0].type.semantic
        : undefined
    ),
    ["bigint", "integer", "smallint"]
  );
});

test("schema IR projects generated integer primary keys as non-generated serial columns", () => {
  const models = [
    table("serial_counters")
      .columns({ id: integer().generated() })
      .primaryKey("id"),
  ];

  const ir = schemaIrFromModels(models);
  const column = ir.databases[0]?.namespaces[0]?.tables[0]?.columns[0];
  assert.deepEqual(column?.generationStrategy, { kind: "none" });
  assert.equal(column?.generated, false);

  const intro: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "default",
    generatedAt: "2020-01-01T00:00:00.000Z",
    schemas: {
      public: {
        name: "public",
        tables: {
          serial_counters: {
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "integer",
                defaultExpression:
                  "nextval('serial_counters_id_seq'::regclass)",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "int4",
              },
            },
            name: "serial_counters",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const actual = schemaSnapshotFromIntrospection(intro);
  const desired = schemaSnapshotFromIr(ir);
  const diff = diffSchemas({ from: actual, to: desired });
  assert.equal(
    diff.isEmpty,
    true,
    `expected serial projection to match PostgreSQL introspection, got: ${JSON.stringify(diff.operations)}`
  );
});

test("schema IR preserves bigint semantics for legacy generated number primary keys", () => {
  const models = [
    table("legacy_counters")
      .columns({ id: number().generated() })
      .primaryKey("id"),
  ];

  const column = schemaIrFromModels(models).databases[0]?.namespaces[0]
    ?.tables[0]?.columns[0];

  assert.equal(
    column?.type.kind === "scalar" ? column.type.semantic : undefined,
    "bigint"
  );
});

test("sqlPostgres renders identity columns with their integer SQL widths", () => {
  const identities = table("identities")
    .columns({
      big_id: bigint().identity("always"),
      integer_id: integer().identity("by-default"),
      small_id: smallint().identity("always"),
    })
    .primaryKey("small_id");

  const sql = sqlPostgres(identities);

  assert.match(
    sql,
    /"small_id" SMALLINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY/
  );
  assert.match(
    sql,
    /"integer_id" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL/
  );
  assert.match(sql, /"big_id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL/);
  assert.doesNotMatch(sql, /DOUBLE PRECISION.*IDENTITY/);
});

test("sqlPostgres preserves legacy number identity as BIGINT identity", () => {
  const legacy = table("legacy_identities")
    .columns({
      id: number().identity("always"),
    })
    .primaryKey("id");

  const sql = sqlPostgres(legacy);

  assert.match(
    sql,
    /"id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY/
  );
  assert.doesNotMatch(sql, /DOUBLE PRECISION.*IDENTITY/);
});

test("sqlPostgres preserves legacy number by-default identity semantics", () => {
  const legacy = table("legacy_default_identities")
    .columns({
      id: number().identity("by-default"),
    })
    .primaryKey("id");

  const sql = sqlPostgres(legacy);

  assert.match(
    sql,
    /"id" BIGINT GENERATED BY DEFAULT AS IDENTITY NOT NULL PRIMARY KEY/
  );
  assert.doesNotMatch(sql, /DOUBLE PRECISION.*IDENTITY/);
});

test("identity rejects optional integer builders", () => {
  assert.throws(
    () =>
      table("identities")
        .columns({
          id: integer().optional().identity("always"),
        })
        .primaryKey("id"),
    /Identity columns cannot be nullable/
  );
});

test("sqlPostgres rejects contradictory identity metadata", () => {
  const invalid = {
    meta: {
      columns: {
        id: {
          hasDefault: true,
          identity: "always" as const,
          isGenerated: true,
          kind: "integer" as const,
          nullable: false,
        },
      },
      model: "invalid_identity_state",
      primaryKey: ["id"],
    },
  };

  assert.throws(
    () => sqlPostgres(invalid),
    /cannot also be marked as generated/
  );
});

test("sqlPostgres rejects identity metadata on non-integer columns", () => {
  const invalid = {
    meta: {
      columns: {
        id: {
          hasDefault: true,
          identity: "always" as const,
          isGenerated: false,
          kind: "string" as const,
          nullable: false,
        },
      },
      model: "invalid_identity",
      primaryKey: ["id"],
    },
  };

  assert.throws(
    () => sqlPostgres(invalid),
    /PostgreSQL identity column "id" must use an integer builder/
  );
});

test("registry input emits all tables for both dialects", () => {
  const events = table("events")
    .schema("analytics")
    .columns({ id: string(), name: string() })
    .primaryKey("id");
  const registry = defineRegistry({
    app: {
      schemas: {
        analytics: defineSchema({ events }),
        public: defineSchema({ users }),
      },
    },
  });

  const pg = sqlPostgres(registry);
  assert.match(pg, /"public"\."users"/);
  assert.match(pg, /"analytics"\."events"/);

  const d1 = sqlD1(registry);
  assert.match(d1, /CREATE TABLE IF NOT EXISTS "users"/);
  assert.match(d1, /CREATE TABLE IF NOT EXISTS "events"/);
});

test("modelsToSqlFiles and writeModelSqlFiles produce dialect .sql tree", async () => {
  const files = modelsToSqlFiles(users, { dialects: ["postgres", "d1"] });
  assert.equal(files.length, 2);
  assert.ok(
    files.some((file) => file.filename === "postgres/public/users.sql")
  );
  assert.ok(files.some((file) => file.filename === "d1/public/users.sql"));

  const dir = await mkdtemp(path.join(tmpdir(), "athena-model-sql-"));
  try {
    const written = await writeModelSqlFiles(users, {
      dialects: ["postgres", "d1"],
      outDir: dir,
    });
    assert.equal(written.length, 2);
    const pgPath = path.join(dir, "postgres", "public", "users.sql");
    const d1Path = path.join(dir, "d1", "public", "users.sql");
    const pgBody = await readFile(pgPath, "utf8");
    const d1Body = await readFile(d1Path, "utf8");
    assert.match(pgBody, /"public"\."users"/);
    assert.match(d1Body, /CREATE TABLE IF NOT EXISTS "users"/);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("modelsToSql emits literal defaults without changing non-null row semantics", () => {
  const settings = table("settings")
    .columns({
      enabled: boolean().defaulted(false),
      label: string().defaulted("pending"),
    })
    .primaryKey("label");

  const sql = sqlPostgres(settings);
  assert.match(sql, /"enabled" BOOLEAN DEFAULT FALSE NOT NULL/);
  assert.match(sql, /"label" TEXT DEFAULT 'pending' NOT NULL/);
  assert.equal(settings.schemas.insert.safeParse({}).success, true);
  assert.equal(settings.schemas.row.safeParse({}).success, false);
  assert.deepEqual(settings.meta.columns?.enabled?.default, {
    kind: "literal",
    value: false,
  });
  assert.equal(settings.meta.columns?.enabled?.hasDefault, true);
});

test("sqlD1 preserves normal defaults", () => {
  const settings = table("settings")
    .columns({
      enabled: boolean().defaulted(false),
      label: string().defaulted("pending"),
    })
    .primaryKey("label");

  const sql = sqlD1(settings);

  assert.match(sql, /"enabled" INTEGER DEFAULT FALSE NOT NULL/);
  assert.match(sql, /"label" TEXT DEFAULT 'pending' NOT NULL/);
});

test("modelsToSql emits explicit PostgreSQL SQL defaults", () => {
  const events = table("events")
    .columns({
      created_at: string().defaulted({
        dialect: "postgres",
        expression: "CURRENT_TIMESTAMP",
      }),
    })
    .withoutPrimaryKey();

  const sql = sqlPostgres(events);
  assert.match(sql, /"created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL/);
  assert.deepEqual(events.meta.columns?.created_at?.default, {
    dialect: "postgres",
    expression: "CURRENT_TIMESTAMP",
    kind: "sql",
  });
});

test("modelsToSql preserves nullable null defaults and rejects unknown defaults", () => {
  const nullable = table("nullable_defaults")
    .columns({
      value: string().optional().defaulted(null),
    })
    .withoutPrimaryKey();
  const nullableSql = sqlPostgres(nullable);
  assert.match(nullableSql, /"value" TEXT DEFAULT NULL/);
  assert.doesNotMatch(nullableSql, /"value" TEXT DEFAULT NULL NOT NULL/);
  assert.deepEqual(nullable.meta.columns?.value?.default, {
    kind: "literal",
    value: null,
  });
  assert.equal(nullable.schemas.insert.safeParse({}).success, true);

  assert.throws(
    () => string().defaulted(null),
    /literal null default.*non-nullable/i
  );

  const invalid = defineModel({
    meta: {
      columns: {
        value: {
          default: { kind: "literal", value: null },
          hasDefault: true,
          kind: "string",
          nullable: false,
        },
      },
      model: "invalid_null_default",
      primaryKey: [],
    },
  });
  assert.throws(
    () => sqlPostgres(invalid),
    /literal null default.*non-nullable/
  );

  const legacy = table("legacy_defaults")
    .columns({
      value: string().defaulted(),
    })
    .withoutPrimaryKey();
  assert.throws(() => sqlPostgres(legacy), /unknown database default/);
});
