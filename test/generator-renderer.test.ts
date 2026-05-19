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
  assert.ok(modelFile)
  assert.equal(modelFile.content.includes("table: string"), true)
  assert.equal(modelFile.content.includes("'space name'?: string | null"), true)
  assert.equal(modelFile.content.includes("mood?: 'happy' | 'sad' | null"), true)
  assert.equal(modelFile.content.includes('relations:'), true)
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
  assert.equal(paths.includes('athena/config.ts'), true)
})

test('generateArtifactsFromSnapshot explains schema-safe paths when multi-schema configs collide', () => {
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

  assert.throws(
    () => generateArtifactsFromSnapshot(multiSchemaSnapshot, config),
    /include a schema placeholder/,
  )
})
