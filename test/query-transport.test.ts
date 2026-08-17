import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  canUseFindManyAstTransport,
  createSelectTransportPlan,
  findManyAstWhereRequiresLegacyTransport,
  normalizeFindManyAstWhere,
  resolvePagination,
  toFindManyAstOrder,
} from "../src/query-transport.ts";

test("resolvePagination derives limit and offset from currentPage/pageSize", () => {
  assert.deepEqual(
    resolvePagination({
      currentPage: 3,
      pageSize: 25,
    }),
    {
      limit: 25,
      offset: 50,
    }
  );
});

test("resolvePagination preserves explicit limit while deriving a missing offset", () => {
  assert.deepEqual(
    resolvePagination({
      currentPage: 2,
      limit: 10,
      pageSize: 5,
    }),
    {
      limit: 10,
      offset: 5,
    }
  );
});

test("createSelectTransportPlan prefers query transport for typed equality comparisons", () => {
  let receivedColumns: string | string[] | undefined;
  const plan = createSelectTransportPlan({
    buildTypedSelectQuery(input) {
      receivedColumns = input.columns;
      return 'SELECT "session_id" FROM "form_sessions" LIMIT 1;';
    },
    columns: "session_id",
    state: {
      conditions: [
        {
          column: "session_id",
          column_cast: "text",
          eq_column: "session_id",
          eq_column_cast: "text",
          eq_value: "550e8400-e29b-41d4-a716-446655440000",
          operator: "eq",
          value: "550e8400-e29b-41d4-a716-446655440000",
        },
      ],
      limit: 1,
    },
    tableName: "form_sessions",
  });

  assert.equal(plan.kind, "query");
  assert.equal(receivedColumns, "session_id");
  assert.deepEqual(plan.payload, {
    query: 'SELECT "session_id" FROM "form_sessions" LIMIT 1;',
  });
});

test("createSelectTransportPlan keeps typed equality reads on fetch when count is requested", () => {
  const plan = createSelectTransportPlan({
    buildTypedSelectQuery() {
      throw new Error(
        "typed query fallback should not run when count is requested"
      );
    },
    columns: "session_id",
    options: {
      count: "exact",
    },
    state: {
      conditions: [
        {
          column: "session_id",
          column_cast: "text",
          eq_column: "session_id",
          eq_column_cast: "text",
          eq_value: "550e8400-e29b-41d4-a716-446655440000",
          operator: "eq",
          value: "550e8400-e29b-41d4-a716-446655440000",
        },
      ],
    },
    tableName: "form_sessions",
  });

  assert.equal(plan.kind, "fetch");
  assert.deepEqual(plan.payload, {
    columns: "session_id",
    conditions: [
      {
        column: "session_id",
        column_cast: "text",
        eq_column: "session_id",
        eq_column_cast: "text",
        eq_value: "550e8400-e29b-41d4-a716-446655440000",
        operator: "eq",
        value: "550e8400-e29b-41d4-a716-446655440000",
      },
    ],
    count: "exact",
    current_page: undefined,
    head: undefined,
    limit: undefined,
    offset: undefined,
    page_size: undefined,
    sort_by: undefined,
    strip_nulls: true,
    table_name: "form_sessions",
    total_pages: undefined,
  });
});

test("createSelectTransportPlan keeps typed equality reads on fetch for nested relation select strings", () => {
  const plan = createSelectTransportPlan({
    buildTypedSelectQuery() {
      throw new Error(
        "typed query fallback should not run for nested relation selects"
      );
    },
    columns: "user_id,user:athena.user(id)",
    state: {
      conditions: [
        {
          column: "user_id",
          column_cast: "text",
          eq_column: "user_id",
          eq_column_cast: "text",
          eq_value: "550e8400-e29b-41d4-a716-446655440000",
          operator: "eq",
          value: "550e8400-e29b-41d4-a716-446655440000",
        },
      ],
    },
    tableName: "public.chat_subscriptions",
  });

  assert.equal(plan.kind, "fetch");
  assert.deepEqual(plan.payload, {
    limit: undefined,
    offset: undefined,
    orderBy: undefined,
    select: "user_id,user:athena.user(id)",
    strip_nulls: true,
    table_name: "public.chat_subscriptions",
    where: {
      user_id: {
        eq: "550e8400-e29b-41d4-a716-446655440000",
      },
    },
  });
});

test("createSelectTransportPlan uses structured fetch transport for schema-qualified nested select strings", () => {
  const plan = createSelectTransportPlan({
    buildTypedSelectQuery() {
      return null;
    },
    columns: "user_id,athena.user(id)",
    state: {
      conditions: [
        {
          column: "chat_id",
          eq_column: "chat_id",
          eq_value: "chat_1",
          operator: "eq",
          value: "chat_1",
        },
      ],
      currentPage: 2,
      order: {
        direction: "descending",
        field: "created_at",
      },
      pageSize: 3,
    },
    tableName: "chat_subscriptions",
  });

  assert.equal(plan.kind, "fetch");
  assert.deepEqual(plan.payload, {
    limit: 3,
    offset: 3,
    orderBy: {
      created_at: "desc",
    },
    select: "user_id,athena.user(id)",
    strip_nulls: true,
    table_name: "chat_subscriptions",
    where: {
      chat_id: {
        eq: "chat_1",
      },
    },
  });
  assert.deepEqual(plan.debug, {
    columns: "user_id,athena.user(id)",
    conditions: [
      {
        column: "chat_id",
        eq_column: "chat_id",
        eq_value: "chat_1",
        operator: "eq",
        value: "chat_1",
      },
    ],
    limit: 3,
    offset: 3,
    order: {
      direction: "descending",
      field: "created_at",
    },
  });
});

test("createSelectTransportPlan rejects unsupported count/head combinations for schema-qualified nested select strings", () => {
  assert.throws(
    () =>
      createSelectTransportPlan({
        buildTypedSelectQuery() {
          return null;
        },
        columns: "user_id,athena.user(id)",
        options: {
          head: true,
        },
        state: {
          conditions: [],
        },
        tableName: "chat_subscriptions",
      }),
    /does not support count\/head options/
  );
});

test("canUseFindManyAstTransport only allows clean builder state", () => {
  assert.equal(
    canUseFindManyAstTransport({
      conditions: [],
    }),
    true
  );
  assert.equal(
    canUseFindManyAstTransport({
      conditions: [],
      currentPage: 2,
    }),
    false
  );
});

test("toFindManyAstOrder maps Athena sort state to AST orderBy input", () => {
  assert.deepEqual(
    toFindManyAstOrder<{ created_at: string }>({
      direction: "descending",
      field: "created_at",
    }),
    {
      ascending: false,
      column: "created_at",
    }
  );
});

test("normalizeFindManyAstWhere expands shorthand equality into explicit operator objects", () => {
  assert.deepEqual(
    normalizeFindManyAstWhere({
      active: true,
      not: {
        archived_at: {
          is: null,
        },
      },
      or: [
        {
          priority: "high",
        },
      ],
      status: "open",
    } as any),
    {
      active: {
        eq: true,
      },
      not: {
        archived_at: {
          is: null,
        },
      },
      or: [
        {
          priority: {
            eq: "high",
          },
        },
      ],
      status: {
        eq: "open",
      },
    }
  );
});

test("findManyAstWhereRequiresLegacyTransport detects UUID equality filters that need query fallback", () => {
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
    }),
    true
  );
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      session_id: {
        eq: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    true
  );
  assert.equal(
    findManyAstWhereRequiresLegacyTransport({
      status: "open",
    }),
    false
  );
});
