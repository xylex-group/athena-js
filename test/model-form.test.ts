import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  createModelFormAdapter,
  defineModel,
  toModelFormDefaults,
  toModelPayload,
} from '../src/index.ts'

interface ProfileRow {
  id: string
  display_name: string | null
  age: number | null
  active: boolean
}

const profileModel = defineModel<ProfileRow>({
  meta: {
    database: 'app',
    schema: 'public',
    model: 'profiles',
    primaryKey: ['id'],
    nullable: {
      id: false,
      display_name: true,
      age: true,
      active: false,
    },
  },
})

test('toModelFormDefaults converts nullable null fields to empty strings by default', () => {
  const defaults = toModelFormDefaults(profileModel, {
    id: 'p_1',
    display_name: null,
    age: null,
    active: true,
  })

  assert.deepEqual(defaults, {
    id: 'p_1',
    display_name: '',
    age: '',
    active: true,
  })
})

test('toModelFormDefaults supports undefined and null nullish modes', () => {
  const undefinedDefaults = toModelFormDefaults(
    profileModel,
    { id: 'p_1', display_name: null, age: null, active: true },
    { nullishMode: 'undefined' },
  )
  assert.equal(undefinedDefaults.display_name, undefined)
  assert.equal(undefinedDefaults.age, undefined)

  const nullDefaults = toModelFormDefaults(
    profileModel,
    { id: 'p_1', display_name: null, age: null, active: true },
    { nullishMode: 'null' },
  )
  assert.equal(nullDefaults.display_name, null)
  assert.equal(nullDefaults.age, null)
})

test('toModelPayload converts empty strings back to null for nullable columns', () => {
  const payload = toModelPayload(profileModel, {
    id: 'p_1',
    display_name: '',
    age: '',
    active: true,
  })

  assert.deepEqual(payload, {
    id: 'p_1',
    display_name: null,
    age: null,
    active: true,
  })
})

test('toModelPayload strips undefined keys by default and can preserve them', () => {
  const stripped = toModelPayload(profileModel, {
    id: 'p_1',
    display_name: 'Ada',
    age: undefined,
  })

  assert.deepEqual(stripped, {
    id: 'p_1',
    display_name: 'Ada',
  })

  const preserved = toModelPayload(
    profileModel,
    {
      id: 'p_1',
      display_name: 'Ada',
      age: undefined,
    },
    { stripUndefined: false },
  )

  assert.equal('age' in preserved, true)
  assert.equal(preserved.age, undefined)
})

test('createModelFormAdapter exposes reusable defaults/insert/update helpers', () => {
  const adapter = createModelFormAdapter(profileModel)
  const defaults = adapter.toDefaults({ display_name: null, age: null })
  const insertPayload = adapter.toInsert({ id: 'p_1', display_name: '', age: '', active: true })
  const updatePayload = adapter.toUpdate({ display_name: '', age: '' })

  assert.equal(defaults.display_name, '')
  assert.equal(defaults.age, '')
  assert.deepEqual(insertPayload, {
    id: 'p_1',
    display_name: null,
    age: null,
    active: true,
  })
  assert.deepEqual(updatePayload, {
    display_name: null,
    age: null,
  })
})
