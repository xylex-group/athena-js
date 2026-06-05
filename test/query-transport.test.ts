import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  canUseFindManyAstTransport,
  createSelectTransportPlan,
  findManyAstWhereRequiresLegacyTransport,
  normalizeFindManyAstWhere,
  resolvePagination,
  toFindManyAstOrder,
} from '../src/query-transport.ts'

test('resolvePagination derives limit and offset from currentPage/pageSize', () => {
  assert.deepEqual(
    resolvePagination({
      currentPage: 3,
      pageSize: 25,
    }),
    {
      limit: 25,
      offset: 50,
    },
  )
})

test('resolvePagination preserves explicit limit while deriving a missing offset', () => {
  assert.deepEqual(
    resolvePagination({
      limit: 10,
      currentPage: 2,
      pageSize: 5,
    }),
    {
      limit: 10,
      offset: 5,
    },
  )
})

test('createSelectTransportPlan prefers query transport for typed equality comparisons', () => {
  let receivedColumns: string | string[] | undefined
  const plan = createSelectTransportPlan({
    tableName: 'form_sessions',
    columns: 'session_id',
    state: {
      conditions: [
        {
          operator: 'eq',
          column: 'session_id',
          value: '550e8400-e29b-41d4-a716-446655440000',
          eq_column: 'session_id',
          eq_value: '550e8400-e29b-41d4-a716-446655440000',
          column_cast: 'text',
          eq_column_cast: 'text',
        },
      ],
      limit: 1,
    },
    buildTypedSelectQuery(input) {
      receivedColumns = input.columns
      return 'SELECT "session_id" FROM "form_sessions" LIMIT 1;'
    },
  })

  assert.equal(plan.kind, 'query')
  assert.equal(receivedColumns, 'session_id')
  assert.deepEqual(plan.payload, {
    query: 'SELECT "session_id" FROM "form_sessions" LIMIT 1;',
  })
})

test('createSelectTransportPlan keeps typed equality reads on fetch when count is requested', () => {
  const plan = createSelectTransportPlan({
    tableName: 'form_sessions',
    columns: 'session_id',
    state: {
      conditions: [
        {
          operator: 'eq',
          column: 'session_id',
          value: '550e8400-e29b-41d4-a716-446655440000',
          eq_column: 'session_id',
          eq_value: '550e8400-e29b-41d4-a716-446655440000',
          column_cast: 'text',
          eq_column_cast: 'text',
        },
      ],
    },
    options: {
      count: 'exact',
    },
    buildTypedSelectQuery() {
      throw new Error('typed query fallback should not run when count is requested')
    },
  })

  assert.equal(plan.kind, 'fetch')
  assert.deepEqual(plan.payload, {
    table_name: 'form_sessions',
    columns: 'session_id',
    conditions: [
      {
        operator: 'eq',
        column: 'session_id',
        value: '550e8400-e29b-41d4-a716-446655440000',
        eq_column: 'session_id',
        eq_value: '550e8400-e29b-41d4-a716-446655440000',
        column_cast: 'text',
        eq_column_cast: 'text',
      },
    ],
    limit: undefined,
    offset: undefined,
    current_page: undefined,
    page_size: undefined,
    total_pages: undefined,
    sort_by: undefined,
    strip_nulls: true,
    count: 'exact',
    head: undefined,
  })
})

test('createSelectTransportPlan keeps typed equality reads on fetch for nested relation select strings', () => {
  const plan = createSelectTransportPlan({
    tableName: 'public.chat_subscriptions',
    columns: 'user_id,user:athena.user(id)',
    state: {
      conditions: [
        {
          operator: 'eq',
          column: 'user_id',
          value: '550e8400-e29b-41d4-a716-446655440000',
          eq_column: 'user_id',
          eq_value: '550e8400-e29b-41d4-a716-446655440000',
          column_cast: 'text',
          eq_column_cast: 'text',
        },
      ],
    },
    buildTypedSelectQuery() {
      throw new Error('typed query fallback should not run for nested relation selects')
    },
  })

  assert.equal(plan.kind, 'fetch')
  assert.deepEqual(plan.payload, {
    table_name: 'public.chat_subscriptions',
    select: 'user_id,user:athena.user(id)',
    where: {
      user_id: {
        eq: '550e8400-e29b-41d4-a716-446655440000',
      },
    },
    orderBy: undefined,
    limit: undefined,
    offset: undefined,
    strip_nulls: true,
  })
})

test('createSelectTransportPlan uses structured fetch transport for schema-qualified nested select strings', () => {
  const plan = createSelectTransportPlan({
    tableName: 'chat_subscriptions',
    columns: 'user_id,athena.user(id)',
    state: {
      conditions: [
        {
          operator: 'eq',
          column: 'chat_id',
          value: 'chat_1',
          eq_column: 'chat_id',
          eq_value: 'chat_1',
        },
      ],
      currentPage: 2,
      pageSize: 3,
      order: {
        field: 'created_at',
        direction: 'descending',
      },
    },
    buildTypedSelectQuery() {
      return null
    },
  })

  assert.equal(plan.kind, 'fetch')
  assert.deepEqual(plan.payload, {
    table_name: 'chat_subscriptions',
    select: 'user_id,athena.user(id)',
    where: {
      chat_id: {
        eq: 'chat_1',
      },
    },
    orderBy: {
      created_at: 'desc',
    },
    limit: 3,
    offset: 3,
    strip_nulls: true,
  })
  assert.deepEqual(plan.debug, {
    columns: 'user_id,athena.user(id)',
    conditions: [
      {
        operator: 'eq',
        column: 'chat_id',
        value: 'chat_1',
        eq_column: 'chat_id',
        eq_value: 'chat_1',
      },
    ],
    limit: 3,
    offset: 3,
    order: {
      field: 'created_at',
      direction: 'descending',
    },
  })
})

test('createSelectTransportPlan rejects unsupported count/head combinations for schema-qualified nested select strings', () => {
  assert.throws(
    () =>
      createSelectTransportPlan({
        tableName: 'chat_subscriptions',
        columns: 'user_id,athena.user(id)',
        state: {
          conditions: [],
        },
        options: {
          head: true,
        },
        buildTypedSelectQuery() {
          return null
        },
      }),
    /does not support count\/head options/,
  )
})

test('canUseFindManyAstTransport only allows clean builder state', () => {
  assert.equal(
    canUseFindManyAstTransport({
      conditions: [],
    }),
    true,
  )
  assert.equal(
    canUseFindManyAstTransport({
      conditions: [],
      currentPage: 2,
    }),
    false,
  )
})

test('toFindManyAstOrder maps Athena sort state to AST orderBy input', () => {
  assert.deepEqual(
    toFindManyAstOrder<{ created_at: string }>({
      field: 'created_at',
      direction: 'descending',
    }),
    {
      column: 'created_at',
      ascending: false,
    },
  )
})

test('normalizeFindManyAstWhere expands shorthand equality into explicit operator objects', () => {
  assert.deepEqual(
    normalizeFindManyAstWhere({
      status: 'open',
      active: true,
      or: [
        {
          priority: 'high',
        },
      ],
      not: {
        archived_at: {
          is: null,
        },
      },
    }),
    {
      status: {
        eq: 'open',
      },
      active: {
        eq: true,
      },
      or: [
        {
          priority: {
            eq: 'high',
          },
        },
      ],
      not: {
        archived_at: {
          is: null,
        },
      },
    },
  )
})

test('findManyAstWhereRequiresLegacyTransport detects UUID equality filters that need query fallback', () => {
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      session_id: '550e8400-e29b-41d4-a716-446655440000',
    }),
    true,
  )
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      session_id: {
        eq: '550e8400-e29b-41d4-a716-446655440000',
      },
    }),
    true,
  )
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      status: 'open',
    }),
    false,
  )
})
