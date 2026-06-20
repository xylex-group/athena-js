import { strict as assert } from 'assert'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import {
  findGeneratorConfigPath,
  loadGeneratorConfig,
  defineGeneratorConfig,
  normalizeSchemaSelection,
} from '../src/generator/index.ts'

test('findGeneratorConfigPath locates athena.config.ts in project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-'))
  try {
    writeFileSync(join(root, 'athena.config.ts'), 'export default {}\n', 'utf8')
    const found = findGeneratorConfigPath(root)
    assert.equal(found, join(root, 'athena.config.ts'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig resolves default export from ts config file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
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
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.provider.kind, 'postgres')
    assert.equal(loaded.config.output.targets.registry, 'src/generated/index.ts')
    assert.equal(loaded.config.internal.schemaVersion, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig applies athena folder defaults when output targets are omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-default-targets-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
          schemas: ['public'],
        },
        output: {},
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.output.preset, 'athena-direct')
    assert.equal(loaded.config.output.targets.model, 'athena/models/{schema_kebab}/{model_kebab}.ts')
    assert.equal(loaded.config.output.targets.schema, 'athena/schemas/{schema_kebab}.ts')
    assert.equal(loaded.config.output.targets.database, 'athena/relations.ts')
    assert.equal(loaded.config.output.targets.registry, 'athena/registry.generated.ts')
    assert.deepEqual(loaded.config.filter, {
      includeTables: [],
      excludeTables: [],
    })
    assert.deepEqual(loaded.config.provider.kind === 'postgres' ? loaded.config.provider.schemas : [], ['public'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig supports the athena-direct output preset', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-athena-direct-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
          schemas: ['public'],
        },
        output: {
          preset: 'athena-direct',
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.output.preset, 'athena-direct')
    assert.equal(loaded.config.output.format, 'table-builder')
    assert.equal(loaded.config.output.targets.model, 'athena/models/{schema_kebab}/{model_kebab}.ts')
    assert.equal(loaded.config.output.targets.schema, 'athena/schemas/{schema_kebab}.ts')
    assert.equal(loaded.config.output.targets.database, 'athena/relations.ts')
    assert.equal(loaded.config.output.targets.registry, 'athena/registry.generated.ts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig supports provider-only config files with default output settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-provider-only-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.output.preset, 'athena-direct')
    assert.equal(loaded.config.output.format, 'table-builder')
    assert.equal(loaded.config.output.targets.model, 'athena/models/{schema_kebab}/{model_kebab}.ts')
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'direct') {
      throw new Error('Expected direct postgres provider.')
    }
    assert.equal(loaded.config.provider.database, 'phase_two')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('normalizeSchemaSelection trims comma-separated values and removes duplicates', () => {
  assert.deepEqual(normalizeSchemaSelection(' public, athena, public, '), ['public', 'athena'])
  assert.deepEqual(normalizeSchemaSelection([]), ['public'])
})

test('loadGeneratorConfig normalizes env-style multiple schemas', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-multi-schema-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
          schemas: ' public, athena, public ',
        },
        output: {},
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.deepEqual(loaded.config.provider.kind === 'postgres' ? loaded.config.provider.schemas : [], [
      'public',
      'athena',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig normalizes table filters from config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-table-filters-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
        },
        filter: {
          includeTables: 'users, public.notifications, users',
          excludeTables: ['audit_logs', 'public.notifications'],
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.deepEqual(loaded.config.filter, {
      includeTables: ['users', 'public.notifications'],
      excludeTables: ['audit_logs', 'public.notifications'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig builds a direct postgres config from environment when no config file exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-env-only-direct-'))
  const previousValues = new Map<string, string | undefined>([
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['ATHENA_GENERATOR_MODEL_TYPE', process.env.ATHENA_GENERATOR_MODEL_TYPE],
    ['ATHENA_GENERATOR_TABLES', process.env.ATHENA_GENERATOR_TABLES],
  ])

  delete process.env.DATABASE_URL
  delete process.env.ATHENA_GENERATOR_MODEL_TYPE
  delete process.env.ATHENA_GENERATOR_TABLES

  try {
    writeFileSync(
      join(root, '.env.local'),
      [
        'DATABASE_URL=postgres://postgres:from_env@127.0.0.1:5432/env_only_db',
        'ATHENA_GENERATOR_MODEL_TYPE=snake',
        'ATHENA_GENERATOR_TABLES=users, public.notifications',
      ].join('\n'),
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.configPath, '[environment defaults]')
    assert.equal(loaded.config.output.preset, 'athena-direct')
    assert.equal(loaded.config.output.format, 'table-builder')
    assert.equal(loaded.config.output.targets.registry, 'athena/registry.generated.ts')
    assert.equal(loaded.config.naming.modelType, 'snake')
    assert.deepEqual(loaded.config.filter.includeTables, ['users', 'public.notifications'])
    assert.equal(loaded.config.internal.schemaVersion, 1)
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'direct') {
      throw new Error('Expected direct postgres provider.')
    }
    assert.equal(
      loaded.config.provider.connectionString,
      'postgres://postgres:from_env@127.0.0.1:5432/env_only_db',
    )
    assert.equal(loaded.config.provider.database, 'env_only_db')
    assert.deepEqual(loaded.config.provider.schemas, ['public'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('loadGeneratorConfig restores staged project env values after env-only resolution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-env-restore-'))
  const previousDatabaseUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL

  try {
    writeFileSync(
      join(root, '.env.local'),
      'DATABASE_URL=postgres://postgres:from_env@127.0.0.1:5432/restored_db',
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.configPath, '[environment defaults]')
    assert.equal(process.env.DATABASE_URL, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
  }
})

test('loadGeneratorConfig builds a gateway postgres config from environment when no config file exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-env-only-gateway-'))
  const previousValues = new Map<string, string | undefined>([
    ['ATHENA_URL', process.env.ATHENA_URL],
    ['ATHENA_API_KEY', process.env.ATHENA_API_KEY],
    ['ATHENA_GENERATOR_DB', process.env.ATHENA_GENERATOR_DB],
    ['ATHENA_GENERATOR_SCHEMAS', process.env.ATHENA_GENERATOR_SCHEMAS],
    ['ATHENA_GENERATOR_BACKEND', process.env.ATHENA_GENERATOR_BACKEND],
  ])

  delete process.env.ATHENA_URL
  delete process.env.ATHENA_API_KEY
  delete process.env.ATHENA_GENERATOR_DB
  delete process.env.ATHENA_GENERATOR_SCHEMAS
  delete process.env.ATHENA_GENERATOR_BACKEND

  try {
    writeFileSync(
      join(root, '.env.local'),
      [
        'ATHENA_URL=https://athena-db.com',
        'ATHENA_API_KEY=secret',
        'ATHENA_GENERATOR_DB=gateway_db',
        'ATHENA_GENERATOR_SCHEMAS=public,athena,public',
        'ATHENA_GENERATOR_BACKEND=postgresql',
      ].join('\n'),
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.configPath, '[environment defaults]')
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'gateway') {
      throw new Error('Expected gateway postgres provider.')
    }
    assert.equal(loaded.config.provider.gatewayUrl, 'https://athena-db.com')
    assert.equal(loaded.config.provider.apiKey, 'secret')
    assert.equal(loaded.config.provider.database, 'gateway_db')
    assert.equal(loaded.config.provider.backend, 'postgresql')
    assert.deepEqual(loaded.config.provider.schemas, ['public', 'athena'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('loadGeneratorConfig normalizes string boolean feature flags', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-boolean-flags-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
        },
        output: {},
        features: {
          emitRelations: 'yes',
          emitRegistry: 'off',
        },
        experimental: {
          postgresGatewayIntrospection: '1',
          scyllaProviderContracts: '0',
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.deepEqual(loaded.config.features, {
      emitRelations: true,
      emitRegistry: false,
    })
    assert.deepEqual(loaded.config.experimental, {
      postgresGatewayIntrospection: true,
      scyllaProviderContracts: false,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('defineGeneratorConfig is an identity helper for typed configs', () => {
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
    },
  })

  assert.equal(config.provider.kind, 'postgres')
  assert.equal(config.output.targets.model.includes('{model_kebab}'), true)
})

test('generatorEnv resolves typed env-backed config fields across generator sections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-env-helper-'))
  const previousValues = new Map<string, string | undefined>([
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['ATHENA_GENERATOR_DB', process.env.ATHENA_GENERATOR_DB],
  ])

  delete process.env.DATABASE_URL
  delete process.env.ATHENA_GENERATOR_DB

  try {
    writeFileSync(
      join(root, '.env.local'),
      [
        'DATABASE_URL=postgres://postgres:from_helper@127.0.0.1:5432/app_db',
        'ATHENA_GENERATOR_DB=env_app_db',
        'ATHENA_GENERATOR_SCHEMAS=public,athena,public',
        'ATHENA_GENERATOR_MODEL_TARGET=generated/models/{schema_kebab}/{model_kebab}.ts',
        'ATHENA_GENERATOR_PLACEHOLDER_MAP={"namespace":"env/generated"}',
        'ATHENA_GENERATOR_MODEL_STYLE=snake',
        'ATHENA_GENERATOR_EMIT_RELATIONS=off',
        'ATHENA_GENERATOR_GATEWAY_EXPERIMENTAL=yes',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      import { defineGeneratorConfig, generatorEnv } from '${new URL('../src/generator/index.ts', import.meta.url).href}'

      export default defineGeneratorConfig({
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: generatorEnv('DATABASE_URL'),
          database: generatorEnv('ATHENA_GENERATOR_DB', { default: 'app_db' }),
          schemas: generatorEnv.list('ATHENA_GENERATOR_SCHEMAS', { default: ['public'] }),
        },
        output: {
          targets: {
            model: generatorEnv('ATHENA_GENERATOR_MODEL_TARGET', {
              default: 'athena/models/{schema_kebab}/{model_kebab}.ts',
            }),
            schema: 'athena/schemas/{schema_kebab}.ts',
            database: 'athena/relations.ts',
            registry: 'athena/config.ts',
          },
          placeholderMap: generatorEnv.json('ATHENA_GENERATOR_PLACEHOLDER_MAP', {
            default: { namespace: 'athena' },
          }),
        },
        naming: {
          modelType: generatorEnv.oneOf(
            'ATHENA_GENERATOR_MODEL_STYLE',
            ['preserve', 'camel', 'pascal', 'snake', 'kebab'] as const,
            { default: 'pascal' },
          ),
        },
        features: {
          emitRelations: generatorEnv.boolean('ATHENA_GENERATOR_EMIT_RELATIONS', { default: true }),
        },
        experimental: {
          postgresGatewayIntrospection: generatorEnv.boolean('ATHENA_GENERATOR_GATEWAY_EXPERIMENTAL', {
            default: false,
          }),
        },
      })
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'direct') {
      throw new Error('Expected direct postgres provider.')
    }

    assert.equal(
      loaded.config.provider.connectionString,
      'postgres://postgres:from_helper@127.0.0.1:5432/app_db',
    )
    assert.equal(loaded.config.provider.database, 'env_app_db')
    assert.deepEqual(loaded.config.provider.schemas, ['public', 'athena'])
    assert.equal(
      loaded.config.output.targets.model,
      'generated/models/{schema_kebab}/{model_kebab}.ts',
    )
    assert.deepEqual(loaded.config.output.placeholderMap, { namespace: 'env/generated' })
    assert.equal(loaded.config.naming.modelType, 'snake')
    assert.equal(loaded.config.features.emitRelations, false)
    assert.equal(loaded.config.experimental.postgresGatewayIntrospection, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('loadGeneratorConfig resolves CJS transpiler-style nested default exports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-cjs-'))
  try {
    writeFileSync(
      join(root, 'athena.config.js'),
      `
      module.exports = {
        default: {
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
          },
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.provider.kind, 'postgres')
    assert.equal(loaded.config.output.targets.registry, 'src/generated/index.ts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig resolves named object exports such as generatorConfig', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-named-export-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export const helper = { value: true }

      export const generatorConfig = {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
          schemas: ['public', 'athena'],
        },
        output: {
          targets: {
            model: 'src/generated/{schema_kebab}/{model_kebab}.ts',
            schema: 'src/generated/{schema_kebab}.schema.ts',
            database: 'src/generated/database.ts',
            registry: 'src/generated/registry.ts',
          },
        },
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    assert.equal(loaded.config.provider.kind, 'postgres')
    assert.deepEqual(
      loaded.config.provider.kind === 'postgres' ? loaded.config.provider.schemas : [],
      ['public', 'athena'],
    )
    assert.equal(loaded.config.output.targets.registry, 'src/generated/registry.ts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadGeneratorConfig loads .env and .env.local values before config evaluation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-env-load-'))
  const previousDatabaseUrl = process.env.DATABASE_URL

  delete process.env.DATABASE_URL

  try {
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgres://postgres:from_env@127.0.0.1:5432/app_db\n', 'utf8')
    writeFileSync(
      join(root, '.env.local'),
      'DATABASE_URL=postgres://postgres:from_local@127.0.0.1:5432/app_db\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: process.env.DATABASE_URL,
          database: 'app_db',
        },
        output: {},
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'direct') {
      throw new Error('Expected direct postgres provider.')
    }
    assert.equal(
      loaded.config.provider.connectionString,
      'postgres://postgres:from_local@127.0.0.1:5432/app_db',
    )
    assert.equal(process.env.DATABASE_URL, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
  }
})

test('loadGeneratorConfig backfills postgres password from env when URL has no password segment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-config-password-fallback-'))
  const previousPgPassword = process.env.PGPASSWORD

  delete process.env.PGPASSWORD

  try {
    writeFileSync(join(root, '.env'), 'PGPASSWORD=from_local_env\n', 'utf8')
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgresql://postgres@127.0.0.1:5432/app_db',
          database: 'app_db',
        },
        output: {},
      }
      `,
      'utf8',
    )

    const loaded = await loadGeneratorConfig({ cwd: root })
    if (loaded.config.provider.kind !== 'postgres' || loaded.config.provider.mode !== 'direct') {
      throw new Error('Expected direct postgres provider.')
    }
    assert.equal(
      loaded.config.provider.connectionString,
      'postgresql://postgres:from_local_env@127.0.0.1:5432/app_db',
    )
    assert.equal(process.env.PGPASSWORD, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (previousPgPassword === undefined) {
      delete process.env.PGPASSWORD
    } else {
      process.env.PGPASSWORD = previousPgPassword
    }
  }
})

test('loadGeneratorConfig uses runtime indirection instead of direct dynamic import call', () => {
  const source = readFileSync(join(process.cwd(), 'src/generator/config.ts'), 'utf8')

  assert.match(source, /function importConfigModule\(moduleSpecifier: string\)/)
  assert.match(source, /new Function\(/)
  assert.match(source, /await importConfigModule\(`\$\{moduleUrl\.href\}\?cacheBust=\$\{Date\.now\(\)\}`\)/)

  // Guard the exact regression surface that broke Next.js bundling.
  assert.doesNotMatch(source, /await import\(`\$\{moduleUrl\.href\}\?cacheBust=\$\{Date\.now\(\)\}`\)/)
})
