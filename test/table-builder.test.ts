import { strict as assert } from 'assert'
import { test } from 'node:test'
import { z } from 'zod'
import {
  boolean,
  createModelFormAdapter,
  enumeration,
  json,
  number,
  string,
  table,
} from '../src/index.ts'

const account = table('accounts')
  .from('public.accounts')
  .columns({
    id: string().generated(),
    orgID: string().from('org_id'),
    name: string(),
    age: number().optional(),
    is_active: boolean().defaulted(),
    settings: json(z.object({ theme: z.enum(['light', 'dark']) })),
    metadata: json<{ nested: string }>(),
    mood: enumeration(['happy', 'sad'] as const).optional(),
  })
  .primaryKey('id')

test('table builder stores schema-aware metadata and explicit column mappings', () => {
  assert.equal(account.kind, 'table')
  assert.equal(account.name, 'accounts')
  assert.equal(account.meta.schema, 'public')
  assert.equal(account.meta.model, 'accounts')
  assert.deepEqual(account.meta.primaryKey, ['id'])
  assert.equal(account.meta.columns?.orgID?.columnName, 'org_id')
  assert.equal(account.meta.columns?.id?.isGenerated, true)
  assert.equal(account.meta.columns?.is_active?.hasDefault, true)
  assert.equal(account.meta.columns?.mood?.kind, 'enumeration')
  assert.deepEqual(account.meta.columns?.mood?.enumValues, ['happy', 'sad'])
})

test('table builder derives row, insert, and update schemas from column flags', () => {
  const row = account.schemas.row.parse({
    id: 'acct_1',
    orgID: 'org_1',
    name: 'Ada',
    age: null,
    is_active: true,
    settings: { theme: 'light' },
    metadata: 42,
    mood: null,
  })

  assert.equal(row.id, 'acct_1')
  assert.equal(row.age, null)
  assert.equal(row.metadata, 42)

  const insert = account.schemas.insert.parse({
    id: 'ignore-me',
    orgID: 'org_1',
    name: 'Ada',
    settings: { theme: 'dark' },
    metadata: { nested: 'ok' },
  })

  assert.equal('id' in insert, false)
  assert.equal(insert.is_active, undefined)
  assert.equal(insert.age, undefined)
  assert.deepEqual(insert.settings, { theme: 'dark' })

  const update = account.schemas.update.parse({
    id: 'ignore-me',
    mood: 'happy',
  })

  assert.equal('id' in update, false)
  assert.equal(update.mood, 'happy')

  assert.throws(
    () => account.schemas.row.parse({
      id: 'acct_1',
      orgID: 'org_1',
      name: 'Ada',
      age: null,
      is_active: true,
      settings: { theme: 'sepia' },
      metadata: {},
      mood: null,
    }),
    /Invalid option/,
  )
})

test('table builder form schema normalizes empty strings and model adapters stay compatible', () => {
  const parsed = account.schemas.form.parse({
    orgID: 'org_1',
    name: 'Ada',
    age: '',
    settings: { theme: 'light' },
    metadata: { nested: 'ok' },
    mood: '',
  })

  assert.deepEqual(parsed, {
    orgID: 'org_1',
    name: 'Ada',
    age: null,
    settings: { theme: 'light' },
    metadata: { nested: 'ok' },
    mood: null,
  })

  const adapter = createModelFormAdapter(account)
  assert.deepEqual(
    adapter.toDefaults({
      age: null,
      mood: null,
    }),
    {
      age: '',
      mood: '',
    },
  )
  assert.deepEqual(
    adapter.toInsert({
      orgID: 'org_1',
      name: 'Ada',
      age: '',
      settings: { theme: 'light' },
      metadata: { nested: 'ok' },
      mood: '',
    }),
    {
      orgID: 'org_1',
      name: 'Ada',
      age: null,
      settings: { theme: 'light' },
      metadata: { nested: 'ok' },
      mood: null,
    },
  )
})
