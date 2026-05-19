import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  defineGeneratorConfig,
  findGeneratorConfigPath,
  generateArtifactsFromSnapshot,
  loadGeneratorConfig,
  normalizeGeneratorConfig,
  resolveGeneratorProvider,
  resolvePostgresColumnType,
  runSchemaGenerator,
  type AthenaGeneratorConfig,
  type LoadedGeneratorConfig,
  type RunGeneratorResult,
} from '../../../src/generator/index.ts'
import type {
  IntrospectionColumn,
  IntrospectionInspectOptions,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from '../../../src/schema/index.ts'

export type ExampleWorkspace = {
  cwd: string
}

export type TypeMappingShowcase = Array<{
  source: Pick<IntrospectionColumn, 'dataType' | 'udtName' | 'typeKind' | 'arrayDimensions' | 'enumValues'>
  mappedType: string
}>

const DEFAULT_TARGETS = {
  model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
  schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
  database: 'src/generated/{database_kebab}/index.ts',
  registry: 'src/generated/index.ts',
}

function createSchemaProvider(snapshot: IntrospectionSnapshot): SchemaIntrospectionProvider {
  return {
    backend: snapshot.backend,
    async inspect(_options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot> {
      return snapshot
    },
  }
}

export function createDirectGeneratorConfig(connectionString: string): AthenaGeneratorConfig {
  return defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString,
      database: 'app_db',
      schemas: ['public', 'athena'],
    },
    output: {
      targets: { ...DEFAULT_TARGETS },
      placeholderMap: {
        namespace: '{database_kebab}/{schema_kebab}',
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
}

export function createGatewayOnlyGeneratorConfig(gatewayUrl: string, apiKey: string): AthenaGeneratorConfig {
  return defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'gateway',
      gatewayUrl,
      apiKey,
      backend: 'postgresql',
      database: 'app_db',
      schemas: ['public', 'athena'],
    },
    output: {
      targets: { ...DEFAULT_TARGETS },
      placeholderMap: {
        namespace: '{database_kebab}/{schema_kebab}',
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
}

export function createFullFeatureSnapshot(): IntrospectionSnapshot {
  return {
    backend: 'postgresql',
    database: 'app_db',
    generatedAt: new Date('2026-05-15T00:00:00.000Z').toISOString(),
    schemas: {
      public: {
        name: 'public',
        tables: {
          users: {
            schema: 'public',
            name: 'users',
            primaryKey: ['id'],
            columns: {
              id: {
                name: 'id',
                dataType: 'uuid',
                udtName: 'uuid',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: true,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
              table: {
                name: 'table',
                dataType: 'text',
                udtName: 'text',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
              email: {
                name: 'email',
                dataType: 'text',
                udtName: 'text',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
              tags: {
                name: 'tags',
                dataType: 'text[]',
                udtName: '_text',
                typeKind: 'scalar',
                isNullable: true,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 1,
              },
            },
            relations: {
              profile: {
                name: 'profile_user_fk',
                kind: 'one-to-one',
                sourceColumns: ['id'],
                targetSchema: 'public',
                targetModel: 'profiles',
                targetColumns: ['user_id'],
              },
            },
          },
          profiles: {
            schema: 'public',
            name: 'profiles',
            primaryKey: ['user_id'],
            columns: {
              user_id: {
                name: 'user_id',
                dataType: 'uuid',
                udtName: 'uuid',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: true,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
              mood: {
                name: 'mood',
                dataType: 'public.mood',
                udtName: 'mood',
                typeKind: 'enum',
                isNullable: true,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
                enumValues: ['happy', 'sad', 'neutral'],
              },
            },
            relations: {
              users: {
                name: 'profiles_users_fk',
                kind: 'many-to-one',
                sourceColumns: ['user_id'],
                targetSchema: 'public',
                targetModel: 'users',
                targetColumns: ['id'],
              },
            },
          },
        },
      },
      athena: {
        name: 'athena',
        tables: {
          users: {
            schema: 'athena',
            name: 'users',
            primaryKey: ['id'],
            columns: {
              id: {
                name: 'id',
                dataType: 'bigint',
                udtName: 'int8',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: true,
                hasDefault: true,
                isGenerated: false,
                arrayDimensions: 0,
              },
              metrics: {
                name: 'metrics',
                dataType: 'jsonb',
                udtName: 'jsonb',
                typeKind: 'scalar',
                isNullable: true,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
            },
            relations: {},
          },
        },
      },
    },
  }
}

export async function writeGeneratorConfigFile(
  workspace: ExampleWorkspace,
  config: AthenaGeneratorConfig,
): Promise<string> {
  const configPath = join(workspace.cwd, 'athena.config.ts')
  const moduleText = `export default ${JSON.stringify(config, null, 2)}\n`
  await writeFile(configPath, moduleText, 'utf8')
  return configPath
}

export async function runGeneratorDryRunWithSnapshot(
  workspace: ExampleWorkspace,
  config: AthenaGeneratorConfig,
  snapshot: IntrospectionSnapshot,
): Promise<RunGeneratorResult> {
  await writeGeneratorConfigFile(workspace, config)
  return runSchemaGenerator({
    cwd: workspace.cwd,
    dryRun: true,
    provider: createSchemaProvider(snapshot),
  })
}

export async function runGeneratorWriteWithSnapshot(
  workspace: ExampleWorkspace,
  config: AthenaGeneratorConfig,
  snapshot: IntrospectionSnapshot,
): Promise<RunGeneratorResult> {
  await writeGeneratorConfigFile(workspace, config)
  return runSchemaGenerator({
    cwd: workspace.cwd,
    provider: createSchemaProvider(snapshot),
  })
}

export async function loadResolvedExampleConfig(
  workspace: ExampleWorkspace,
): Promise<LoadedGeneratorConfig> {
  const configPath = findGeneratorConfigPath(workspace.cwd)
  if (!configPath) {
    throw new Error('Example config file was not found in workspace')
  }
  return loadGeneratorConfig({ cwd: workspace.cwd, configPath })
}

export function renderArtifactsFromExampleSnapshot(
  config: AthenaGeneratorConfig,
  snapshot: IntrospectionSnapshot,
) {
  return generateArtifactsFromSnapshot(snapshot, normalizeGeneratorConfig(config))
}

export async function runDirectProviderInspect(
  connectionString: string,
): Promise<IntrospectionSnapshot> {
  const provider = resolveGeneratorProvider(
    createDirectGeneratorConfig(connectionString).provider,
    {
      postgresGatewayIntrospection: false,
      scyllaProviderContracts: true,
    },
  )
  return provider.inspect()
}

export async function runGatewayProviderInspect(
  gatewayUrl: string,
  apiKey: string,
): Promise<IntrospectionSnapshot> {
  const provider = resolveGeneratorProvider(
    createGatewayOnlyGeneratorConfig(gatewayUrl, apiKey).provider,
    {
      postgresGatewayIntrospection: false,
      scyllaProviderContracts: true,
    },
  )
  return provider.inspect()
}

export async function ensureWorkspace(workspace: ExampleWorkspace): Promise<void> {
  await mkdir(dirname(join(workspace.cwd, 'athena.config.ts')), { recursive: true })
}

export function collectTypeMappingShowcase(): TypeMappingShowcase {
  const exampleColumns: IntrospectionColumn[] = [
    {
      name: 'id',
      dataType: 'bigint',
      udtName: 'int8',
      typeKind: 'scalar',
      isNullable: false,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
      arrayDimensions: 0,
    },
    {
      name: 'settings',
      dataType: 'jsonb',
      udtName: 'jsonb',
      typeKind: 'scalar',
      isNullable: false,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
      arrayDimensions: 0,
    },
    {
      name: 'mood',
      dataType: 'mood',
      udtName: 'mood',
      typeKind: 'enum',
      isNullable: true,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
      arrayDimensions: 0,
      enumValues: ['happy', 'sad'],
    },
    {
      name: 'labels',
      dataType: 'text[]',
      udtName: '_text',
      typeKind: 'scalar',
      isNullable: true,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
      arrayDimensions: 1,
    },
  ]

  return exampleColumns.map(column => ({
    source: {
      dataType: column.dataType,
      udtName: column.udtName,
      typeKind: column.typeKind,
      arrayDimensions: column.arrayDimensions,
      enumValues: column.enumValues,
    },
    mappedType: resolvePostgresColumnType(column),
  }))
}
