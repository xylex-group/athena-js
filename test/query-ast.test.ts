import { strict as assert } from 'assert'
import { test } from 'node:test'
import { compileSelectShape, selectShapeUsesRelationSchema } from '../src/query-ast.ts'

test('compileSelectShape supports explicit schema targeting on relation nodes', () => {
  assert.equal(
    compileSelectShape({
      user_id: true,
      user: {
        schema: 'athena',
        select: {
          id: true,
        },
      },
    }),
    'user_id,user:athena.user(id)',
  )
})

test('compileSelectShape rejects relation nodes that combine schema and via', () => {
  assert.throws(
    () =>
      compileSelectShape({
        user: {
          schema: 'athena',
          via: 'user_id',
          select: {
            id: true,
          },
        },
      }),
    /cannot combine schema and via yet/,
  )
})

test('compileSelectShape rejects schema targeting when the relation key is already qualified', () => {
  assert.throws(
    () =>
      compileSelectShape({
        'athena.user': {
          schema: 'athena',
          select: {
            id: true,
          },
        },
      }),
    /already resolves to a qualified relation token/,
  )
})

test('selectShapeUsesRelationSchema detects nested schema-targeted relations', () => {
  assert.equal(
    selectShapeUsesRelationSchema({
      case: {
        select: {
          user: {
            schema: 'athena',
            select: {
              id: true,
            },
          },
        },
      },
    }),
    true,
  )
  assert.equal(
    selectShapeUsesRelationSchema({
      case: {
        select: {
          id: true,
        },
      },
    }),
    false,
  )
})
