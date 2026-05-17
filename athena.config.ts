import { defineGeneratorConfig } from './src/generator/index.ts'

export default defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: process.env.ATHENA_GENERATOR_PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
    database: process.env.ATHENA_GENERATOR_DB ?? 'app_db',
    schemas: ['public'],
  },
  output: {
    targets: {
      model: 'athena/models/{model_kebab}.ts',
      schema: 'athena/schema.ts',
      database: 'athena/relations.ts',
      registry: 'athena/config.ts',
    },
    placeholderMap: {
      namespace: 'athena',
    },
  },
  naming: {
    modelType: 'pascal',
    modelConst: 'camel',
    schemaConst: 'camel',
    databaseConst: 'camel',
    registryConst: 'camel',
  },
  features: {
    emitRelations: true,
    emitRegistry: true,
  },
  experimental: {
    postgresGatewayIntrospection: false,
    scyllaProviderContracts: true,
  },
})
