import { defineAthenaConfig, generatorEnv } from "./src/generator/index.ts";

export default defineAthenaConfig({
  experimental: {
    postgresGatewayIntrospection: generatorEnv.boolean(
      "ATHENA_GENERATOR_POSTGRES_GATEWAY_INTROSPECTION",
      { default: false }
    ),
    scyllaProviderContracts: generatorEnv.boolean(
      "ATHENA_GENERATOR_SCYLLA_PROVIDER_CONTRACTS",
      { default: true }
    ),
  },
  features: {
    emitRegistry: generatorEnv.boolean("ATHENA_GENERATOR_EMIT_REGISTRY", {
      default: true,
    }),
    emitRelations: generatorEnv.boolean("ATHENA_GENERATOR_EMIT_RELATIONS", {
      default: true,
    }),
  },
  naming: {
    databaseConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_DATABASE_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "camel" }
    ),
    modelConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_MODEL_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "camel" }
    ),
    modelType: generatorEnv.oneOf(
      "ATHENA_GENERATOR_MODEL_TYPE",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "pascal" }
    ),
    registryConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_REGISTRY_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "camel" }
    ),
    schemaConst: generatorEnv.oneOf(
      "ATHENA_GENERATOR_SCHEMA_CONST",
      ["preserve", "camel", "pascal", "snake", "kebab"] as const,
      { default: "camel" }
    ),
  },
  output: {
    placeholderMap: {
      namespace: "athena",
    },
    preset: "athena-direct",
    targets: {
      database: "src/lib/athena/generated/relations.ts",
      model: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      registry: "src/lib/athena/generated/registry.ts",
      schema: "src/lib/athena/generated/schema/{schema_kebab}.ts",
    },
  },
  provider: {
    connectionString: generatorEnv("ATHENA_GENERATOR_PG_URL", {
      default: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
    }),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    kind: "postgres",
    mode: "direct",
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
  },
});
