import { strict as assert } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSchemaGenerator } from "../src/generator/index.ts";
import type {
  IntrospectionInspectOptions,
  SchemaIntrospectionProvider,
} from "../src/schema/index.ts";

function createSnapshotProvider(): SchemaIntrospectionProvider {
  return {
    backend: "postgresql",
    async inspect() {
      return {
        backend: "postgresql",
        database: "phase_two",
        generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
        schemas: {
          public: {
            name: "public",
            tables: {
              users: {
                columns: {
                  email: {
                    arrayDimensions: 0,
                    dataType: "text",
                    hasDefault: false,
                    isGenerated: false,
                    isNullable: false,
                    isPrimaryKey: false,
                    name: "email",
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
                schema: "public",
              },
            },
          },
        },
      };
    },
  };
}

function createGatewayFetchMock() {
  const calls: Array<{ url: string; method: string; query: string }> = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    calls.push({
      method: String(init?.method ?? "GET"),
      query: payload.query,
      url: String(url),
    });

    if (
      payload.query.includes("FROM pg_namespace") &&
      payload.query.includes("AS schema_name") &&
      !payload.query.includes("FROM pg_attribute")
    ) {
      return new Response(
        JSON.stringify({
          data: [{ schema_name: "public" }],
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }

    if (payload.query.includes("FROM pg_attribute")) {
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

    if (
      payload.query.includes("FROM pg_type t") &&
      payload.query.includes("JOIN pg_enum")
    ) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }

    if (payload.query.includes("WHERE con.contype = 'p'")) {
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

    if (payload.query.includes("WHERE con.contype = 'f'")) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }

    if (payload.query.includes("WHERE con.contype = 'u'")) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }

    if (payload.query.includes("FROM pg_index")) {
      return new Response(
        JSON.stringify({ data: [], error: null, status: 200 }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ error: "Unexpected SQL" }), {
      status: 400,
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("runSchemaGenerator loads athena.config.ts and writes generated artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-run-"));
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    });

    assert.equal(result.files.length, 4);
    assert.equal(result.writtenFiles.length, 4);
    assert.deepEqual(result.skippedFiles, []);
    assert.equal(result.config.output.preset, "athena-direct");
    assert.equal(result.config.output.format, "table-builder");

    const modelPath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "public",
      "users.model.ts"
    );
    const content = readFileSync(modelPath, "utf8");
    assert.equal(content.includes("export const users = table('users')"), true);
    assert.equal(content.includes("email: string()"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator supports table-builder output format", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-table-builder-run-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          format: 'table-builder',
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider: createSnapshotProvider(),
    });

    assert.equal(result.files.length, 4);
    assert.deepEqual(result.skippedFiles, []);
    assert.equal(result.config.output.preset, "athena-direct");
    assert.equal(result.config.output.format, "table-builder");
    const modelFile = result.files.find((file) => file.kind === "model");
    const registryFile = result.files.find((file) => file.kind === "registry");
    assert.ok(modelFile);
    assert.ok(registryFile);
    assert.equal(modelFile.path, "src/generated/phase-two/public/users.ts");
    assert.equal(
      modelFile.content.includes("export const users = table('users')"),
      true
    );
    assert.equal(modelFile.content.includes(".schema('public')"), true);
    assert.equal(
      modelFile.content.includes(
        "export const users_insert_schema = users.schemas.insert"
      ),
      true
    );
    assert.equal(registryFile.content.includes("schemaVersion: 1"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator works without a config file when environment defaults are present", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-env-only-run-"));
  const previousValues = new Map<string, string | undefined>([
    ["DATABASE_URL", process.env.DATABASE_URL],
  ]);

  delete process.env.DATABASE_URL;

  try {
    writeFileSync(
      join(root, ".env.local"),
      [
        "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/phase_two",
      ].join("\n"),
      "utf8"
    );

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider: createSnapshotProvider(),
    });

    assert.equal(result.configPath, "[environment defaults]");
    assert.equal(result.config.output.preset, "athena-direct");
    assert.equal(result.files.length, 4);
    assert.equal(result.config.output.format, "table-builder");
    const modelFile = result.files.find((file) => file.kind === "model");
    assert.ok(modelFile);
    assert.equal(modelFile.path, "src/lib/athena/generated/models/public/users.ts");
    assert.equal(
      modelFile.content.includes("export const users = table('users')"),
      true
    );
    assert.equal(modelFile.content.includes(".schema('public')"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("runSchemaGenerator passes normalized multi-schema selection to custom providers", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-schema-selection-")
  );
  const inspectedOptions: IntrospectionInspectOptions[] = [];
  const provider = createSnapshotProvider();
  const recordingProvider: SchemaIntrospectionProvider = {
    backend: provider.backend,
    inspect(options) {
      inspectedOptions.push(options ?? {});
      return provider.inspect(options);
    },
  };

  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ' public, athena, public ',
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider: recordingProvider,
    });

    assert.deepEqual(inspectedOptions[0]?.schemas, ["public", "athena"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator can operate in gateway-only mode without direct pg_url access", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-gateway-run-"));
  const { calls, restore } = createGatewayFetchMock();

  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'gateway',
          gatewayUrl: 'https://athena-db.com',
          apiKey: 'secret',
          database: 'phase_two',
          schemas: ['public'],
        },
        experimental: {
          postgresGatewayIntrospection: true,
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const result = await runSchemaGenerator({ cwd: root });
    assert.equal(result.files.length, 4);
    assert.equal(result.writtenFiles.length, 4);
    // 1 schema-discovery query + 6 catalog introspection queries
    assert.equal(calls.length, 7);
    assert.equal(
      calls.every((call) => call.url.endsWith("/gateway/query")),
      true
    );
    assert.equal(
      calls.every((call) => call.method === "POST"),
      true
    );
    assert.equal(
      calls.some(
        (call) =>
          call.query.includes("AS schema_name") &&
          call.query.includes("pg_namespace")
      ),
      true
    );

    const modelPath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "public",
      "users.model.ts"
    );
    const content = readFileSync(modelPath, "utf8");
    assert.equal(content.includes("export const users = table('users')"), true);
  } finally {
    restore();
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator does not overwrite existing database/registry files but can overwrite model/schema files", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-overwrite-guard-"));
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const modelPath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "public",
      "users.model.ts"
    );
    const schemaPath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "public",
      "index.ts"
    );
    const databasePath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "index.ts"
    );
    const registryPath = join(root, "src", "generated", "index.ts");

    mkdirSync(join(root, "src", "generated", "phase-two", "public"), {
      recursive: true,
    });
    mkdirSync(join(root, "src", "generated", "phase-two"), { recursive: true });
    mkdirSync(join(root, "src", "generated"), { recursive: true });

    writeFileSync(
      modelPath,
      "// existing model that may be overwritten\n",
      "utf8"
    );
    writeFileSync(
      schemaPath,
      "// existing schema that may be overwritten\n",
      "utf8"
    );
    writeFileSync(databasePath, "// keep custom database content\n", "utf8");
    writeFileSync(registryPath, "// keep custom registry content\n", "utf8");

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    });

    const modelContent = readFileSync(modelPath, "utf8");
    const schemaContent = readFileSync(schemaPath, "utf8");
    const databaseContent = readFileSync(databasePath, "utf8");
    const registryContent = readFileSync(registryPath, "utf8");

    assert.equal(
      modelContent.includes("export const users = table('users')"),
      true
    );
    assert.equal(schemaContent.includes("defineSchema({"), true);
    // Unparseable custom stubs stay protected (merge-unparseable).
    assert.equal(databaseContent, "// keep custom database content\n");
    assert.equal(registryContent, "// keep custom registry content\n");

    assert.deepEqual(
      result.writtenFiles.sort((a, b) => String(a).localeCompare(String(b))),
      [
        "src/generated/phase-two/public/index.ts",
        "src/generated/phase-two/public/users.model.ts",
      ]
    );
    assert.equal(result.skippedFiles.length, 2);
    assert.equal(
      result.skippedFiles.every((item) => item.reason === "merge-unparseable"),
      true
    );
    assert.deepEqual(
      result.skippedFiles
        .map((item) => item.path)
        .sort((a, b) => String(a).localeCompare(String(b))),
      ["src/generated/index.ts", "src/generated/phase-two/index.ts"]
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator smart-merges missing schema wiring into existing database/registry files", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-smart-merge-run-"));
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          format: 'table-builder',
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const databasePath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "index.ts"
    );
    const registryPath = join(root, "src", "generated", "index.ts");

    mkdirSync(join(root, "src", "generated", "phase-two", "public"), {
      recursive: true,
    });
    mkdirSync(join(root, "src", "generated"), { recursive: true });

    writeFileSync(
      databasePath,
      `import { defineDatabase } from '@xylex-group/athena'

export const phaseTwoDatabase = defineDatabase({
})

export const handWired = 1
`,
      "utf8"
    );
    writeFileSync(
      registryPath,
      `import { defineRegistry } from '@xylex-group/athena'
import { phaseTwoDatabase } from './phase-two/index'

export const __athena_schema_meta = {
  schemaVersion: 1,
  generatedAt: '2020-01-01T00:00:00.000Z',
  database: 'phase_two',
  outputFormat: 'table-builder',
} as const

export const registry = defineRegistry({
  phase_two: phaseTwoDatabase
})
`,
      "utf8"
    );

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    });

    const databaseContent = readFileSync(databasePath, "utf8");
    const registryContent = readFileSync(registryPath, "utf8");

    assert.equal(databaseContent.includes("publicSchema"), true);
    assert.equal(databaseContent.includes("public: publicSchema"), true);
    assert.equal(databaseContent.includes("export const handWired = 1"), true);
    assert.equal(registryContent.includes("phase_two: phaseTwoDatabase"), true);
    // Meta stays put when already complete and no structural registry adds
    assert.equal(
      registryContent.includes("generatedAt: '2020-01-01T00:00:00.000Z'"),
      true
    );

    const databaseWrite = result.writtenDetails.find(
      (item) => item.path === "src/generated/phase-two/index.ts"
    );
    assert.ok(databaseWrite);
    assert.equal(databaseWrite.reason, "merged");
    assert.equal(
      databaseWrite.preservedCustom?.some((item) => item.includes("handWired")),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator respects artifactWrite skip policy for database/registry", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-generator-skip-policy-run-"));
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          artifactWrite: {
            database: 'skip',
            registry: 'skip',
          },
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      "utf8"
    );

    const databasePath = join(
      root,
      "src",
      "generated",
      "phase-two",
      "index.ts"
    );
    const registryPath = join(root, "src", "generated", "index.ts");
    mkdirSync(join(root, "src", "generated", "phase-two"), { recursive: true });
    mkdirSync(join(root, "src", "generated"), { recursive: true });
    writeFileSync(databasePath, "// keep\n", "utf8");
    writeFileSync(registryPath, "// keep\n", "utf8");

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    });

    assert.equal(readFileSync(databasePath, "utf8"), "// keep\n");
    assert.equal(readFileSync(registryPath, "utf8"), "// keep\n");
    assert.equal(
      result.skippedFiles.filter(
        (item) => item.reason === "protected-existing-file"
      ).length,
      2
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator can filter generated tables down to a smaller surface", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-table-filter-run-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        filter: {
          includeTables: ['users'],
        },
        output: {
          preset: 'athena-direct',
          format: 'table-builder',
        },
      }
      `,
      "utf8"
    );

    const provider: SchemaIntrospectionProvider = {
      backend: "postgresql",
      async inspect() {
        const snapshot = await createSnapshotProvider().inspect();
        snapshot.schemas.public.tables.notifications = {
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
          name: "notifications",
          primaryKey: ["id"],
          relations: {},
          schema: "public",
        };
        return snapshot;
      },
    };

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider,
    });

    const modelPaths = result.files
      .filter((file) => file.kind === "model")
      .map((file) => file.path);
    assert.deepEqual(modelPaths, ["src/lib/athena/generated/models/public/users.ts"]);
    assert.equal(result.config.output.preset, "athena-direct");
    assert.deepEqual(Object.keys(result.snapshot.schemas.public.tables), [
      "users",
    ]);
    assert.equal(
      result.config.output.targets.registry,
      "src/lib/athena/generated/registry.ts"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator can exclude tables from the generated surface", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-table-exclude-run-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        filter: {
          excludeTables: ['notifications', 'public.audit_logs'],
        },
        output: {
          preset: 'athena-direct',
          format: 'table-builder',
        },
      }
      `,
      "utf8"
    );

    const provider: SchemaIntrospectionProvider = {
      backend: "postgresql",
      async inspect() {
        const snapshot = await createSnapshotProvider().inspect();
        snapshot.schemas.public.tables.notifications = {
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
          name: "notifications",
          primaryKey: ["id"],
          relations: {},
          schema: "public",
        };
        snapshot.schemas.public.tables.audit_logs = {
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
          name: "audit_logs",
          primaryKey: ["id"],
          relations: {},
          schema: "public",
        };
        return snapshot;
      },
    };

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider,
    });

    const modelPaths = result.files
      .filter((file) => file.kind === "model")
      .map((file) => file.path);
    assert.deepEqual(modelPaths, ["src/lib/athena/generated/models/public/users.ts"]);
    assert.deepEqual(
      Object.keys(result.snapshot.schemas.public.tables).sort((a, b) =>
        String(a).localeCompare(String(b))
      ),
      ["users"]
    );
    assert.deepEqual(result.config.filter.excludeTables, [
      "notifications",
      "public.audit_logs",
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

function createMultiTableSnapshotProvider(): SchemaIntrospectionProvider {
  return {
    backend: "postgresql",
    async inspect() {
      const snapshot = await createSnapshotProvider().inspect();
      snapshot.schemas.public.tables.notifications = {
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
        name: "notifications",
        primaryKey: ["id"],
        relations: {},
        schema: "public",
      };
      snapshot.schemas.public.tables.audit_logs = {
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
        name: "audit_logs",
        primaryKey: ["id"],
        relations: {},
        schema: "public",
      };
      return snapshot;
    },
  };
}

test("runSchemaGenerator applies includeTables and excludeTables together", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-table-include-exclude-run-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        filter: {
          includeTables: ['users', 'notifications', 'audit_logs'],
          excludeTables: ['public.audit_logs'],
        },
        output: {
          preset: 'athena-direct',
          format: 'table-builder',
        },
      }
      `,
      "utf8"
    );

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider: createMultiTableSnapshotProvider(),
    });

    const modelPaths = result.files
      .filter((file) => file.kind === "model")
      .map((file) => file.path)
      .sort((a, b) => String(a).localeCompare(String(b)));
    assert.deepEqual(modelPaths, [
      "src/lib/athena/generated/models/public/notifications.ts",
      "src/lib/athena/generated/models/public/users.ts",
    ]);
    assert.deepEqual(
      Object.keys(result.snapshot.schemas.public.tables).sort((a, b) =>
        String(a).localeCompare(String(b))
      ),
      ["notifications", "users"]
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator fails when table filters match no tables", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-table-filter-empty-run-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        filter: {
          includeTables: ['does_not_exist'],
        },
        output: {
          preset: 'athena-direct',
          format: 'table-builder',
        },
      }
      `,
      "utf8"
    );

    await assert.rejects(
      () =>
        runSchemaGenerator({
          cwd: root,
          dryRun: true,
          provider: createSnapshotProvider(),
        }),
      /Generator table filters matched no tables.*includeTables=does_not_exist/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("runSchemaGenerator honors schema-qualified includeTables selectors", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-schema-qualified-include-")
  );
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public', 'athena'],
        },
        filter: {
          includeTables: ['public.users'],
        },
        output: {
          preset: 'athena-direct',
          format: 'table-builder',
        },
      }
      `,
      "utf8"
    );

    const provider: SchemaIntrospectionProvider = {
      backend: "postgresql",
      async inspect() {
        return {
          backend: "postgresql",
          database: "phase_two",
          generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
          schemas: {
            athena: {
              name: "athena",
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
                  schema: "athena",
                },
              },
            },
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
      },
    };

    const result = await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider,
    });

    const modelPaths = result.files
      .filter((file) => file.kind === "model")
      .map((file) => file.path);
    assert.deepEqual(modelPaths, ["src/lib/athena/generated/models/public/users.ts"]);
    assert.deepEqual(Object.keys(result.snapshot.schemas), ["public"]);
    assert.deepEqual(Object.keys(result.snapshot.schemas.public.tables), [
      "users",
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
