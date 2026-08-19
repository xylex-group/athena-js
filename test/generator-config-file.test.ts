import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  detectGeneratorProviderMode,
  ensureGeneratorConfigFile,
  formatSchemaFallbackMessages,
  mergeSchemaSelections,
  normalizeDiscoveredSchemas,
  patchSchemasInConfigSource,
  renderGeneratorConfigFile,
  resolveGeneratorDatabaseAuthority,
  schemasEqual,
} from "../src/generator/index.ts";
import type { GeneratorProviderConfig } from "../src/generator/types.ts";

test("renderGeneratorConfigFile emits modern direct template with generatorEnv secrets", () => {
  const content = renderGeneratorConfigFile({
    mode: "direct",
    schemas: ["public", "athena", "forms"],
  });

  assert.equal(content.includes("defineAthenaConfig"), true);
  assert.equal(content.includes('generatorEnv("DATABASE_URL")'), true);
  assert.equal(content.includes('mode: "direct"'), true);
  assert.equal(content.includes('preset: "athena-direct"'), true);
  assert.equal(content.includes('format: "table-builder"'), true);
  assert.equal(content.includes("src/lib/athena/generated/registry.ts"), true);
  assert.equal(content.includes('"public"'), true);
  assert.equal(content.includes('"forms"'), true);
  assert.equal(content.includes("postgresGatewayIntrospection: false"), true);
});

test("renderGeneratorConfigFile emits gateway template with url/key generatorEnv bindings", () => {
  const content = renderGeneratorConfigFile({
    mode: "gateway",
    schemas: ["public", "billing"],
  });

  assert.equal(content.includes('mode: "gateway"'), true);
  assert.equal(content.includes('generatorEnv("ATHENA_URL")'), true);
  assert.equal(content.includes('generatorEnv("ATHENA_API_KEY")'), true);
  assert.equal(content.includes('generatorEnv("ATHENA_CLIENT"'), true);
  assert.equal(content.includes('"billing"'), true);
  assert.equal(content.includes("DATABASE_URL"), false);
});

test("patchSchemasInConfigSource updates literal schemas arrays surgically", () => {
  const source = `export default {
  provider: {
    kind: "postgres",
    mode: "direct",
    schemas: ["public"],
  },
}
`;
  const patched = patchSchemasInConfigSource(source, [
    "public",
    "athena",
    "forms",
  ]);
  assert.ok(patched);
  assert.equal(
    patched.includes('schemas: ["public", "athena", "forms"]'),
    true
  );
  assert.equal(patched.includes('mode: "direct"'), true);
});

test("patchSchemasInConfigSource updates generatorEnv.list defaults without removing env ownership", () => {
  const source = `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena"

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", { default: ["public"] }),
  },
})
`;
  const patched = patchSchemasInConfigSource(source, ["public", "athena"]);
  assert.ok(patched);
  assert.equal(
    patched.includes(
      'schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", { default: ["public", "athena"] })'
    ),
    true
  );
  assert.equal(patched.includes('generatorEnv("DATABASE_URL")'), true);
});

test("patchSchemasInConfigSource injects schemas when missing", () => {
  const source = `export default {
  provider: {
    kind: "postgres",
    mode: "gateway",
    gatewayUrl: "https://example.com",
  },
}
`;
  const patched = patchSchemasInConfigSource(source, ["public", "billing"]);
  assert.ok(patched);
  assert.equal(patched.includes('mode: "gateway",'), true);
  assert.equal(patched.includes('schemas: ["public", "billing"]'), true);
});

test("mergeSchemaSelections and schemasEqual preserve user intent", () => {
  assert.deepEqual(
    mergeSchemaSelections(["public", "custom"], ["public", "athena"]),
    ["public", "custom", "athena"]
  );
  assert.equal(schemasEqual(["athena", "public"], ["public", "athena"]), true);
  assert.equal(schemasEqual(["public"], ["public", "athena"]), false);
  assert.deepEqual(
    normalizeDiscoveredSchemas(["public", "pg_catalog", "pg_toast", "athena"]),
    ["public", "athena"]
  );
});

test("detectGeneratorProviderMode prefers direct connection env over gateway", () => {
  const previous = {
    ATHENA_API_KEY: process.env.ATHENA_API_KEY,
    ATHENA_URL: process.env.ATHENA_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  try {
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.ATHENA_URL = "https://athena.example.com";
    process.env.ATHENA_API_KEY = "secret";
    assert.equal(detectGeneratorProviderMode("auto"), "direct");

    delete process.env.DATABASE_URL;
    assert.equal(detectGeneratorProviderMode("auto"), "gateway");
    assert.equal(detectGeneratorProviderMode("direct"), "direct");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("ensureGeneratorConfigFile creates modern config when missing", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-create-")
  );
  try {
    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: false,
      mode: "direct",
      schemas: ["public", "athena"],
    });

    assert.equal(result.action, "created");
    assert.equal(result.path, "athena.config.ts");
    assert.deepEqual(result.schemas, ["public", "athena"]);

    const content = readFileSync(join(root, "athena.config.ts"), "utf8");
    assert.equal(content.includes("defineAthenaConfig"), true);
    assert.equal(content.includes('mode: "direct"'), true);
    assert.equal(content.includes('"athena"'), true);
    assert.equal(content.includes('preset: "athena-direct"'), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureGeneratorConfigFile creates gateway config when mode is gateway", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-gateway-")
  );
  try {
    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: false,
      mode: "gateway",
      schemas: ["public", "billing"],
    });

    assert.equal(result.action, "created");
    const content = readFileSync(join(root, "athena.config.ts"), "utf8");
    assert.equal(content.includes('mode: "gateway"'), true);
    assert.equal(content.includes('generatorEnv("ATHENA_URL")'), true);
    assert.equal(content.includes('generatorEnv("ATHENA_API_KEY")'), true);
    assert.equal(content.includes('"billing"'), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureGeneratorConfigFile skips write when schemas already match", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-unchanged-")
  );
  try {
    const original = `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena"

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL", { default: "postgres://localhost/db" }),
    schemas: ["public", "athena"],
  },
  output: {
    format: "table-builder",
    preset: "athena-direct",
  },
})
`;
    writeFileSync(join(root, "athena.config.ts"), original, "utf8");

    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: false,
      schemas: ["public", "athena"],
    });

    assert.equal(result.action, "unchanged");
    assert.equal(
      readFileSync(join(root, "athena.config.ts"), "utf8"),
      original
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureGeneratorConfigFile surgically updates schemas without rewriting custom output", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-update-")
  );
  try {
    const original = `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena"

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL", { default: "postgres://localhost/db" }),
    schemas: ["public"],
  },
  output: {
    format: "table-builder",
    preset: "athena-direct",
    targets: {
      model: "custom/models/{model_kebab}.ts",
      schema: "custom/schemas/{schema_kebab}.ts",
      database: "custom/relations.ts",
      registry: "custom/registry.ts",
    },
  },
})
`;
    writeFileSync(join(root, "athena.config.ts"), original, "utf8");

    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: false,
      schemas: ["public", "forms", "billing"],
    });

    assert.equal(result.action, "updated");
    const content = readFileSync(join(root, "athena.config.ts"), "utf8");
    assert.equal(
      content.includes('schemas: ["public", "forms", "billing"]'),
      true
    );
    // Custom targets must not be clobbered.
    assert.equal(content.includes("custom/models/{model_kebab}.ts"), true);
    assert.equal(content.includes("custom/registry.ts"), true);
    assert.equal(content.includes('generatorEnv("DATABASE_URL"'), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureGeneratorConfigFile dry-run does not write files", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-dry-")
  );
  try {
    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: false,
      dryRun: true,
      mode: "direct",
      schemas: ["public"],
    });

    assert.equal(result.action, "created");
    assert.ok(result.content);
    assert.equal(result.content.includes("defineAthenaConfig"), true);

    let exists = true;
    try {
      readFileSync(join(root, "athena.config.ts"), "utf8");
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("formatSchemaFallbackMessages states public is not a live discovery result", () => {
  const lines = formatSchemaFallbackMessages({
    discoveryError: "no PostgreSQL connection could be resolved.",
    expectedLiveSchemas: ["public", "athena"],
    schemas: ["public"],
  });
  const text = lines.join("\n");
  assert.match(text, /Schema discovery unavailable/);
  assert.match(text, /fallback schemas: public/);
  assert.match(text, /NOT discovered from the database/);
  assert.match(text, /athena-js init/);
  assert.match(text, /Expected live schemas may include/);
  assert.match(text, /^\s+athena$/m);
});

test("ensureGeneratorConfigFile marks missing connection as fallback provenance, not discovery", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-fallback-")
  );
  const previous = {
    ATHENA_API_KEY: process.env.ATHENA_API_KEY,
    ATHENA_GENERATOR_PG_URL: process.env.ATHENA_GENERATOR_PG_URL,
    ATHENA_URL: process.env.ATHENA_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    PG_URL: process.env.PG_URL,
    POSTGRESQL_URL: process.env.POSTGRESQL_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };

  try {
    for (const key of Object.keys(previous)) {
      delete process.env[key];
    }

    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: true,
      dryRun: true,
      mode: "direct",
    });

    assert.equal(result.action, "created");
    assert.equal(result.schemaProvenance, "fallback");
    assert.deepEqual(result.schemas, ["public"]);
    assert.ok(result.discoveryError);
    const changesText = result.changes.join("\n");
    assert.match(changesText, /NOT discovered from the database/);
    assert.match(changesText, /fallback schemas: public/);
    assert.match(
      result.content ?? "",
      /schemas:\s*\[\s*\n\s*"public",\s*\n\s*\]/
    );
    assert.doesNotMatch(
      result.content ?? "",
      /schemas:\s*\[[^\]]*"athena"[^\]]*\]/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensureGeneratorConfigFile discovers public+athena via shared authority after migrate-like .env", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-config-ensure-discover-")
  );
  const previous = {
    ATHENA_GENERATOR_PG_URL: process.env.ATHENA_GENERATOR_PG_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    PG_URL: process.env.PG_URL,
    POSTGRESQL_URL: process.env.POSTGRESQL_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };

  try {
    for (const key of Object.keys(previous)) {
      delete process.env[key];
    }

    // Mimic a successful migrate: connection only in project env files, not shell.
    writeFileSync(
      join(root, ".env.local"),
      "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db\n",
      "utf8"
    );

    const result = await ensureGeneratorConfigFile({
      cwd: root,
      discoverSchemas: true,
      discoverSchemasImpl: async (provider: GeneratorProviderConfig) => {
        assert.equal(provider.kind, "postgres");
        assert.equal(provider.mode, "direct");
        if (provider.mode === "direct") {
          assert.match(provider.connectionString, /127\.0\.0\.1:5432\/app_db/);
        }
        return ["public", "athena"];
      },
      dryRun: true,
      mode: "direct",
    });

    assert.equal(result.schemaProvenance, "discovered");
    // Keep discovery order from the catalog seam.
    assert.deepEqual(result.schemas, ["public", "athena"]);
    assert.equal(result.content?.includes('"public"'), true);
    assert.equal(result.content?.includes('"athena"'), true);
    assert.equal(
      result.changes.some((line) => line.startsWith("schemas-discovered:")),
      true
    );
    assert.equal(
      result.changes.some((line) => line.includes("NOT discovered")),
      false
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { force: true, recursive: true });
  }
});

test("resolveGeneratorDatabaseAuthority reuses .env connection the same way migrate does", () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-generator-authority-env-")
  );
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    writeFileSync(
      join(root, ".env"),
      "DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/migrated_db\n",
      "utf8"
    );

    const authority = resolveGeneratorDatabaseAuthority({
      cwd: root,
      mode: "direct",
    });

    try {
      assert.equal(authority.source, "environment-probe");
      assert.equal(authority.mode, "direct");
      assert.equal(authority.provider.kind, "postgres");
      if (authority.provider.kind === "postgres" && authority.provider.mode === "direct") {
        assert.match(
          authority.provider.connectionString,
          /127\.0\.0\.1:5432\/migrated_db/
        );
      }
    } finally {
      authority.restoreEnv();
    }

    assert.equal(process.env.DATABASE_URL, undefined);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    rmSync(root, { force: true, recursive: true });
  }
});
