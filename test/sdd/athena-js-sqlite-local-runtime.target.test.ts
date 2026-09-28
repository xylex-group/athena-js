import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createClient } from "../../src/v3-client.ts";
import type {
  AthenaSqliteExecutor,
  AthenaSqliteStorageValue,
} from "../../src/sqlite-local/contracts.ts";
import { resolveRuntimePlan } from "../../src/runtime/plan/resolve.ts";

function executor(overrides: Partial<AthenaSqliteExecutor> = {}): AthenaSqliteExecutor {
  return {
    capabilities: {
      interrupt: true,
      returning: true,
      savepoints: true,
      transactions: "interactive",
      sqliteVersion: "3.45.0",
    },
    async execute() {
      return {
        columns: ["value"],
        rows: [[1 as AthenaSqliteStorageValue]],
      };
    },
    async transaction(callback) {
      return callback({
        execute: this.execute,
        savepoint: async (_name, nested) => nested(),
      });
    },
    ...overrides,
  };
}

test("SQLite Local is a distinct plan and keeps the executor out of it", () => {
  const injected = executor();
  const plan = resolveRuntimePlan(
    { auth: false, db: { sqlite: { executor: injected } } },
    { environment: "node", trustedNode: true },
  );

  assert.equal(plan.db.transport, "sqlite");
  assert.equal(plan.db.profile, "sqlite-local");
  assert.equal(plan.db.engine, "sqlite");
  assert.equal(plan.db.source, "local-executor");
  assert.equal(plan.db.ownership, "borrowed");
  assert.equal("executor" in plan.db, false);
});

test("SQLite Local uses the existing client database surface and closes borrowed executors", async () => {
  let closed = 0;
  const injected = executor({
    async close() {
      closed += 1;
    },
  });
  const client = createClient({
    auth: false,
    db: { sqlite: { executor: injected } },
  });

  assert.equal("sqlite" in (client.db as object), false);
  assert.equal(client.system.runtime().database, "sqlite-local");
  assert.deepEqual((await client.db.query("select 1")).data, [{ value: 1 }]);
  const structured = await client.from("users").select();
  assert.match(
    structured.error?.message ?? String(structured.error ?? ""),
    /AthenaCanonicalQueryCompiler/,
  );
  await client.close();
  await client.close();
  assert.equal(closed, 0);
});

test("SQLite Local advertises only the currently executable capability surface", async () => {
  const client = createClient({
    auth: false,
    db: { sqlite: { executor: executor() } },
  });

  assert.deepEqual(client.capabilities.db.layers, {
    findManyAst: false,
    flatCrud: false,
    query: true,
    relations: false,
    rpc: false,
  });
  assert.deepEqual(client.capabilities.db.transactions, {
    atomic: false,
    backend: "sqlite-local",
    deferrable: false,
    interactive: false,
    isolationLevels: [],
    readOnly: false,
    savepoints: false,
  });
  await assert.rejects(
    client.db.transaction([
      client.from("users").insert({ id: "u-1" }),
    ] as const),
    /Atomic transactions are not supported/,
  );
});

test("SQLite Local closes an explicitly owned executor and rejects mixed sources", async () => {
  let closed = 0;
  const owned = executor({
    async close() {
      closed += 1;
    },
  });
  const client = createClient({
    auth: false,
    db: { sqlite: { executor: owned, ownership: "owned" } },
  });
  await client.close();
  assert.equal(closed, 1);

  assert.throws(
    () =>
      resolveRuntimePlan(
        {
          auth: false,
          db: { d1: {}, sqlite: { executor: executor() } },
        },
        { environment: "node", trustedNode: true },
      ) &&
      // Validation is deliberately construction-owned, not resolver-owned.
      createClient({
        auth: false,
        db: { d1: {}, sqlite: { executor: executor() } },
      } as Parameters<typeof createClient>[0]),
    /SQLite Local|D1/,
  );
});

test("SQLite Local fails closed for cancellation when interrupt is unavailable", async () => {
  const client = createClient({
    auth: false,
    db: {
      sqlite: {
        executor: executor({
          capabilities: {
            interrupt: false,
            returning: false,
            savepoints: false,
            transactions: "batch",
          },
        }),
      },
    },
  });
  await assert.rejects(
    client.db.query("select 1", { signal: new AbortController().signal }),
    /cancellation|deadlines/i,
  );
  await client.close();
});

test("SQLite Local structured transactions remain gated despite host support", async () => {
  const calls: string[] = [];
  const client = createClient({
    auth: false,
    db: {
      sqlite: {
        executor: executor({
          async execute(sql) {
            calls.push(sql);
            return { columns: ["id"], rows: [["u-1"]] };
          },
          async transaction(callback) {
            return callback({
              execute: async (sql) => {
                calls.push(sql);
                return { columns: ["id"], rows: [["u-1"]] };
              },
            });
          },
        }),
      },
    },
  });
  await assert.rejects(
    client.db.transaction([
      client.from("users").insert({ id: "u-1" }),
    ] as const),
    /Atomic transactions are not supported/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    client.db.withTransaction(async (tx) => {
      await tx.insert("users", { id: "u-2" });
    }),
    /Interactive transactions are not supported/,
  );
  assert.equal(calls.length, 0);
  await client.close();
});

test("Explicit Gateway mode retains precedence over SQLite Local", () => {
  const plan = resolveRuntimePlan(
    {
      auth: false,
      db: { sqlite: { executor: executor() }, url: "https://gateway.test/db" },
      mode: "gateway",
      url: "https://gateway.test",
    },
    { environment: "node", trustedNode: true },
  );
  assert.equal(plan.db.transport, "gateway");
  assert.equal(plan.db.profile, "gateway");
});
