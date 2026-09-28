import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  experimental: {
    postgresGatewayIntrospection: false,
    scyllaProviderContracts: false,
  },
  features: {
    emitRegistry: true,
    emitRelations: true,
  },
  migrations: {
    directory: "athena/migrations",
  },
  modules: {
    auth: true,
    billing: true,
  },
  naming: {
    databaseConst: "camel",
    modelConst: "camel",
    modelType: "pascal",
    registryConst: "camel",
    schemaConst: "camel",
  },
  output: {
    format: "table-builder",
    placeholderMap: {
      namespace: "athena",
    },
    preset: "athena-direct",
    targets: {
      database: "athena/generated/relations.ts",
      model: "athena/generated/models/{schema_kebab}/{model_kebab}.ts",
      registry: "athena/generated/registry.ts",
      schema: "athena/generated/schema/{schema_kebab}.ts",
    },
  },
  provider: {
    connectionString: generatorEnv("DATABASE_URL"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { optional: true }),
    kind: "postgres",
    mode: "direct",
    schemas: ["public", "athena"],
  },
});
