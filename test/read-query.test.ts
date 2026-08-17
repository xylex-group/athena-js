import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  type AthenaReadQueryClient,
  executeAthenaReadQuery,
  executeAthenaTableQuery,
  resolveAthenaReadQueryPageFetch,
} from "../src/query/read-query.ts";

class FakeTableBuilder {
  filters: Array<{ column: string; operator: string; value: unknown }> = [];
  findManyOptions: unknown;
  limitValue: number | undefined;
  orderValues: Array<{ column: string; options: { ascending: boolean } }> = [];
  pageSizeValue: number | undefined;
  pageValue: number | undefined;
  selectedColumns: string | undefined;
  selectOptions: unknown;

  constructor(
    readonly table: string,
    readonly schema: string | undefined,
    private readonly rows: readonly Record<string, unknown>[],
    private readonly count: number
  ) {}

  currentPage(page: number) {
    this.pageValue = page;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  findMany(options: unknown) {
    this.findManyOptions = options;
    return Promise.resolve({
      data: this.rows,
    });
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderValues.push({ column, options });
    return this;
  }

  pageSize(pageSize: number) {
    this.pageSizeValue = pageSize;
    return this;
  }

  select(columns: string, options?: unknown) {
    this.selectedColumns = columns;
    this.selectOptions = options;

    if (typeof options === "object" && options !== null && "head" in options) {
      return Promise.resolve({ count: this.count });
    }

    return Promise.resolve({
      data: this.rows,
    });
  }
}

function createFakeClient(
  rows: readonly Record<string, unknown>[],
  count: number
) {
  const builders: FakeTableBuilder[] = [];
  const client = {
    db: {
      from: (table: string, options?: { schema?: string }) => {
        const builder = new FakeTableBuilder(
          table,
          options?.schema,
          rows,
          count
        );
        builders.push(builder);
        return builder;
      },
    },
  } as unknown as AthenaReadQueryClient;

  return { builders, client };
}

test("resolveAthenaReadQueryPageFetch keeps pageSize independent of total cap", () => {
  assert.deepEqual(
    resolveAthenaReadQueryPageFetch({ limit: 10, page: 1, pageSize: 25 }),
    { page: 1, pageSize: 10, shouldFetch: true }
  );
  assert.deepEqual(
    resolveAthenaReadQueryPageFetch({ limit: 10, page: 2, pageSize: 5 }),
    { page: 2, pageSize: 5, shouldFetch: true }
  );
  assert.deepEqual(
    resolveAthenaReadQueryPageFetch({ limit: 10, page: 3, pageSize: 5 }),
    { page: 3, pageSize: 5, shouldFetch: false }
  );
  assert.deepEqual(resolveAthenaReadQueryPageFetch({ page: 1, pageSize: 25 }), {
    page: 1,
    pageSize: 25,
    shouldFetch: true,
  });
});

test("executeAthenaReadQuery shortens the last page under a total-row cap", async () => {
  const { builders, client } = createFakeClient([{ id: "1" }], 100);

  await executeAthenaReadQuery({
    client,
    page: 2,
    pageSize: 10,
    query: {
      columns: [{ column: "id", key: "id" }],
      countColumn: "id",
      limit: 15,
      table: "account",
    },
  });

  assert.equal(builders[0].pageValue, 2);
  assert.equal(builders[0].pageSizeValue, 5);
  assert.equal(
    (builders[0].findManyOptions as { limit?: number } | undefined)?.limit,
    undefined
  );
});

test("executeAthenaReadQuery runs findMany with filters, order, limit, and aliases", async () => {
  const { builders, client } = createFakeClient(
    [
      {
        id: "account_1",
        owner: { name: "Ada" },
      },
    ],
    25
  );

  const result = await executeAthenaReadQuery({
    client,
    page: 2,
    pageSize: 5,
    query: {
      columns: [
        { column: "id", key: "accountId" },
        {
          column: "name",
          key: "ownerName",
          relation: { name: "owner", schema: "athena", table: "user" },
        },
      ],
      countColumn: "id",
      filters: [{ column: "active", value: true }],
      limit: 10,
      orderBy: { column: "id", direction: "desc" },
      rowKey: "accountId",
      schema: "athena",
      table: "account",
    },
  });

  assert.equal(result.totalItems, 10);
  assert.deepEqual(result.rows, [
    {
      __rowKey: "account_1",
      accountId: "account_1",
      ownerName: "Ada",
    },
  ]);
  // query.limit caps totalItems only; pageSize owns the page fetch LIMIT.
  assert.deepEqual(builders[0].findManyOptions, {
    orderBy: { ascending: false, column: "id" },
    select: {
      id: true,
      owner: {
        schema: "athena",
        select: { name: true },
      },
    },
    where: { active: true },
  });
  assert.equal(builders[0].pageValue, 2);
  assert.equal(builders[0].pageSizeValue, 5);
  assert.deepEqual(builders[1].filters, [
    { column: "active", operator: "eq", value: true },
  ]);
});

test("executeAthenaReadQuery chains multi-column order for select mode", async () => {
  const { builders, client } = createFakeClient([{ id: "1" }], 1);

  await executeAthenaReadQuery({
    client,
    page: 1,
    pageSize: 10,
    query: {
      columns: [{ column: "id", key: "id" }],
      countColumn: "id",
      mode: "select",
      orderBy: [
        { column: "created_at", direction: "desc" },
        { column: "id", direction: "asc" },
      ],
      table: "account",
    },
  });

  assert.deepEqual(builders[0].orderValues, [
    { column: "created_at", options: { ascending: false } },
    { column: "id", options: { ascending: true } },
  ]);
});

test("executeAthenaReadQuery runs select-string queries with relation selects", async () => {
  const { builders, client } = createFakeClient(
    [
      {
        id: "account_1",
        owner: { name: "Ada" },
      },
    ],
    1
  );

  const result = await executeAthenaReadQuery({
    client,
    page: 1,
    pageSize: 10,
    query: {
      columns: [
        { column: "id", key: "accountId" },
        {
          column: "name",
          key: "ownerName",
          relation: { name: "owner", schema: "athena", table: "user" },
        },
      ],
      countColumn: "id",
      filters: [{ column: "active", value: true }],
      mode: "select",
      schema: "athena",
      table: "account",
    },
  });

  assert.deepEqual(result.rows, [
    {
      __rowKey: "account_1",
      accountId: "account_1",
      ownerName: "Ada",
    },
  ]);
  assert.equal(builders[0].selectedColumns, "id,owner:athena.user(name)");
  assert.equal(builders[1].selectedColumns, "id");
  assert.deepEqual(builders[1].selectOptions, {
    count: "exact",
    head: true,
  });
});

test("executeAthenaTableQuery remains an alias of executeAthenaReadQuery", async () => {
  assert.equal(executeAthenaTableQuery, executeAthenaReadQuery);
});
