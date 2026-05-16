import { strict as assert } from 'assert'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import {
  findGeneratorConfigPath,
  loadGeneratorConfig,
  defineGeneratorConfig,
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

test('loadGeneratorConfig uses runtime indirection instead of direct dynamic import call', () => {
  const source = readFileSync(join(process.cwd(), 'src/generator/config.ts'), 'utf8')

  assert.match(source, /function importConfigModule\(moduleSpecifier: string\)/)
  assert.match(source, /new Function\(/)
  assert.match(source, /await importConfigModule\(`\$\{moduleUrl\.href\}\?cacheBust=\$\{Date\.now\(\)\}`\)/)

  // Guard the exact regression surface that broke Next.js bundling.
  assert.doesNotMatch(source, /await import\(`\$\{moduleUrl\.href\}\?cacheBust=\$\{Date\.now\(\)\}`\)/)
})
