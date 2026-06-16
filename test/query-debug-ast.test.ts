import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, getAthenaDebugAst } from '../src/index.ts'

function createMockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

test('experimental.debugAst attaches compiled select ASTs to results', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200)

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        debugAst: true,
      },
    })

    const result = await client
      .from('users')
      .eq('id', 1)
      .order('created_at', { ascending: false })
      .limit(5)
      .select('id')

    const ast = getAthenaDebugAst(result)
    assert.ok(ast)
    assert.equal(ast.kind, 'select')
    assert.equal(ast.tableName, 'users')
    assert.equal(ast.input.columns, 'id')
    assert.deepEqual(ast.input.state.conditions, [
      { operator: 'eq', column: 'id', value: 1, eq_column: 'id', eq_value: 1 },
    ])
    assert.equal(ast.transport.mode, 'compiled-fetch')
    assert.equal(ast.transport.payload.table_name, 'users')
    assert.equal(ast.transport.payload.columns, 'id')
    assert.deepEqual(ast.transport.payload.sort_by, {
      field: 'created_at',
      direction: 'descending',
    })
    assert.equal(ast.transport.payload.limit, 5)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('experimental.debugAst captures direct findMany AST transport on results', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200)

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        debugAst: true,
        findManyAst: true,
      },
    })

    const result = await client.from('orders').findMany({
      select: {
        id: true,
      },
      where: {
        status: 'open',
      },
      limit: 1,
    })

    const ast = getAthenaDebugAst(result)
    assert.ok(ast)
    assert.equal(ast.kind, 'findMany')
    assert.equal(ast.tableName, 'orders')
    assert.equal(ast.compiled.columns, 'id')
    assert.equal(ast.transport.mode, 'direct-ast-fetch')
    assert.deepEqual(ast.transport.payload, {
      table_name: 'orders',
      select: {
        id: true,
      },
      where: {
        status: {
          eq: 'open',
        },
      },
      limit: 1,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
