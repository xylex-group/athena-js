import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateApiKey } from "../src/cli/api-key.ts";
import {
  CLI_COMMAND_CATALOG,
  type CliRuntime,
  parseCommand,
  runCLI,
  usage,
} from "../src/cli/index.ts";
import {
  formatEnvCheckReport,
  validateProjectEnv,
} from "../src/cli/project-env.ts";
import type { NormalizedAthenaGeneratorConfig } from "../src/generator/index.ts";
import { PACKAGE_VERSION } from "../src/sdk-version.ts";

function createNormalizedGeneratorConfig(
  format: "define-model" | "table-builder",
  modelTarget = "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
  registryTarget = "src/lib/athena/generated/registry.ts",
  preset: "legacy" | "athena-direct" = registryTarget.startsWith("athena/")
    ? "legacy"
    : "athena-direct"
): NormalizedAthenaGeneratorConfig {
  const isLegacy = preset === "legacy";
  return {
    experimental: {
      postgresGatewayIntrospection: false,
      scyllaProviderContracts: true,
    },
    features: {
      emitRegistry: true,
      emitRelations: true,
    },
    filter: {
      excludeTables: [],
      includeTables: [],
    },
    internal: {
      schemaVersion: 1,
    },
    migrations: {
      directory: "athena/migrations",
    },
    naming: {
      databaseConst: "camel",
      modelConst: "camel",
      modelType: "pascal",
      registryConst: "camel",
      schemaConst: "camel",
    },
    output: {
      artifactWrite: {
        database: "merge",
        registry: "merge",
      },
      format,
      placeholderMap: {},
      preset,
      targets: {
        database: isLegacy
          ? "athena/relations.ts"
          : "src/lib/athena/generated/relations.ts",
        model: modelTarget,
        registry: registryTarget,
        schema: isLegacy
          ? "athena/schemas/{schema_kebab}.ts"
          : "src/lib/athena/generated/schema/{schema_kebab}.ts",
      },
    },
    provider: {
      connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
      database: "app_db",
      kind: "postgres",
      mode: "direct",
      schemas: ["public"],
    },
  };
}

test("parseCommand supports generate subcommand help flag", () => {
  const parsed = parseCommand(["generate", "--help"]);
  assert.deepEqual(parsed, { command: "help", topic: "generate" });
});

test("parseCommand supports help generate alias", () => {
  const parsed = parseCommand(["help", "generate"]);
  assert.deepEqual(parsed, { command: "help", topic: "generate" });
});

test("parseCommand supports generate write/discover flags", () => {
  assert.deepEqual(parseCommand(["generate", "--dry-run"]), {
    command: "generate",
    configPath: undefined,
    discoverSchemas: true,
    dryRun: true,
    writeConfig: true,
  });
  assert.deepEqual(
    parseCommand(["generate", "--no-write-config", "--no-discover-schemas"]),
    {
      command: "generate",
      configPath: undefined,
      discoverSchemas: false,
      dryRun: false,
      writeConfig: false,
    }
  );
});

test("parseCommand supports init command options", () => {
  assert.deepEqual(
    parseCommand(["init", "--mode", "gateway", "--force", "--dry-run"]),
    {
      command: "init",
      configPath: undefined,
      discoverSchemas: true,
      dryRun: true,
      force: true,
      mode: "gateway",
    }
  );
  assert.deepEqual(parseCommand(["help", "init"]), {
    command: "help",
    topic: "init",
  });
});

test("usage returns generate help text for topic generate", () => {
  const text = usage("generate");
  assert.equal(text.includes("athena-js generate"), true);
  assert.equal(text.includes("-h, --help"), true);
  assert.equal(text.includes("--no-write-config"), true);
  assert.equal(
    text.includes(
      "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db"
    ),
    true
  );
  assert.equal(
    text.includes(
      "env-only gateway mode when ATHENA_URL + ATHENA_API_KEY are present"
    ),
    true
  );
});

test("usage returns init help text for topic init", () => {
  const text = usage("init");
  assert.equal(text.includes("athena-js init"), true);
  assert.equal(text.includes("--mode direct|gateway"), true);
  assert.equal(text.includes("--force"), true);
});

test("runCLI prints generate help output", async () => {
  const logs: string[] = [];
  await runCLI(["generate", "--help"], {
    log: (message) => {
      logs.push(message);
    },
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes("athena-js generate"), true);
  assert.equal(logs[0].includes("--config"), true);
});

test("runCLI init prints ensure result without writing when dry-run", async () => {
  const logs: string[] = [];
  await runCLI(
    ["init", "--dry-run", "--mode", "direct", "--no-discover-schemas"],
    {
      ensureConfig: async () => ({
        absolutePath: "C:/tmp/athena.config.ts",
        action: "created",
        changes: ["created-modern-config"],
        content: "export default {}\n",
        mode: "direct",
        path: "athena.config.ts",
        reason: "config file missing",
        schemaProvenance: "fallback" as const,
        schemas: ["public"],
      }),
      log: (message) => {
        logs.push(message);
      },
    }
  );

  assert.equal(
    logs[0].includes("[dry-run] Config created: athena.config.ts"),
    true
  );
  assert.equal(logs[0].includes("mode=direct"), true);
  assert.equal(
    logs.some((line) => line.includes("created-modern-config")),
    true
  );
});

test("runCLI prints dry-run output for define-model artifacts (athena-direct)", async () => {
  const logs: string[] = [];
  await runCLI(["generate", "--dry-run"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig("define-model"),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [
        {
          content: "",
          kind: "model",
          path: "src/lib/athena/generated/models/public/users.model.ts",
        },
      ],
      skippedFiles: [],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [],
      writtenFiles: [],
    }),
  });

  assert.equal(logs[0].includes("[dry-run] Generated 1 files"), true);
  assert.equal(
    logs[1],
    "[mode] preset=athena-direct format=define-model modelTarget=src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts"
  );
  assert.equal(
    logs[2],
    "[provider] kind=postgres mode=direct database=app_db schemas=public"
  );
  assert.equal(
    logs[3],
    "[targets] schema=src/lib/athena/generated/schema/{schema_kebab}.ts database=src/lib/athena/generated/relations.ts registry=src/lib/athena/generated/registry.ts"
  );
  assert.equal(
    logs[4].includes("Legacy define-model compatibility output is active"),
    true
  );
  assert.equal(
    logs[5].includes(
      "Default generator mode is preset=athena-direct + format=table-builder"
    ),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("Legacy (N-1) preset is active")),
    false
  );
  assert.equal(
    logs.some((line) =>
      line.includes("Registry target is outside src/lib/athena/generated/registry.ts")
    ),
    false
  );
  assert.equal(
    logs[6],
    " - src/lib/athena/generated/models/public/users.model.ts"
  );
});

test("runCLI prints dry-run output for table-builder artifacts (athena-direct)", async () => {
  const logs: string[] = [];
  await runCLI(["generate", "--dry-run"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig("table-builder"),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [
        {
          content: "",
          kind: "model",
          path: "src/lib/athena/generated/models/public/users.ts",
        },
      ],
      skippedFiles: [],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [],
      writtenFiles: [],
    }),
  });

  assert.equal(logs[0].includes("[dry-run] Generated 1 files"), true);
  assert.equal(
    logs[1],
    "[mode] preset=athena-direct format=table-builder modelTarget=src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts"
  );
  assert.equal(
    logs[2],
    "[provider] kind=postgres mode=direct database=app_db schemas=public"
  );
  assert.equal(
    logs[3],
    "[targets] schema=src/lib/athena/generated/schema/{schema_kebab}.ts database=src/lib/athena/generated/relations.ts registry=src/lib/athena/generated/registry.ts"
  );
  assert.equal(
    logs[4].includes(
      "Default generator mode is preset=athena-direct + format=table-builder"
    ),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("Legacy (N-1) preset is active")),
    false
  );
  assert.equal(logs[5], " - src/lib/athena/generated/models/public/users.ts");
});

test("runCLI warns on N-1 legacy preset dry-run", async () => {
  const logs: string[] = [];
  await runCLI(["generate", "--dry-run"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig(
        "table-builder",
        "athena/models/{schema_kebab}/{model_kebab}.ts",
        "athena/registry.generated.ts",
        "legacy"
      ),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [
        {
          content: "",
          kind: "registry",
          path: "athena/registry.generated.ts",
        },
      ],
      skippedFiles: [],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [],
      writtenFiles: [],
    }),
  });

  assert.equal(
    logs.some((line) => line.includes("preset=legacy")),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("Legacy (N-1) preset is active")),
    true
  );
  assert.equal(
    logs.some((line) =>
      line.includes("Registry target is outside src/lib/athena/generated/registry.ts")
    ),
    true
  );
});

test("runCLI prints safer direct registry targets without handwritten-seam warning", async () => {
  const logs: string[] = [];
  await runCLI(["generate", "--dry-run"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig(
        "table-builder",
        "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
        "src/lib/athena/generated/registry.ts"
      ),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [],
      skippedFiles: [],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [],
      writtenFiles: [],
    }),
  });

  assert.equal(
    logs.some((line) =>
      line.includes("Registry target points at athena/config.ts")
    ),
    false
  );
});

test("runCLI prints filter summary when table filters are active", async () => {
  const logs: string[] = [];
  const config = createNormalizedGeneratorConfig("table-builder");
  config.filter = {
    excludeTables: ["public.audit_logs"],
    includeTables: ["users", "public.notifications"],
  };

  await runCLI(["generate", "--dry-run"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config,
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [],
      skippedFiles: [],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [],
      writtenFiles: [],
    }),
  });

  assert.equal(
    logs.some(
      (line) =>
        line ===
        "[filter] include=users,public.notifications exclude=public.audit_logs"
    ),
    true
  );
});

test("runCLI prints protected skip lines for registry/database artifacts", async () => {
  const logs: string[] = [];
  await runCLI(["generate"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig("table-builder"),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [],
      skippedFiles: [
        {
          kind: "registry",
          path: "src/lib/athena/generated/registry.ts",
          reason: "protected-existing-file",
        },
      ],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [
        {
          kind: "model",
          path: "src/lib/athena/generated/models/public/users.ts",
          reason: "created",
        },
      ],
      writtenFiles: ["src/lib/athena/generated/models/public/users.ts"],
    }),
  });

  assert.equal(
    logs.some((line) => line.includes("[skip] src/lib/athena/generated/registry.ts")),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("protected from overwrite")),
    true
  );
});

test("runCLI prints merge lines for database/registry artifacts", async () => {
  const logs: string[] = [];
  await runCLI(["generate"], {
    log: (message) => {
      logs.push(message);
    },
    runGenerator: async () => ({
      config: createNormalizedGeneratorConfig("table-builder"),
      configPath: "C:/tmp/athena.config.ts",
      generatedManifest: {
        config: "athena.config.ts",
        generatorVersion: "4.0.0",
        outputs: [],
      },
      generatedManifestPath: ".athena/generated-manifest.json",
      files: [],
      skippedFiles: [
        {
          kind: "registry",
          path: "src/lib/athena/generated/registry.ts",
          preservedCustom: ["export const extra"],
          reason: "already-current",
        },
      ],
      snapshot: {
        backend: "postgresql",
        database: "app_db",
        generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
        schemas: {},
      },
      writtenDetails: [
        {
          added: ["import billingSchema", "database entry: billing"],
          kind: "database",
          path: "src/lib/athena/generated/relations.ts",
          preservedCustom: ["export const handWired"],
          reason: "merged",
        },
      ],
      writtenFiles: ["src/lib/athena/generated/relations.ts"],
    }),
  });

  assert.equal(
    logs.some((line) => line.includes("[merge] src/lib/athena/generated/relations.ts")),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("billingSchema")),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("[ok] src/lib/athena/generated/registry.ts")),
    true
  );
  assert.equal(
    logs.some((line) => line.includes("non-generated unit")),
    true
  );
});

test("runCLI normalizes postgres missing database errors with actionable guidance", async () => {
  const errors: string[] = [];
  const previousExitCode = process.exitCode;
  const failingGenerator = async () => {
    const error = new Error('database "app_db" does not exist') as Error & {
      code: string;
    };
    error.code = "3D000";
    throw error;
  };

  try {
    await runCLI(["generate", "--config", "./athena.config.ts", "--dry-run"], {
      errorLog: (message) => errors.push(message),
      runGenerator: failingGenerator as NonNullable<CliRuntime["runGenerator"]>,
    });

    assert.equal(process.exitCode, 1);
    assert.equal(
      errors.some((message) =>
        message.includes('PostgreSQL database "app_db" does not exist')
      ),
      true
    );
    assert.equal(
      errors.some((message) => message.includes("provider.connectionString")),
      true
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("parseCommand supports version flags and aliases", () => {
  assert.deepEqual(parseCommand(["--version"]), {
    command: "version",
    short: false,
  });
  assert.deepEqual(parseCommand(["-v"]), {
    command: "version",
    short: false,
  });
  assert.deepEqual(parseCommand(["version"]), {
    command: "version",
    short: false,
  });
  assert.deepEqual(parseCommand(["v"]), {
    command: "version",
    short: false,
  });
  assert.deepEqual(parseCommand(["version", "--short"]), {
    command: "version",
    short: true,
  });
  assert.deepEqual(parseCommand(["help", "version"]), {
    command: "help",
    topic: "version",
  });
});

test("parseCommand supports --commands inventory aliases", () => {
  assert.deepEqual(parseCommand(["--commands"]), {
    command: "commands",
    format: "full",
  });
  assert.deepEqual(parseCommand(["-C"]), {
    command: "commands",
    format: "full",
  });
  assert.deepEqual(parseCommand(["commands", "--json"]), {
    command: "commands",
    format: "json",
  });
  assert.deepEqual(parseCommand(["list-commands", "--plain"]), {
    command: "commands",
    format: "plain",
  });
  assert.deepEqual(parseCommand(["cmds", "--groups"]), {
    command: "commands",
    format: "groups",
  });
  assert.deepEqual(parseCommand(["--list-commands"]), {
    command: "commands",
    format: "full",
  });
  assert.deepEqual(parseCommand(["help", "commands"]), {
    command: "help",
    topic: "commands",
  });
  assert.deepEqual(parseCommand(["commands", "--help"]), {
    command: "help",
    topic: "commands",
  });
});

test("parseCommand supports env check options", () => {
  assert.deepEqual(parseCommand(["env"]), {
    command: "env",
    files: [],
    json: false,
    mode: "auto",
    strict: false,
  });
  assert.deepEqual(
    parseCommand([
      "env",
      "validate",
      "--file",
      ".env.local",
      "--mode",
      "gateway",
      "--strict",
      "--json",
    ]),
    {
      command: "env",
      files: [".env.local"],
      json: true,
      mode: "gateway",
      strict: true,
    }
  );
  assert.deepEqual(parseCommand(["help", "env"]), {
    command: "help",
    topic: "env",
  });
});

test("parseCommand supports api-key generate options", () => {
  assert.deepEqual(parseCommand(["api-key", "generate"]), {
    command: "api-key-generate",
    bytes: 32,
    envFile: undefined,
    envKey: "ATHENA_API_KEY",
    force: false,
    prefix: "ath_",
    write: false,
  });
  assert.deepEqual(
    parseCommand([
      "key",
      "generate",
      "--write",
      "--env-file",
      ".env.local",
      "--bytes",
      "24",
      "--force",
    ]),
    {
      command: "api-key-generate",
      bytes: 24,
      envFile: ".env.local",
      envKey: "ATHENA_API_KEY",
      force: true,
      prefix: "ath_",
      write: true,
    }
  );
  assert.deepEqual(parseCommand(["api-key"]), {
    command: "help",
    topic: "api-key",
  });
});

test("parseCommand supports api-key create/list and rights commands", () => {
  assert.deepEqual(
    parseCommand([
      "api-key",
      "create",
      "--name",
      "analytics",
      "--rights",
      "gateway.query,gateway.read",
      "--client-name",
      "analytics",
      "--write",
    ]),
    {
      command: "api-key-create",
      adminKey: undefined,
      clientName: "analytics",
      description: undefined,
      envFile: undefined,
      envKey: "ATHENA_API_KEY",
      expiresAt: undefined,
      force: false,
      json: false,
      name: "analytics",
      rights: ["gateway.query", "gateway.read"],
      url: undefined,
      write: true,
    }
  );
  assert.deepEqual(parseCommand(["api-key", "list", "--json"]), {
    command: "api-key-list",
    adminKey: undefined,
    json: true,
    url: undefined,
  });
  assert.deepEqual(parseCommand(["rights", "catalog"]), {
    command: "rights-catalog",
    adminKey: undefined,
    json: false,
    url: undefined,
  });
  assert.deepEqual(
    parseCommand([
      "rights",
      "create",
      "--name",
      "gateway.query",
      "--description",
      "Run query",
    ]),
    {
      command: "rights-create",
      adminKey: undefined,
      description: "Run query",
      json: false,
      name: "gateway.query",
      url: undefined,
    }
  );
  assert.deepEqual(parseCommand(["help", "rights"]), {
    command: "help",
    topic: "rights",
  });
});

test("usage documents version, env, api-key, rights, and commands surfaces", () => {
  const root = usage("root");
  assert.equal(root.includes("-v, --version"), true);
  assert.equal(root.includes("-C, --commands"), true);
  assert.equal(root.includes("athena-js env check"), true);
  assert.equal(root.includes("athena-js api-key"), true);
  assert.equal(root.includes("athena-js rights"), true);
  assert.equal(usage("env").includes("--mode auto|direct|gateway"), true);
  assert.equal(usage("api-key").includes("create"), true);
  assert.equal(usage("api-key").includes("/admin/api-keys"), true);
  assert.equal(usage("rights").includes("/admin/rights/catalog"), true);
  assert.equal(usage("version").includes("--version"), true);
  assert.equal(usage("commands").includes("--json"), true);
  assert.equal(usage("commands").includes("--plain"), true);
});

test("runCLI prints package version", async () => {
  const logs: string[] = [];
  await runCLI(["--version"], {
    log: (message) => {
      logs.push(message);
    },
  });
  assert.deepEqual(logs, [`@xylex-group/athena ${PACKAGE_VERSION}`]);

  const shortLogs: string[] = [];
  await runCLI(["version", "--short"], {
    log: (message) => {
      shortLogs.push(message);
    },
  });
  assert.deepEqual(shortLogs, [PACKAGE_VERSION]);
});

test("runCLI prints full command catalog", async () => {
  const logs: string[] = [];
  await runCLI(["--commands"], {
    log: (message) => {
      logs.push(message);
    },
  });
  assert.equal(logs.length, 1);
  const catalog = logs[0] ?? "";
  assert.equal(catalog.includes("athena-js command catalog"), true);
  assert.equal(catalog.includes("api-key create"), true);
  assert.equal(catalog.includes("rights catalog"), true);
  assert.equal(catalog.includes("env check"), true);
  assert.equal(CLI_COMMAND_CATALOG.length > 10, true);

  const jsonLogs: string[] = [];
  await runCLI(["commands", "--json"], {
    log: (message) => {
      jsonLogs.push(message);
    },
  });
  const parsed = JSON.parse(jsonLogs[0] ?? "{}") as {
    count: number;
    commands: Array<{ command: string }>;
  };
  assert.equal(parsed.count, CLI_COMMAND_CATALOG.length);
  assert.equal(
    parsed.commands.some((entry) => entry.command === "generate"),
    true
  );

  const plainLogs: string[] = [];
  await runCLI(["cmds", "--plain"], {
    log: (message) => {
      plainLogs.push(message);
    },
  });
  const plain = plainLogs[0] ?? "";
  assert.equal(plain.includes("generate"), true);
  assert.equal(plain.includes("api-key create"), true);
  assert.equal(plain.includes("migrate status"), true);
});

test("generateApiKey returns prefixed high-entropy secret", () => {
  const first = generateApiKey();
  const second = generateApiKey({ prefix: "", bytes: 16 });
  assert.equal(first.key.startsWith("ath_"), true);
  assert.equal(first.key.length > 20, true);
  assert.equal(second.key.startsWith("ath_"), false);
  assert.notEqual(first.key, second.key);
});

test("validateProjectEnv accepts gateway keys from env map", () => {
  const result = validateProjectEnv({
    cwd: tmpdir(),
    files: [],
    mode: "gateway",
    processEnv: {
      ATHENA_API_KEY: "ath_test_secret_value_001",
      ATHENA_URL: "https://athena.example.com",
    },
  });
  assert.equal(result.resolvedMode, "gateway");
  assert.equal(result.errorCount, 0);
  assert.equal(
    result.checks.some(
      (check) => check.field === "gatewayUrl" && check.severity === "ok"
    ),
    true
  );
  assert.equal(formatEnvCheckReport(result).includes("result: OK"), true);
});

test("validateProjectEnv rejects placeholder URLs and missing direct DB", () => {
  const result = validateProjectEnv({
    cwd: tmpdir(),
    files: [],
    mode: "direct",
    processEnv: {
      ATHENA_URL: "${ATHENA_URL}",
      DATABASE_URL: "",
    },
  });
  assert.equal(result.errorCount > 0, true);
  assert.equal(
    result.checks.some(
      (check) => check.field === "databaseUrl" && check.severity === "error"
    ),
    true
  );
});

test("runCLI env check validates .env.local and sets exit code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-env-"));
  const previousExitCode = process.exitCode;
  try {
    writeFileSync(
      join(dir, ".env.local"),
      [
        "ATHENA_URL=https://gateway.example.com",
        "ATHENA_API_KEY=ath_local_dev_key_123456",
      ].join("\n"),
      "utf8"
    );

    const logs: string[] = [];
    process.exitCode = undefined;
    await runCLI(["env", "check", "--file", ".env.local", "--mode", "gateway"], {
      cwd: dir,
      log: (message) => {
        logs.push(message);
      },
    });

    assert.equal(logs.some((line) => line.includes("result: OK")), true);
    assert.equal(process.exitCode === undefined || process.exitCode === 0, true);

    process.exitCode = undefined;
    const failLogs: string[] = [];
    writeFileSync(join(dir, ".env.bad"), "ATHENA_URL=not-a-url\n", "utf8");
    await runCLI(["env", "check", "--file", ".env.bad", "--mode", "gateway"], {
      cwd: dir,
      log: (message) => {
        failLogs.push(message);
      },
    });
    assert.equal(process.exitCode, 1);
    assert.equal(failLogs.some((line) => line.includes("result: FAILED")), true);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCLI api-key generate --write upserts ATHENA_API_KEY", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-key-"));
  try {
    writeFileSync(join(dir, ".env.local"), "ATHENA_URL=https://example.com\n", "utf8");
    const logs: string[] = [];
    await runCLI(
      ["api-key", "generate", "--write", "--env-file", ".env.local"],
      {
        cwd: dir,
        log: (message) => {
          logs.push(message);
        },
      }
    );

    const content = readFileSync(join(dir, ".env.local"), "utf8");
    assert.equal(content.includes("ATHENA_URL=https://example.com"), true);
    assert.equal(/ATHENA_API_KEY=ath_/.test(content), true);
    assert.equal(logs.some((line) => line.includes("updated")), true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCLI rights catalog and api-key create use gateway admin routes", async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string" && init.body) {
      body = JSON.parse(init.body);
    }
    calls.push({ body, method, url });

    if (url.endsWith("/admin/rights/catalog")) {
      return new Response(
        JSON.stringify({
          data: {
            apiKeyRightsStatus: "ok",
            counts: { dynamicApiKeyRights: 1, native: 1, total: 2 },
            dynamicApiKeyRights: [
              { key: "gateway.query", kind: "dynamic", source: "api_key_store" },
            ],
            nativeRights: [
              {
                description: "Any gateway right",
                isPattern: true,
                key: "gateway.*",
                kind: "pattern",
                source: "gateway",
              },
            ],
          },
          message: "Listed Athena rights catalog",
          success: true,
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/admin/api-key-rights") && method === "GET") {
      return new Response(
        JSON.stringify({
          rights: [
            {
              description: "Run /gateway/query",
              id: "r1",
              name: "gateway.query",
            },
          ],
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/admin/api-keys") && method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            api_key: "ath_publicid12345678.secretvalue",
            record: {
              client_name: "analytics",
              id: "k1",
              is_active: true,
              name: "analytics",
              public_id: "publicid12345678",
              rights: ["gateway.query"],
            },
          },
          message: "Created API key",
          status: "success",
        }),
        { status: 201 }
      );
    }

    if (url.endsWith("/admin/api-keys") && method === "GET") {
      return new Response(
        JSON.stringify({
          api_keys: [
            {
              client_name: "analytics",
              is_active: true,
              name: "analytics",
              public_id: "publicid12345678",
              rights: ["gateway.query"],
            },
          ],
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), {
      status: 500,
    });
  };

  const dir = mkdtempSync(join(tmpdir(), "athena-cli-gw-"));
  const previousExitCode = process.exitCode;
  try {
    writeFileSync(
      join(dir, ".env.local"),
      [
        "ATHENA_URL=https://gateway.example.com",
        "ATHENA_KEY_12=static-admin-secret",
      ].join("\n"),
      "utf8"
    );

    const catalogLogs: string[] = [];
    process.exitCode = undefined;
    await runCLI(["rights", "catalog"], {
      cwd: dir,
      fetchImpl,
      log: (message) => {
        catalogLogs.push(message);
      },
    });
    assert.equal(
      catalogLogs.some((line) => line.includes("gateway.*")),
      true
    );
    assert.equal(
      catalogLogs.some((line) => line.includes("gateway.query")),
      true
    );

    const listLogs: string[] = [];
    await runCLI(["rights", "list"], {
      cwd: dir,
      fetchImpl,
      log: (message) => {
        listLogs.push(message);
      },
    });
    assert.equal(listLogs.some((line) => line.includes("gateway.query")), true);

    const createLogs: string[] = [];
    await runCLI(
      [
        "api-key",
        "create",
        "--name",
        "analytics",
        "--rights",
        "gateway.query",
        "--client-name",
        "analytics",
        "--write",
        "--env-file",
        ".env.local",
        "--force",
      ],
      {
        cwd: dir,
        fetchImpl,
        log: (message) => {
          createLogs.push(message);
        },
      }
    );
    assert.equal(
      createLogs.some((line) => line.includes("ath_publicid12345678.secretvalue")),
      true
    );
    const envContent = readFileSync(join(dir, ".env.local"), "utf8");
    assert.equal(
      envContent.includes("ATHENA_API_KEY=ath_publicid12345678.secretvalue"),
      true
    );

    const keyListLogs: string[] = [];
    await runCLI(["api-key", "list", "--json"], {
      cwd: dir,
      fetchImpl,
      log: (message) => {
        keyListLogs.push(message);
      },
    });
    assert.equal(keyListLogs[0]?.includes("publicid12345678"), true);

    assert.equal(
      calls.some(
        (call) =>
          call.method === "GET" && call.url.endsWith("/admin/rights/catalog")
      ),
      true
    );
    assert.equal(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith("/admin/api-keys") &&
          (call.body as { name?: string })?.name === "analytics"
      ),
      true
    );
    assert.equal(process.exitCode === undefined || process.exitCode === 0, true);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(dir, { force: true, recursive: true });
  }
});
