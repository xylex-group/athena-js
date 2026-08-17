import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createAthenaQueryClient } from "../src/react/query-client.ts";
import type { AthenaRuntimeEvent } from "../src/react/types.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

test("query client dedupes inflight requests for the same key", async () => {
  const client = createAthenaQueryClient();
  const key = client.getQueryKeyToken(["products"]);
  const deferred = createDeferred<Array<{ id: number }>>();
  let calls = 0;

  const run = () =>
    client.executeQuery({
      dedupe: true,
      force: true,
      queryFn: async () => {
        calls += 1;
        return deferred.promise;
      },
      queryKey: ["products"],
      queryKeyToken: key,
    });

  const first = run();
  const second = run();

  assert.equal(calls, 1, "queryFn should only execute once while inflight");

  deferred.resolve([{ id: 1 }]);

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult.data, [{ id: 1 }]);
  assert.deepEqual(secondResult.data, [{ id: 1 }]);
  assert.equal(firstResult.error, null);
  assert.equal(secondResult.error, null);
});

test("query client keeps newest request result when slow older request finishes later", async () => {
  const client = createAthenaQueryClient();
  const key = client.getQueryKeyToken(["users"]);
  const slow = createDeferred<Array<{ id: string }>>();
  const fast = createDeferred<Array<{ id: string }>>();

  const slowRun = client.executeQuery({
    dedupe: false,
    force: true,
    queryFn: async () => slow.promise,
    queryKey: ["users"],
    queryKeyToken: key,
  });

  const fastRun = client.executeQuery({
    dedupe: false,
    force: true,
    queryFn: async () => fast.promise,
    queryKey: ["users"],
    queryKeyToken: key,
  });

  fast.resolve([{ id: "new" }]);
  const fastResult = await fastRun;
  assert.deepEqual(fastResult.data, [{ id: "new" }]);

  slow.resolve([{ id: "old" }]);
  await slowRun;

  const state = client.getQueryState<Array<{ id: string }>>(key);
  assert.equal(state.status, "success");
  assert.deepEqual(state.data, [{ id: "new" }]);
});

test("query client emits adapter and event bus updates", async () => {
  const client = createAthenaQueryClient();
  const key = client.getQueryKeyToken(["audit"]);

  const eventBus: AthenaRuntimeEvent[] = [];
  const queryEvents: AthenaRuntimeEvent[] = [];

  const detachEvents = client.subscribeEvents((event) => {
    eventBus.push(event);
  });

  const detachAdapter = client.attachAdapter({
    onEvent(event) {
      queryEvents.push(event);
    },
  });

  const result = await client.executeQuery({
    dedupe: true,
    force: true,
    queryFn: async () => ({
      data: [{ id: 99 }],
      error: null,
      raw: { ok: true },
      status: 200,
    }),
    queryKey: ["audit"],
    queryKeyToken: key,
  });

  assert.equal(result.error, null);
  assert.equal(
    eventBus.some((event) => event.type === "query_updated"),
    true
  );
  assert.equal(
    queryEvents.some((event) => event.type === "query_updated"),
    true
  );

  client.resetQuery(["audit"]);
  assert.equal(
    eventBus.some((event) => event.type === "query_reset"),
    true
  );

  detachEvents();
  detachAdapter();
});

test("mutation client keeps newest mutation state (last invocation wins)", async () => {
  const client = createAthenaQueryClient();
  const key = client.getMutationKeyToken(["create-user"]);
  const slow = createDeferred<{ id: string }>();
  const fast = createDeferred<{ id: string }>();

  const slowRun = client.executeMutation({
    mutationFn: async () => slow.promise,
    mutationKey: ["create-user"],
    mutationKeyToken: key,
    variables: { name: "slow" },
  });

  const fastRun = client.executeMutation({
    mutationFn: async () => fast.promise,
    mutationKey: ["create-user"],
    mutationKeyToken: key,
    variables: { name: "fast" },
  });

  fast.resolve({ id: "new" });
  await fastRun;

  slow.resolve({ id: "old" });
  await slowRun;

  const state = client.getMutationState<{ name: string }, { id: string }>(key);
  assert.equal(state.status, "success");
  assert.deepEqual(state.data, { id: "new" });
  assert.deepEqual(state.lastVariables, { name: "fast" });
});
