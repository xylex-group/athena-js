import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  defineAthenaConfig,
  generateArtifactsFromSnapshot,
} from "../src/generator/index.ts";
import { renderNativeTypeDescriptor } from "../src/generator/table-builder-renderer.ts";
import type { IntrospectionSnapshot } from "../src/schema/index.ts";

const snapshot: IntrospectionSnapshot = {
  backend: "postgresql",
  database: "app_db",
  generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
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
            mood: {
              arrayDimensions: 0,
              dataType: "public.mood",
              enumValues: ["happy", "sad"],
              hasDefault: false,
              isGenerated: false,
              isNullable: true,
              isPrimaryKey: false,
              name: "mood",
              typeKind: "enum",
              udtName: "mood",
            },
            "space name": {
              arrayDimensions: 0,
              dataType: "text",
              hasDefault: false,
              isGenerated: false,
              isNullable: true,
              isPrimaryKey: false,
              name: "space name",
              typeKind: "scalar",
              udtName: "text",
            },
            table: {
              arrayDimensions: 0,
              dataType: "text",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "table",
              typeKind: "scalar",
              udtName: "text",
            },
          },
          name: "users",
          primaryKey: ["id"],
          relations: {
            profile: {
              kind: "one-to-one",
              name: "profile_user_fk",
              sourceColumns: ["id"],
              targetColumns: ["user_id"],
              targetModel: "profiles",
              targetSchema: "public",
            },
          },
          schema: "public",
        },
      },
    },
  },
};

const multiSchemaSnapshot: IntrospectionSnapshot = {
  ...snapshot,
  schemas: {
    athena: {
      name: "athena",
      tables: {
        users: {
          columns: {
            event_name: {
              arrayDimensions: 0,
              dataType: "text",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "event_name",
              typeKind: "scalar",
              udtName: "text",
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
          name: "users",
          primaryKey: ["id"],
          relations: {},
          schema: "athena",
        },
      },
    },
    public: snapshot.schemas.public,
  },
};

test("generateArtifactsFromSnapshot renders model/schema/database/registry outputs with placeholder paths", () => {
  const config = defineAthenaConfig({
    features: {
      emitRegistry: true,
      emitRelations: true,
    },
    naming: {
      databaseConst: "camel",
      modelConst: "camel",
      modelType: "pascal",
      registryConst: "camel",
      schemaConst: "camel",
    },
    output: {
      placeholderMap: {
        namespace: "{database_kebab}/{schema_kebab}",
      },
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model:
          "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshot, config);

  assert.equal(artifacts.files.length, 4);
  const paths = artifacts.files.map((file) => file.path);
  assert.equal(
    paths.includes("src/generated/app-db/public/users.model.ts"),
    true
  );
  assert.equal(paths.includes("src/generated/app-db/public/index.ts"), true);
  assert.equal(paths.includes("src/generated/app-db/index.ts"), true);
  assert.equal(paths.includes("src/generated/index.ts"), true);

  const modelFile = artifacts.files.find((file) => file.kind === "model");
  const registryFile = artifacts.files.find((file) => file.kind === "registry");
  assert.ok(modelFile);
  assert.ok(registryFile);
  assert.equal(
    modelFile.content.includes("export const users = table('users')"),
    true
  );
  assert.equal(
    modelFile.content.includes("'space name': string().optional()"),
    true
  );
  assert.equal(
    modelFile.content.includes(
      "mood: enumeration(['happy', 'sad'] as const).optional()"
    ),
    true
  );
  assert.equal(modelFile.content.includes("Object.assign(users.meta, {"), true);
  assert.equal(
    registryFile.content.includes("export const __athena_schema_meta = {"),
    true
  );
  assert.equal(registryFile.content.includes("schemaVersion: 1"), true);
  assert.equal(
    registryFile.content.includes("outputPreset: 'athena-direct'"),
    true
  );
});

test("generated models preserve PostgreSQL default expressions", () => {
  const snapshotWithDefault: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          users: {
            ...snapshot.schemas.public.tables.users,
            columns: {
              ...snapshot.schemas.public.tables.users.columns,
              created_at: {
                arrayDimensions: 0,
                dataType: "timestamp with time zone",
                defaultExpression: "CURRENT_TIMESTAMP",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "created_at",
                typeKind: "scalar",
                udtName: "timestamptz",
              },
            },
          },
        },
      },
    },
  };

  const config = defineAthenaConfig({
    provider: {
      connectionString: "******127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshotWithDefault, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.equal(
    modelFile.content.includes(
      "created_at: string().defaulted({ dialect: 'postgres', expression: 'CURRENT_TIMESTAMP' })"
    ),
    true
  );
});

test("generated models preserve PostgreSQL physical type descriptors", () => {
  const snapshotWithPhysicalTypes: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          users: {
            ...snapshot.schemas.public.tables.users,
            columns: {
              ...snapshot.schemas.public.tables.users.columns,
              ratio: {
                arrayDimensions: 0,
                dataType: "real",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "ratio",
                typeKind: "scalar",
                udtName: "float4",
              },
              username: {
                arrayDimensions: 0,
                dataType: "character varying(42)",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "username",
                typeKind: "scalar",
                udtName: "varchar",
              },
            },
          },
        },
      },
    },
  };

  const config = defineAthenaConfig({
    provider: {
      connectionString: "******127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });
  const artifacts = generateArtifactsFromSnapshot(
    snapshotWithPhysicalTypes,
    config
  );
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.match(
    modelFile.content,
    /ratio: number\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', name: 'float4' \}\)/
  );
  assert.match(
    modelFile.content,
    /username: string\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', length: 42, name: 'varchar' \}\)/
  );
});

test("generated models preserve PostgreSQL BIT and VARBIT lengths", () => {
  const snapshotWithBitTypes: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          users: {
            ...snapshot.schemas.public.tables.users,
            columns: {
              ...snapshot.schemas.public.tables.users.columns,
              fixed_bits: {
                arrayDimensions: 0,
                dataType: "bit(8)",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "fixed_bits",
                typeKind: "scalar",
                udtName: "bit",
              },
              variable_bits: {
                arrayDimensions: 0,
                dataType: "bit varying(17)",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "variable_bits",
                typeKind: "scalar",
                udtName: "varbit",
              },
            },
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(
    snapshotWithBitTypes,
    defineAthenaConfig({
      provider: {
        connectionString: "******127.0.0.1:5432/app_db",
        database: "app_db",
        kind: "postgres",
        mode: "direct",
      },
    })
  );
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.match(
    modelFile.content,
    /fixed_bits: string\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', length: 8, name: 'bit' \}\)/
  );
  assert.match(
    modelFile.content,
    /variable_bits: string\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', length: 17, name: 'varbit' \}\)/
  );
});

test("generated models preserve qualified PostgreSQL interval metadata", () => {
  const descriptor = renderNativeTypeDescriptor({
    arrayDimensions: 0,
    dataType: "interval day to second(3)",
    hasDefault: false,
    isGenerated: false,
    isNullable: false,
    isPrimaryKey: false,
    name: "duration",
    typeKind: "scalar",
    udtName: "interval",
  });

  assert.match(
    descriptor,
    /intervalQualifier: 'day to second', name: 'interval', precision: 3/
  );
});

test("generated models preserve quoted and schema-qualified custom PostgreSQL types", () => {
  const snapshotWithCustomTypes: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          users: {
            ...snapshot.schemas.public.tables.users,
            columns: {
              ...snapshot.schemas.public.tables.users.columns,
              role: {
                arrayDimensions: 0,
                dataType: "AccountStatus",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "role",
                typeKind: "scalar",
                udtName: "AccountStatus",
              },
              auditRole: {
                arrayDimensions: 0,
                dataType: '"audit"."AccountStatus"',
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "auditRole",
                typeKind: "scalar",
                udtName: "audit.AccountStatus",
              },
            },
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(
    snapshotWithCustomTypes,
    defineAthenaConfig({
      provider: {
        connectionString: "******127.0.0.1:5432/app_db",
        database: "app_db",
        kind: "postgres",
        mode: "direct",
      },
    })
  );
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.match(
    modelFile.content,
    /role: string\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', name: 'AccountStatus' \}\)/
  );
  assert.match(
    modelFile.content,
    /auditRole: string\(\)\.nativeType\(\{ arrayDimensions: 0, backend: 'postgresql', name: '"audit"\."AccountStatus"' \}\)/
  );
});

test("native PostgreSQL arrays use catalog dimensions when formatted type has one array suffix", () => {
  const descriptor = renderNativeTypeDescriptor({
    arrayDimensions: 2,
    dataType: "integer[]",
    hasDefault: false,
    isGenerated: false,
    isNullable: false,
    isPrimaryKey: false,
    name: "matrix",
    typeKind: "scalar",
    udtName: "_int4",
  });

  assert.match(descriptor, /arrayDimensions: 2/);
  assert.match(descriptor, /name: 'int4'/);
});

test("generated define-model metadata preserves defaults and generation semantics", () => {
  const metadataSnapshot: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          generated_metadata: {
            columns: {
              created_at: {
                arrayDimensions: 0,
                dataType: "timestamp with time zone",
                defaultExpression: "CURRENT_TIMESTAMP",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "created_at",
                typeKind: "scalar",
                udtName: "timestamptz",
              },
              id: {
                arrayDimensions: 0,
                dataType: "integer",
                hasDefault: false,
                identity: "always",
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "int4",
              },
              total: {
                arrayDimensions: 0,
                dataType: "integer",
                hasDefault: false,
                isGenerated: true,
                isNullable: false,
                isPrimaryKey: false,
                name: "total",
                typeKind: "scalar",
                udtName: "int4",
              },
            },
            name: "generated_metadata",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(
    metadataSnapshot,
    defineAthenaConfig({
      output: {
        format: "define-model",
      },
      provider: {
        connectionString: "******127.0.0.1:5432/app_db",
        database: "app_db",
        kind: "postgres",
        mode: "direct",
      },
    })
  );
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.match(
    modelFile.content,
    /created_at: \{.*default: \{ kind: 'sql', dialect: 'postgres', expression: 'CURRENT_TIMESTAMP' \}, hasDefault: true \}/
  );
  assert.match(
    modelFile.content,
    /id: \{.*identity: 'always', generationStrategy: \{ kind: 'identity', mode: 'always' \} \}/
  );
  assert.match(
    modelFile.content,
    /total: \{.*isGenerated: true, generationStrategy: \{ kind: 'generated-always' \} \}/
  );
});

test("generateArtifactsFromSnapshot preserves integer widths for identity columns", () => {
  const identitySnapshot: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          identities: {
            columns: {
              big_id: {
                arrayDimensions: 0,
                dataType: "bigint",
                hasDefault: false,
                identity: "always",
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "big_id",
                typeKind: "scalar",
                udtName: "int8",
              },
              integer_id: {
                arrayDimensions: 0,
                dataType: "integer",
                hasDefault: false,
                identity: "by-default",
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "integer_id",
                typeKind: "scalar",
                udtName: "int4",
              },
              small_id: {
                arrayDimensions: 0,
                dataType: "smallint",
                hasDefault: false,
                identity: "always",
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "small_id",
                typeKind: "scalar",
                udtName: "int2",
              },
            },
            name: "identities",
            primaryKey: ["integer_id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };
  const config = defineAthenaConfig({
    provider: {
      connectionString: "******127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  const artifacts = generateArtifactsFromSnapshot(identitySnapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");

  assert.ok(modelFile);
  assert.match(modelFile.content, /big_id: bigint\(\)\.identity\("always"\)/);
  assert.match(
    modelFile.content,
    /integer_id: integer\(\)\.identity\("by-default"\)/
  );
  assert.match(modelFile.content, /small_id: smallint\(\)\.identity\("always"\)/);
  assert.doesNotMatch(modelFile.content, /number\(\)\.identity/);
});

test("generateArtifactsFromSnapshot rejects nullable identity columns", () => {
  const invalidSnapshot: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        ...snapshot.schemas.public,
        tables: {
          identities: {
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "integer",
                hasDefault: false,
                identity: "always",
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "int4",
              },
            },
            name: "identities",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const config = defineAthenaConfig({
    provider: {
      connectionString: "******127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  assert.throws(
    () => generateArtifactsFromSnapshot(invalidSnapshot, config),
    /must be non-nullable/
  );
});

test("registry provenance is deterministic and identifies the inspected schema", () => {
  const config = defineAthenaConfig({
    features: {
      emitRegistry: true,
    },
    provider: {
      connectionString: "******127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  const first = generateArtifactsFromSnapshot(snapshot, config);
  const second = generateArtifactsFromSnapshot(
    { ...snapshot, generatedAt: "2026-05-16T00:00:00.000Z" },
    config
  );
  const firstRegistry = first.files.find((file) => file.kind === "registry");
  const secondRegistry = second.files.find((file) => file.kind === "registry");

  assert.ok(firstRegistry);
  assert.ok(secondRegistry);
  assert.equal(firstRegistry.content, secondRegistry.content);
  assert.equal(firstRegistry.content.includes("generatedAt:"), false);
  assert.match(firstRegistry.content, /schemaFingerprint: '[0-9a-f]{64}'/);
  assert.equal(
    firstRegistry.content.includes("schemaSource: 'postgres:app_db'"),
    true
  );
  assert.equal(firstRegistry.content.includes("generatorVersion:"), true);
  assert.equal(firstRegistry.content.includes("generationFormatVersion:"), true);
});

test("generateArtifactsFromSnapshot can disable registry emission with feature flags", () => {
  const config = defineAthenaConfig({
    features: {
      emitRegistry: false,
    },
    output: {
      targets: {
        database: "src/generated/{database}/index.ts",
        model: "src/generated/{database}/{schema}/{model}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database}/{schema}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshot, config);
  assert.equal(
    artifacts.files.some((file) => file.kind === "registry"),
    false
  );
});

test("generateArtifactsFromSnapshot default targets are safe for multiple schemas with shared table names", () => {
  const config = defineAthenaConfig({
    output: {},
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public", "athena"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
  const paths = artifacts.files.map((file) => file.path);

  assert.equal(paths.includes("athena/generated/models/public/users.ts"), true);
  assert.equal(paths.includes("athena/generated/models/athena/users.ts"), true);
  assert.equal(paths.includes("athena/generated/schema/public.ts"), true);
  assert.equal(paths.includes("athena/generated/schema/athena.ts"), true);
  assert.equal(paths.includes("athena/generated/relations.ts"), true);
  assert.equal(paths.includes("athena/generated/registry.ts"), true);
});

test("generateArtifactsFromSnapshot auto-scopes colliding multi-schema output paths", () => {
  const config = defineAthenaConfig({
    output: {
      targets: {
        database: "athena/generated/relations.ts",
        model: "athena/generated/models/{model_kebab}.ts",
        registry: "athena/config.ts",
        schema: "athena/schema.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public", "athena"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
  const paths = artifacts.files.map((file) => file.path);

  assert.equal(paths.includes("athena/generated/models/public/users.ts"), true);
  assert.equal(paths.includes("athena/generated/models/athena/users.ts"), true);
  assert.equal(paths.includes("athena/public/schema.ts"), true);
  assert.equal(paths.includes("athena/athena/schema.ts"), true);
});

test("generateArtifactsFromSnapshot keeps built-in placeholders stable when placeholderMap redefines schema/model keys", () => {
  const config = defineAthenaConfig({
    output: {
      placeholderMap: {
        model: "model",
        namespace: "athena",
        schema: "schema",
      },
      targets: {
        database: "athena/{schema}/relations.ts",
        model: "athena/generated/models/{schema}/{model_kebab}.ts",
        registry: "athena/{schema}/config.ts",
        schema: "athena/{schema}/schema.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public", "athena"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
  const paths = artifacts.files.map((file) => file.path);

  assert.equal(paths.includes("athena/generated/models/public/users.ts"), true);
  assert.equal(paths.includes("athena/generated/models/athena/users.ts"), true);
  assert.equal(paths.includes("athena/public/schema.ts"), true);
  assert.equal(paths.includes("athena/athena/schema.ts"), true);
  assert.equal(
    paths.some((path) => path.startsWith("athena/generated/models/schema/")),
    false
  );
});

test("generateArtifactsFromSnapshot can render the zero-style table builder format", () => {
  const config = defineAthenaConfig({
    features: {
      emitRegistry: true,
      emitRelations: true,
    },
    output: {
      format: "table-builder",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  const registryFile = artifacts.files.find((file) => file.kind === "registry");
  assert.ok(modelFile);
  assert.ok(registryFile);
  assert.equal(
    modelFile.content.includes("export const users = table('users')"),
    true
  );
  assert.equal(modelFile.content.includes(".schema('public')"), true);
  assert.equal(
    modelFile.content.includes("'space name': string().optional()"),
    true
  );
  assert.equal(
    modelFile.content.includes(
      "mood: enumeration(['happy', 'sad'] as const).optional()"
    ),
    true
  );
  assert.equal(modelFile.content.includes("Object.assign(users.meta, {"), true);
  assert.equal(
    modelFile.content.includes(
      "export const users_row_schema = users.schemas.row"
    ),
    true
  );
  assert.equal(
    modelFile.content.includes(
      "export type PublicUsersFormValues = FormValuesOf<typeof users>"
    ),
    true
  );
  assert.equal(
    registryFile.content.includes("outputPreset: 'athena-direct'"),
    true
  );
  assert.equal(
    registryFile.content.includes("outputFormat: 'table-builder'"),
    true
  );
});

test("generateArtifactsFromSnapshot renders withoutPrimaryKey for tables without a primary key", () => {
  const config = defineAthenaConfig({
    output: {
      format: "table-builder",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["athena"],
    },
  });

  const noPrimaryKeySnapshot: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "app_db",
    generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
    schemas: {
      athena: {
        name: "athena",
        tables: {
          account: {
            columns: {
              id: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "id",
                typeKind: "scalar",
                udtName: "text",
              },
              user_id: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "user_id",
                typeKind: "scalar",
                udtName: "text",
              },
            },
            name: "account",
            primaryKey: [],
            relations: {},
            schema: "athena",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(noPrimaryKeySnapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);
  assert.equal(modelFile.content.includes(".withoutPrimaryKey()"), true);
});

test("generateArtifactsFromSnapshot table-builder maps column helpers and modifiers", () => {
  const config = defineAthenaConfig({
    output: {
      format: "table-builder",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const matrixSnapshot: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "app_db",
    generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
    schemas: {
      public: {
        name: "public",
        tables: {
          samples: {
            columns: {
              count: {
                arrayDimensions: 0,
                dataType: "integer",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "count",
                typeKind: "scalar",
                udtName: "int4",
              },
              full_name: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: true,
                isNullable: false,
                isPrimaryKey: false,
                name: "full_name",
                typeKind: "scalar",
                udtName: "text",
              },
              id: {
                arrayDimensions: 0,
                dataType: "uuid",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "id",
                typeKind: "scalar",
                udtName: "uuid",
              },
              is_active: {
                arrayDimensions: 0,
                dataType: "boolean",
                hasDefault: true,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "is_active",
                typeKind: "scalar",
                udtName: "bool",
              },
              metrics: {
                arrayDimensions: 0,
                dataType: "jsonb",
                hasDefault: false,
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: false,
                name: "metrics",
                typeKind: "scalar",
                udtName: "jsonb",
              },
              mood: {
                arrayDimensions: 0,
                dataType: "public.mood",
                enumValues: ["happy", "sad"],
                hasDefault: false,
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: false,
                name: "mood",
                typeKind: "enum",
                udtName: "mood",
              },
              table: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "table",
                typeKind: "scalar",
                udtName: "text",
              },
              tags: {
                arrayDimensions: 1,
                dataType: "text[]",
                hasDefault: false,
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: false,
                name: "tags",
                typeKind: "scalar",
                udtName: "_text",
              },
            },
            name: "samples",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(matrixSnapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);

  assert.equal(
    modelFile.content.includes("export const samples = table('samples')"),
    true
  );
  assert.equal(modelFile.content.includes("id: string().defaulted()"), true);
  assert.equal(modelFile.content.includes("count: integer()"), true);
  assert.equal(
    modelFile.content.includes("is_active: boolean().defaulted()"),
    true
  );
  assert.equal(
    modelFile.content.includes(
      "metrics: json<unknown>().optional()"
    ),
    true
  );
  assert.equal(
    modelFile.content.includes("tags: json<Array<string>>().optional()"),
    true
  );
  assert.match(
    modelFile.content,
    /tags: json<Array<string>>\(\)\.optional\(\)\.nativeType\(\{ arrayDimensions: 1,/
  );
  assert.equal(
    modelFile.content.includes("full_name: string().generated()"),
    true
  );
  assert.equal(
    modelFile.content.includes(
      "mood: enumeration(['happy', 'sad'] as const).optional()"
    ),
    true
  );
  assert.equal(modelFile.content.includes("table: string()"), true);
  assert.equal(
    modelFile.content.includes(
      "import { boolean, enumeration, integer, json, string, table } from"
    ),
    true
  );
});

test("generateArtifactsFromSnapshot define-model format emits interfaces and defineModel metadata", () => {
  const config = defineAthenaConfig({
    features: {
      emitRegistry: true,
      emitRelations: true,
    },
    output: {
      format: "define-model",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model:
          "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const defineModelSnapshot: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "app_db",
    generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
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
              metrics: {
                arrayDimensions: 0,
                dataType: "jsonb",
                hasDefault: false,
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: false,
                name: "metrics",
                typeKind: "scalar",
                udtName: "jsonb",
              },
              ratio: {
                arrayDimensions: 0,
                dataType: "real",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "ratio",
                typeKind: "scalar",
                udtName: "float4",
              },
              table: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "table",
                typeKind: "scalar",
                udtName: "text",
              },
              username: {
                arrayDimensions: 0,
                dataType: "character varying(42)",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "username",
                typeKind: "scalar",
                udtName: "varchar",
              },
            },
            name: "users",
            primaryKey: ["id"],
            relations: {
              profile: {
                kind: "one-to-one",
                name: "profile_user_fk",
                sourceColumns: ["id"],
                targetColumns: ["user_id"],
                targetModel: "profiles",
                targetSchema: "public",
              },
            },
            schema: "public",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(defineModelSnapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  const registryFile = artifacts.files.find((file) => file.kind === "registry");
  assert.ok(modelFile);
  assert.ok(registryFile);

  assert.equal(
    modelFile.content.includes(
      "import { defineModel } from '@xylex-group/athena'"
    ),
    true
  );
  assert.equal(
    modelFile.content.includes("export interface PublicUsersRow {"),
    true
  );
  assert.equal(modelFile.content.includes("id: string"), true);
  assert.equal(
    modelFile.content.includes("metrics?: unknown | null"),
    true
  );
  assert.equal(modelFile.content.includes("table: string"), true);
  assert.match(
    modelFile.content,
    /ratio: \{ kind: 'number', nativeType: \{ arrayDimensions: 0, backend: 'postgresql', name: 'float4' \}, nullable: false \}/
  );
  assert.match(
    modelFile.content,
    /username: \{ kind: 'string', nativeType: \{ arrayDimensions: 0, backend: 'postgresql', length: 42, name: 'varchar' \}, nullable: false \}/
  );
  assert.equal(
    modelFile.content.includes("export const publicUsersModel = defineModel<"),
    true
  );
  assert.equal(modelFile.content.includes("relations:"), true);
  assert.equal(
    registryFile.content.includes("outputFormat: 'define-model'"),
    true
  );
  assert.equal(
    modelFile.content.includes("export const users = table('users')"),
    false
  );
});

test("generateArtifactsFromSnapshot wires schema, database, and registry assembly graph", () => {
  const config = defineAthenaConfig({
    output: {
      format: "table-builder",
      preset: "athena-direct",
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  const schemaFile = artifacts.files.find((file) => file.kind === "schema");
  const databaseFile = artifacts.files.find((file) => file.kind === "database");
  const registryFile = artifacts.files.find((file) => file.kind === "registry");

  assert.ok(modelFile);
  assert.ok(schemaFile);
  assert.ok(databaseFile);
  assert.ok(registryFile);

  assert.equal(modelFile.path, "athena/generated/models/public/users.ts");
  assert.equal(schemaFile.path, "athena/generated/schema/public.ts");
  assert.equal(databaseFile.path, "athena/generated/relations.ts");
  assert.equal(registryFile.path, "athena/generated/registry.ts");

  assert.equal(
    schemaFile.content.includes(
      "import { users } from '../models/public/users'"
    ),
    true
  );
  assert.equal(
    schemaFile.content.includes("export const publicSchema = defineSchema({"),
    true
  );
  assert.equal(schemaFile.content.includes("  users,"), true);
  assert.equal(schemaFile.content.includes("  users: users"), false);

  assert.equal(
    databaseFile.content.includes(
      "import { publicSchema } from './schema/public'"
    ),
    true
  );
  assert.equal(
    databaseFile.content.includes(
      "export const appDbDatabase = defineDatabase({"
    ),
    true
  );
  assert.equal(databaseFile.content.includes("  public: publicSchema"), true);
  assert.equal(databaseFile.content.includes("'public':"), false);

  assert.equal(
    registryFile.content.includes(
      "import { appDbDatabase } from './relations'"
    ),
    true
  );
  assert.equal(
    registryFile.content.includes("export const registry = defineRegistry({"),
    true
  );
  assert.equal(registryFile.content.includes("  app_db: appDbDatabase"), true);
  assert.equal(
    registryFile.content.includes("outputPreset: 'athena-direct'"),
    true
  );
  assert.equal(
    registryFile.content.includes("outputFormat: 'table-builder'"),
    true
  );
});

test("generateArtifactsFromSnapshot renders composite primary keys and stacked column modifiers", () => {
  const config = defineAthenaConfig({
    output: {
      format: "table-builder",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const compositeSnapshot: IntrospectionSnapshot = {
    backend: "postgresql",
    database: "app_db",
    generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
    schemas: {
      public: {
        name: "public",
        tables: {
          memberships: {
            columns: {
              display_name: {
                arrayDimensions: 0,
                dataType: "text",
                hasDefault: false,
                isGenerated: true,
                isNullable: true,
                isPrimaryKey: false,
                name: "display_name",
                typeKind: "scalar",
                udtName: "text",
              },
              external_id: {
                arrayDimensions: 0,
                dataType: "bigint",
                hasDefault: true,
                isGenerated: false,
                isNullable: true,
                isPrimaryKey: false,
                name: "external_id",
                typeKind: "scalar",
                udtName: "int8",
              },
              org_id: {
                arrayDimensions: 0,
                dataType: "uuid",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: true,
                name: "org_id",
                typeKind: "scalar",
                udtName: "uuid",
              },
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
            name: "memberships",
            primaryKey: ["org_id", "user_id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(compositeSnapshot, config);
  const modelFile = artifacts.files.find((file) => file.kind === "model");
  assert.ok(modelFile);

  assert.equal(
    modelFile.content.includes(".primaryKey('org_id', 'user_id')"),
    true
  );
  // bigint preserves PostgreSQL integer width and string precision semantics
  assert.equal(
    modelFile.content.includes("external_id: bigint().optional().defaulted()"),
    true
  );
  assert.equal(
    modelFile.content.includes("display_name: string().optional().generated()"),
    true
  );
  assert.equal(modelFile.content.includes("external_id: number()"), false);
});

test("generateArtifactsFromSnapshot legacy preset writes N-1 root athena/* layout", () => {
  const config = defineAthenaConfig({
    output: {
      format: "table-builder",
      preset: "legacy",
    },
    provider: {
      connectionString: "postgres://127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const artifacts = generateArtifactsFromSnapshot(snapshot, config);
  const paths = artifacts.files.map((file) => file.path);
  const registryFile = artifacts.files.find((file) => file.kind === "registry");

  assert.equal(paths.includes("athena/models/public/users.ts"), true);
  assert.equal(paths.includes("athena/schemas/public.ts"), true);
  assert.equal(paths.includes("athena/relations.ts"), true);
  assert.equal(paths.includes("athena/registry.generated.ts"), true);
  assert.equal(paths.includes("athena/generated/registry.ts"), false);
  assert.ok(registryFile);
  assert.equal(registryFile.content.includes("outputPreset: 'legacy'"), true);
  assert.equal(registryFile.content.includes("@generated"), true);
  assert.equal(registryFile.content.includes("Generated by Athena"), true);
  assert.equal(registryFile.content.split("Generated by Athena").length - 1, 1);
});

test("generateArtifactsFromSnapshot applies naming styles to generated type and const identifiers", () => {
  const tableBuilderConfig = defineAthenaConfig({
    naming: {
      databaseConst: "snake",
      modelType: "snake",
      registryConst: "snake",
      schemaConst: "snake",
    },
    output: {
      format: "table-builder",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const tableBuilderArtifacts = generateArtifactsFromSnapshot(
    snapshot,
    tableBuilderConfig
  );
  const tableBuilderModel = tableBuilderArtifacts.files.find(
    (file) => file.kind === "model"
  );
  const tableBuilderSchema = tableBuilderArtifacts.files.find(
    (file) => file.kind === "schema"
  );
  const tableBuilderDatabase = tableBuilderArtifacts.files.find(
    (file) => file.kind === "database"
  );
  const tableBuilderRegistry = tableBuilderArtifacts.files.find(
    (file) => file.kind === "registry"
  );
  assert.ok(tableBuilderModel);
  assert.ok(tableBuilderSchema);
  assert.ok(tableBuilderDatabase);
  assert.ok(tableBuilderRegistry);

  // table() const stays table-name based; exported types follow modelType
  assert.equal(
    tableBuilderModel.content.includes(
      "export type public_usersRow = RowOf<typeof users>"
    ),
    true
  );
  assert.equal(
    tableBuilderModel.content.includes("export type PublicUsersRow ="),
    false
  );
  assert.equal(
    tableBuilderSchema.content.includes(
      "export const public_schema = defineSchema({"
    ),
    true
  );
  assert.equal(
    tableBuilderDatabase.content.includes(
      "export const app_db_database = defineDatabase({"
    ),
    true
  );
  // registry const is always derived from the literal "registry" + naming style
  assert.equal(
    tableBuilderRegistry.content.includes(
      "export const registry = defineRegistry({"
    ),
    true
  );

  const defineModelConfig = defineAthenaConfig({
    naming: {
      modelConst: "snake",
      modelType: "snake",
    },
    output: {
      format: "define-model",
      targets: {
        database: "src/generated/{database_kebab}/index.ts",
        model:
          "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
        registry: "src/generated/index.ts",
        schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  });

  const defineModelArtifacts = generateArtifactsFromSnapshot(
    snapshot,
    defineModelConfig
  );
  const defineModelFile = defineModelArtifacts.files.find(
    (file) => file.kind === "model"
  );
  assert.ok(defineModelFile);
  assert.equal(
    defineModelFile.content.includes("export interface public_usersRow {"),
    true
  );
  assert.equal(
    defineModelFile.content.includes(
      "export const public_users_model = defineModel<"
    ),
    true
  );
});
