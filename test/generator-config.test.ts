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
    assert.equal(loaded.config.output.targets.model, 'athena/models/{schema_kebab}/{model_kebab}.ts')
    assert.equal(loaded.config.output.targets.schema, 'athena/schemas/{schema_kebab}.ts')
    assert.equal(loaded.config.output.targets.database, 'athena/relations.ts')
    assert.equal(loaded.config.output.targets.registry, 'athena/config.ts')
    assert.deepEqual(loaded.config.provider.kind === 'postgres' ? loaded.config.provider.schemas : [], ['public'])
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
