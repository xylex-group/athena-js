import { strict as assert } from 'assert'
import { test } from 'node:test'
import type { IntrospectionSnapshot } from '../src/schema/index.ts'
import { generateArtifactsFromSnapshot, defineGeneratorConfig } from '../src/generator/index.ts'

const snapshot: IntrospectionSnapshot = {
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
            'space name': {
              name: 'space name',
              dataType: 'text',
              udtName: 'text',
              typeKind: 'scalar',
              isNullable: true,
              isPrimaryKey: false,
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
              enumValues: ['happy', 'sad'],
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
      },
    },
  },
}

const multiSchemaSnapshot: IntrospectionSnapshot = {
  ...snapshot,
  schemas: {
    public: snapshot.schemas.public,
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
              dataType: 'uuid',
              udtName: 'uuid',
              typeKind: 'scalar',
              isNullable: false,
              isPrimaryKey: true,
              hasDefault: false,
              isGenerated: false,
              arrayDimensions: 0,
            },
            event_name: {
              name: 'event_name',
              dataType: 'text',
              udtName: 'text',
              typeKind: 'scalar',
              isNullable: false,
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

test('generateArtifactsFromSnapshot renders model/schema/database/registry outputs with placeholder paths', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
    },
    output: {
      targets: {
        model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
        schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
        database: 'src/generated/{database_kebab}/index.ts',
        registry: 'src/generated/index.ts',
      },
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
  })

  const artifacts = generateArtifactsFromSnapshot(snapshot, config)

  assert.equal(artifacts.files.length, 4)
  const paths = artifacts.files.map(file => file.path)
  assert.equal(paths.includes('src/generated/app-db/public/users.model.ts'), true)
  assert.equal(paths.includes('src/generated/app-db/public/index.ts'), true)
  assert.equal(paths.includes('src/generated/app-db/index.ts'), true)
  assert.equal(paths.includes('src/generated/index.ts'), true)

  const modelFile = artifacts.files.find(file => file.kind === 'model')
  const registryFile = artifacts.files.find(file => file.kind === 'registry')
  assert.ok(modelFile)
  assert.ok(registryFile)
  assert.equal(modelFile.content.includes("export const users = table('users')"), true)
  assert.equal(modelFile.content.includes("'space name': string().optional()"), true)
  assert.equal(modelFile.content.includes("mood: enumeration(['happy', 'sad'] as const).optional()"), true)
  assert.equal(modelFile.content.includes('Object.assign(users.meta, {'), true)
  assert.equal(registryFile.content.includes('export const __athena_schema_meta = {'), true)
  assert.equal(registryFile.content.includes('schemaVersion: 1'), true)
  assert.equal(registryFile.content.includes("outputPreset: 'athena-direct'"), true)
})

test('generateArtifactsFromSnapshot can disable registry emission with feature flags', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
    },
    output: {
      targets: {
        model: 'src/generated/{database}/{schema}/{model}.ts',
        schema: 'src/generated/{database}/{schema}/index.ts',
        database: 'src/generated/{database}/index.ts',
        registry: 'src/generated/index.ts',
      },
    },
    features: {
      emitRegistry: false,
    },
  })

  const artifacts = generateArtifactsFromSnapshot(snapshot, config)
  assert.equal(artifacts.files.some(file => file.kind === 'registry'), false)
})

test('generateArtifactsFromSnapshot default targets are safe for multiple schemas with shared table names', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
      schemas: ['public', 'athena'],
    },
    output: {},
  })

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config)
  const paths = artifacts.files.map(file => file.path)

  assert.equal(paths.includes('athena/models/public/users.ts'), true)
  assert.equal(paths.includes('athena/models/athena/users.ts'), true)
  assert.equal(paths.includes('athena/schemas/public.ts'), true)
  assert.equal(paths.includes('athena/schemas/athena.ts'), true)
  assert.equal(paths.includes('athena/relations.ts'), true)
  assert.equal(paths.includes('athena/registry.generated.ts'), true)
})

test('generateArtifactsFromSnapshot auto-scopes colliding multi-schema output paths', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
      schemas: ['public', 'athena'],
    },
    output: {
      targets: {
        model: 'athena/models/{model_kebab}.ts',
        schema: 'athena/schema.ts',
        database: 'athena/relations.ts',
        registry: 'athena/config.ts',
      },
    },
  })

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config)
  const paths = artifacts.files.map(file => file.path)

  assert.equal(paths.includes('athena/models/public/users.ts'), true)
  assert.equal(paths.includes('athena/models/athena/users.ts'), true)
  assert.equal(paths.includes('athena/public/schema.ts'), true)
  assert.equal(paths.includes('athena/athena/schema.ts'), true)
})

test('generateArtifactsFromSnapshot keeps built-in placeholders stable when placeholderMap redefines schema/model keys', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
      schemas: ['public', 'athena'],
    },
    output: {
      targets: {
        model: 'athena/models/{schema}/{model_kebab}.ts',
        schema: 'athena/{schema}/schema.ts',
        database: 'athena/{schema}/relations.ts',
        registry: 'athena/{schema}/config.ts',
      },
      placeholderMap: {
        schema: 'schema',
        model: 'model',
        namespace: 'athena',
      },
    },
  })

  const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config)
  const paths = artifacts.files.map(file => file.path)

  assert.equal(paths.includes('athena/models/public/users.ts'), true)
  assert.equal(paths.includes('athena/models/athena/users.ts'), true)
  assert.equal(paths.includes('athena/public/schema.ts'), true)
  assert.equal(paths.includes('athena/athena/schema.ts'), true)
  assert.equal(paths.some(path => path.startsWith('athena/models/schema/')), false)
})

test('generateArtifactsFromSnapshot can render the zero-style table builder format', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
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
    features: {
      emitRelations: true,
      emitRegistry: true,
    },
  })

  const artifacts = generateArtifactsFromSnapshot(snapshot, config)
  const modelFile = artifacts.files.find(file => file.kind === 'model')
  const registryFile = artifacts.files.find(file => file.kind === 'registry')
  assert.ok(modelFile)
  assert.ok(registryFile)
  assert.equal(modelFile.content.includes("export const users = table('users')"), true)
  assert.equal(modelFile.content.includes(".schema('public')"), true)
  assert.equal(modelFile.content.includes("'space name': string().optional()"), true)
  assert.equal(modelFile.content.includes("mood: enumeration(['happy', 'sad'] as const).optional()"), true)
  assert.equal(modelFile.content.includes('Object.assign(users.meta, {'), true)
  assert.equal(modelFile.content.includes('export const users_row_schema = users.schemas.row'), true)
  assert.equal(modelFile.content.includes('export type PublicUsersFormValues = FormValuesOf<typeof users>'), true)
  assert.equal(registryFile.content.includes("outputPreset: 'athena-direct'"), true)
  assert.equal(registryFile.content.includes('outputFormat: \'table-builder\''), true)
})

test('generateArtifactsFromSnapshot renders zero-arg primaryKey for tables without a primary key', () => {
  const config = defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'direct',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
      database: 'app_db',
      schemas: ['athena'],
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
  })

  const noPrimaryKeySnapshot: IntrospectionSnapshot = {
    backend: 'postgresql',
    database: 'app_db',
    generatedAt: new Date('2026-05-15T00:00:00.000Z').toISOString(),
    schemas: {
      athena: {
        name: 'athena',
        tables: {
          account: {
            schema: 'athena',
            name: 'account',
            primaryKey: [],
            columns: {
              id: {
                name: 'id',
                dataType: 'text',
                udtName: 'text',
                typeKind: 'scalar',
                isNullable: false,
                isPrimaryKey: false,
                hasDefault: false,
                isGenerated: false,
                arrayDimensions: 0,
              },
              user_id: {
                name: 'user_id',
                dataType: 'text',
                udtName: 'text',
                typeKind: 'scalar',
                isNullable: false,
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

  const artifacts = generateArtifactsFromSnapshot(noPrimaryKeySnapshot, config)
  const modelFile = artifacts.files.find(file => file.kind === 'model')
  assert.ok(modelFile)
  assert.equal(modelFile.content.includes('.primaryKey()'), true)
})
