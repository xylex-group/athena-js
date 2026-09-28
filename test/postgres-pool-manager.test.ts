import assert from "node:assert/strict";
import { test } from "node:test";
import { createBillingImportDatabaseFromManager } from "../src/billing/import/database.ts";
import type {
  AthenaPostgresClient,
  AthenaPostgresPool,
} from "../src/postgres/driver.ts";
import { createAthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";
import { PostgresDeadline } from "../src/postgres/pool/deadline.ts";
import {
  createPostgresPoolManager,
  type PostgresAcquireRequest,
} from "../src/postgres/pool/manager.ts";

function request(
  deadline = PostgresDeadline.after(1000)
): PostgresAcquireRequest {
  return {
    deadline,
    target: "pooled",
    workload: "query",
  };
}

function createFakePool(input: {
  connect: () => Promise<AthenaPostgresClient>;
}): AthenaPostgresPool & { releases: Array<Error | boolean | undefined> } {
  const releases: Array<Error | boolean | undefined> = [];
  return {
    async connect() {
      const client = await input.connect();
      const release = client.release.bind(client);
      client.release = (error) => {
        releases.push(error);
        release(error);
      };
      return client;
    },
    async end() {},
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
    releases,
  };
}

test("PostgresDeadline reports one monotonic remaining budget", () => {
  let now = 1000;
  const deadline = PostgresDeadline.after(250, () => now);

  assert.equal(deadline.startedAt, 1000);
  assert.equal(deadline.expiresAt, 1250);
  assert.equal(deadline.durationMs, 250);
  assert.equal(deadline.elapsedMs(), 0);
  assert.equal(deadline.remainingMs(), 250);

  now = 1100;
  assert.equal(deadline.elapsedMs(), 100);
  assert.equal(deadline.remainingMs(), 150);
  assert.equal(deadline.expired(), false);

  now = 1300;
  assert.equal(deadline.elapsedMs(), 250);
  assert.equal(deadline.remainingMs(), 0);
  assert.equal(deadline.expired(), true);
});

test("PostgresPoolManager releases an acquired lease exactly once", async () => {
  const client: AthenaPostgresClient = {
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });

  const lease = await manager.acquire(request());
  assert.equal(lease.client, client);
  assert.equal(lease.target, "pooled");
  lease.release();
  lease.release();
  lease.destroy("late destroy");

  assert.deepEqual(pool.releases, [undefined]);
  await manager.close();
});

test("PostgresPoolManager destroys a lease with an uncertain client", async () => {
  const client: AthenaPostgresClient = {
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });

  const lease = await manager.acquire(request());
  lease.destroy(new Error("query failed"));

  assert.equal(pool.releases.length, 1);
  assert.ok(pool.releases[0] instanceof Error);
  await manager.close();
});

test("PostgresPoolManager executes queries through an acquired lease", async () => {
  let poolQueryCalls = 0;
  let clientQueryCalls = 0;
  const client: AthenaPostgresClient = {
    async query() {
      clientQueryCalls += 1;
      return { rowCount: 1, rows: [{ id: 1 }] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  pool.query = async () => {
    poolQueryCalls += 1;
    return { rowCount: 1, rows: [{ id: 2 }] } as never;
  };
  const manager = createPostgresPoolManager({ pool });

  const result = await manager.query(request(), "SELECT 1");

  assert.deepEqual(result.rows, [{ id: 1 }]);
  assert.equal(clientQueryCalls, 1);
  assert.equal(poolQueryCalls, 0);
  assert.deepEqual(pool.releases, [undefined]);
  await manager.close();
});

test("PostgresPoolManager bounds Auth statements in PostgreSQL", async () => {
  const statements: string[] = [];
  const client: AthenaPostgresClient = {
    async query(text) {
      statements.push(text);
      return { rowCount: 1, rows: [{ id: 1 }] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });

  const result = await manager.query(
    { ...request(), workload: "auth" },
    "SELECT 1"
  );

  assert.deepEqual(result.rows, [{ id: 1 }]);
  assert.equal(statements.length, 3);
  assert.match(statements[0] ?? "", /^SET statement_timeout = '[1-9]\d*ms'$/);
  assert.equal(statements[1], "SELECT 1");
  assert.equal(statements[2], "SET statement_timeout = 0");
  assert.deepEqual(pool.releases, [undefined]);
  await manager.close();
});

test("PostgresPoolManager releases a lease when query execution fails with a reusable client", async () => {
  const failure = new Error("query failed");
  const client: AthenaPostgresClient = {
    async query() {
      throw failure;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });

  await assert.rejects(() => manager.query(request(), "SELECT 1"), failure);

  assert.equal(pool.releases.length, 1);
  assert.equal(pool.releases[0], undefined);
  await manager.close();
});

test("PostgresPoolManager destroys a lease when query execution exceeds its deadline", async () => {
  const client: AthenaPostgresClient = {
    async query() {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { rowCount: 1, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });

  await assert.rejects(
    () =>
      manager.query(request(PostgresDeadline.after(10)), "SELECT pg_sleep(1)"),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: string }).code === "ATHENA_POSTGRES_DEADLINE_EXCEEDED"
  );

  assert.equal(pool.releases.length, 1);
  assert.ok(pool.releases[0] instanceof Error);
  await manager.close();
});

test("Auth transaction timeout cannot commit after its lease deadline", async () => {
  let committed = false;
  const client: AthenaPostgresClient = {
    async query(text) {
      if (text === "SELECT delayed") {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (text === "COMMIT") {
        committed = true;
      }
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const runtime = createAthenaPostgresRuntime({ pool });

  await assert.rejects(
    () =>
      runtime.transaction(
        async (transaction) => {
          await transaction.query("SELECT delayed");
        },
        { deadlineMs: 10, workload: "auth" }
      ),
    /deadline exceeded|timeout/i
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(committed, false);
  assert.equal(pool.releases.length, 1);
  assert.notEqual(pool.releases[0], undefined);
  await runtime.close();
});

test("Billing import transactions acquire clients through the pool manager", async () => {
  let poolConnectCalls = 0;
  let poolQueryCalls = 0;
  let clientQueryCalls = 0;
  const statements: string[] = [];
  const client: AthenaPostgresClient = {
    async query(text) {
      clientQueryCalls += 1;
      statements.push(text);
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({
    connect: async () => {
      poolConnectCalls += 1;
      return client;
    },
  });
  pool.query = async () => {
    poolQueryCalls += 1;
    return { rowCount: 0, rows: [] } as never;
  };
  const database = createBillingImportDatabaseFromManager(
    createPostgresPoolManager({ pool })
  );

  await database.transaction(async () => undefined);

  assert.equal(poolConnectCalls, 1);
  assert.equal(poolQueryCalls, 0);
  assert.equal(clientQueryCalls, 2);
  assert.deepEqual(statements, ["BEGIN", "COMMIT"]);
  assert.deepEqual(pool.releases, [undefined]);
});

test("PostgresPoolManager rejects work before an unbounded driver queue", async () => {
  let connectCalls = 0;
  let resolveConnect!: (client: AthenaPostgresClient) => void;
  const pendingConnect = new Promise<AthenaPostgresClient>((resolve) => {
    resolveConnect = resolve;
  });
  const client: AthenaPostgresClient = {
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({
    connect: async () => {
      connectCalls += 1;
      return pendingConnect;
    },
  });
  const manager = createPostgresPoolManager({ maxPendingAcquires: 1, pool });

  const first = manager.acquire(request());
  await assert.rejects(
    () => manager.acquire(request()),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "PostgreSQL admission queue is full"
  );
  assert.equal(connectCalls, 1);

  resolveConnect(client);
  (await first).release();
  await manager.close();
});

test("PostgresPoolManager closes a pool whose initialization is already pending", async () => {
  let resolvePool!: (pool: AthenaPostgresPool) => void;
  let ended = false;
  const pendingPool = new Promise<AthenaPostgresPool>((resolve) => {
    resolvePool = resolve;
  });
  const pool = createFakePool({
    connect: async () => ({
      async query() {
        return { rowCount: 0, rows: [] } as never;
      },
      release() {},
    }),
  });
  pool.end = async () => {
    ended = true;
  };
  const manager = createPostgresPoolManager({
    getPool: () => pendingPool,
    ownership: "owned",
  });

  const acquisition = manager.acquire(request());
  await Promise.resolve();
  const closing = manager.close();
  resolvePool(pool);

  await closing;
  await assert.rejects(acquisition, /pool manager is closed/);
  assert.equal(ended, true);
});

test("PostgreSQL runtime uses savepoints for nested transactions", async () => {
  const statements: string[] = [];
  const client: AthenaPostgresClient = {
    async query(text) {
      statements.push(text);
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const runtime = createAthenaPostgresRuntime({ pool });

  await runtime.transaction(async (outer) => {
    await outer.query("SELECT 'outer'");
    await outer.transaction(async (inner) => {
      await inner.query("SELECT 'inner'");
    });
    await outer.query("SELECT 'after'");
  });

  assert.deepEqual(statements, [
    "BEGIN",
    "SELECT 'outer'",
    'SAVEPOINT "athena_sp_1"',
    "SELECT 'inner'",
    'RELEASE SAVEPOINT "athena_sp_1"',
    "SELECT 'after'",
    "COMMIT",
  ]);
});

test("PostgreSQL runtime releases a savepoint after nested transaction failure", async () => {
  const statements: string[] = [];
  const client: AthenaPostgresClient = {
    async query(text) {
      statements.push(text);
      if (text === "SELECT 'inner'") {
        throw new Error("inner failed");
      }
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const runtime = createAthenaPostgresRuntime({ pool });

  await runtime.transaction(async (outer) => {
    await assert.rejects(() =>
      outer.transaction(async (inner) => {
        await inner.query("SELECT 'inner'");
      })
    );
  });

  assert.deepEqual(statements, [
    "BEGIN",
    'SAVEPOINT "athena_sp_1"',
    "SELECT 'inner'",
    'ROLLBACK TO SAVEPOINT "athena_sp_1"',
    'RELEASE SAVEPOINT "athena_sp_1"',
    "COMMIT",
  ]);
});

test("PostgreSQL runtime destroys the lease when savepoint cleanup fails", async () => {
  const statements: string[] = [];
  const client: AthenaPostgresClient = {
    async query(text) {
      statements.push(text);
      if (text === "SELECT 'inner'") {
        const error = Object.assign(new Error("protocol error"), {
          code: "08P01",
        });
        throw error;
      }
      if (/ROLLBACK TO SAVEPOINT/.test(text)) {
        throw Object.assign(new Error("rollback failed"), { code: "57P01" });
      }
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const runtime = createAthenaPostgresRuntime({ pool });

  await assert.rejects(() =>
    runtime.transaction(async (outer) => {
      await outer.transaction(async (inner) => {
        await inner.query("SELECT 'inner'");
      });
    })
  );

  assert.equal(pool.releases.length, 1);
  assert.notEqual(pool.releases[0], undefined);
});

test("PostgresPoolManager snapshot includes utilization and acquire percentiles", async () => {
  const client: AthenaPostgresClient = {
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
    release() {},
  };
  const pool = createFakePool({ connect: async () => client });
  const manager = createPostgresPoolManager({ pool });
  const lease = await manager.acquire(request());
  const snapshot = await manager.inspect();
  assert.equal(typeof snapshot.utilization, "number");
  assert.equal(typeof snapshot.queueUtilization, "number");
  assert.equal(typeof snapshot.acquireP50, "number");
  assert.equal(typeof snapshot.acquireP95, "number");
  assert.equal(snapshot.byWorkload.query?.active, 1);
  lease.release();
  await manager.close();
});

test("classifyPostgresClientPoison destroys protocol and timeout failures", async () => {
  const { classifyPostgresClientPoison } = await import(
    "../src/postgres/pool/poison.ts"
  );
  assert.equal(
    classifyPostgresClientPoison(
      Object.assign(new Error("statement timeout"), { code: "57014" })
    ),
    "destroy"
  );
  assert.equal(
    classifyPostgresClientPoison({
      code: "ATHENA_POSTGRES_DEADLINE_EXCEEDED",
      phase: "statement",
    }),
    "destroy"
  );
  assert.equal(
    classifyPostgresClientPoison(
      Object.assign(new Error("network reset"), { code: "ECONNRESET" })
    ),
    "destroy"
  );
  assert.equal(
    classifyPostgresClientPoison(
      Object.assign(new Error("protocol error"), { code: "08P01" })
    ),
    "destroy"
  );
  assert.equal(
    classifyPostgresClientPoison(new Error("ROLLBACK failed")),
    "destroy"
  );
  assert.equal(
    classifyPostgresClientPoison(
      Object.assign(new Error("could not serialize access"), { code: "40001" })
    ),
    "release"
  );
  assert.equal(
    classifyPostgresClientPoison(new Error("duplicate key value")),
    "release"
  );
});
