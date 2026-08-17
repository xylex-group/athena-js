import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createAthenaQueryClient } from "../src/react/query-client.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

test("getQueryData is undefined when the key was never fetched and does not create an idle entry", () => {
  const client = createAthenaQueryClient();
  const key = ["athena", "read-query", "files"] as const;

  assert.equal(client.getQueryData(key), undefined);
  assert.equal(
    client.getQueryData(key),
    undefined,
    "repeated getQueryData must stay undefined"
  );

  assert.equal(
    client.getQueryData(["ghost"]),
    undefined,
    "unrelated missing keys stay undefined"
  );
});

test("setQueryData writes data, notifies subscribers, and supports a functional updater", () => {
  const client = createAthenaQueryClient();
  const key = ["products"] as const;
  const token = client.getQueryKeyToken(key);
  let notifications = 0;

  const unsubscribe = client.subscribeQuery(token, () => {
    notifications += 1;
  });

  const written = client.setQueryData(key, [{ id: 1 }]);
  assert.deepEqual(written, [{ id: 1 }]);
  assert.deepEqual(client.getQueryData(key), [{ id: 1 }]);
  assert.ok(notifications >= 1, "setQueryData should notify subscribers");

  const updated = client.setQueryData(key, (previous) => [
    ...(previous ?? []),
    { id: 2 },
  ]);
  assert.deepEqual(updated, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(client.getQueryData(key), [{ id: 1 }, { id: 2 }]);

  unsubscribe();
});

test("invalidateQueries matches array keys by structural tuple prefix, not serialization", async () => {
  const client = createAthenaQueryClient();

  await client.executeQuery({
    force: true,
    queryFn: async () => [{ id: "file-1" }],
    queryKey: ["athena", "read-query", "files", 1],
    queryKeyToken: client.getQueryKeyToken([
      "athena",
      "read-query",
      "files",
      1,
    ]),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => [{ id: "order-1" }],
    queryKey: ["athena", "read-query", "orders"],
    queryKeyToken: client.getQueryKeyToken(["athena", "read-query", "orders"]),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => [{ id: "write" }],
    queryKey: ["athena", "write-query"],
    queryKeyToken: client.getQueryKeyToken(["athena", "write-query"]),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => [{ id: "hyphen" }],
    queryKey: ["athena-read-query"],
    queryKeyToken: client.getQueryKeyToken(["athena-read-query"]),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => [{ id: "string-key" }],
    queryKey: "athena-files",
    queryKeyToken: client.getQueryKeyToken("athena-files"),
  });

  await client.invalidateQueries({
    queryKey: ["athena", "read-query"],
    refetch: false,
  });

  assert.equal(
    client.getQueryState(
      client.getQueryKeyToken(["athena", "read-query", "files", 1])
    ).updatedAt,
    undefined
  );
  assert.equal(
    client.getQueryState(
      client.getQueryKeyToken(["athena", "read-query", "orders"])
    ).updatedAt,
    undefined
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken(["athena", "write-query"]))
      .updatedAt,
    undefined,
    "sibling operation must not match tuple prefix"
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken(["athena-read-query"]))
      .updatedAt,
    undefined,
    '["athena"]-style hyphenated first element must not match ["athena","read-query"]'
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken("athena-files")).updatedAt,
    undefined,
    "string keys must not match an array filter"
  );
});

test("string queryKey filters match by equality only", async () => {
  const client = createAthenaQueryClient();

  await client.executeQuery({
    force: true,
    queryFn: async () => 1,
    queryKey: "athena",
    queryKeyToken: client.getQueryKeyToken("athena"),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => 2,
    queryKey: "athena-files",
    queryKeyToken: client.getQueryKeyToken("athena-files"),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => 3,
    queryKey: ["athena"],
    queryKeyToken: client.getQueryKeyToken(["athena"]),
  });

  await client.invalidateQueries({ queryKey: "athena", refetch: false });

  assert.equal(
    client.getQueryState(client.getQueryKeyToken("athena")).updatedAt,
    undefined
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken("athena-files")).updatedAt,
    undefined,
    "string prefix accidents must not invalidate"
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken(["athena"])).updatedAt,
    undefined,
    "string filters must not match array keys"
  );
});

test("invalidateQueries exact:true matches only the full stored key", async () => {
  const client = createAthenaQueryClient();
  const parent = ["athena", "read-query"] as const;
  const child = ["athena", "read-query", "files"] as const;

  await client.executeQuery({
    force: true,
    queryFn: async () => "parent",
    queryKey: parent,
    queryKeyToken: client.getQueryKeyToken(parent),
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => "child",
    queryKey: child,
    queryKeyToken: client.getQueryKeyToken(child),
  });

  await client.invalidateQueries({
    exact: true,
    queryKey: parent,
    refetch: false,
  });

  assert.equal(
    client.getQueryState(client.getQueryKeyToken(parent)).updatedAt,
    undefined
  );
  assert.notEqual(
    client.getQueryState(client.getQueryKeyToken(child)).updatedAt,
    undefined
  );
});

test("invalidateQueries refetches mounted observers and only marks unmounted memory entries stale", async () => {
  const client = createAthenaQueryClient({
    cache: { mode: "memory", staleTime: 60_000 },
  });
  const mountedKey = ["athena", "read-query", "mounted"] as const;
  const unmountedKey = ["athena", "read-query", "unmounted"] as const;
  let mountedCalls = 0;
  let unmountedCalls = 0;

  const mountedToken = client.getQueryKeyToken(mountedKey);
  const unmountedToken = client.getQueryKeyToken(unmountedKey);
  const unsubscribe = client.subscribeQuery(mountedToken, () => undefined);

  await client.executeQuery({
    force: true,
    queryFn: async () => {
      mountedCalls += 1;
      return { n: mountedCalls, source: "mounted" };
    },
    queryKey: mountedKey,
    queryKeyToken: mountedToken,
  });
  await client.executeQuery({
    force: true,
    queryFn: async () => {
      unmountedCalls += 1;
      return { n: unmountedCalls, source: "unmounted" };
    },
    queryKey: unmountedKey,
    queryKeyToken: unmountedToken,
  });

  assert.equal(mountedCalls, 1);
  assert.equal(unmountedCalls, 1);

  await client.invalidateQueries({ queryKey: ["athena", "read-query"] });

  assert.equal(mountedCalls, 2, "mounted observer must refetch");
  assert.equal(unmountedCalls, 1, "unmounted entry must not refetch");
  assert.deepEqual(client.getQueryData(mountedKey), {
    n: 2,
    source: "mounted",
  });
  assert.deepEqual(client.getQueryData(unmountedKey), {
    n: 1,
    source: "unmounted",
  });
  assert.equal(
    client.getQueryState(unmountedToken).updatedAt,
    undefined,
    "unmounted memory entry is stale only"
  );

  unsubscribe();
});

test("getQueryKey is identity for a caller QueryKey in phase 1", () => {
  const client = createAthenaQueryClient();
  const key = ["athena", "read-query", "files"] as const;
  assert.equal(client.getQueryKey(key), key);
  assert.equal(client.getQueryKey("manual"), "manual");
});

test("getQueryState create-on-read does not make getQueryData invent success data", () => {
  const client = createAthenaQueryClient();
  const key = ["never-fetched"] as const;
  const token = client.getQueryKeyToken(key);
  const state = client.getQueryState(token);
  assert.equal(state.status, "idle");
  assert.equal(client.getQueryData(key), undefined);
});

test("setQueryData supersedes an older in-flight executeQuery result", async () => {
  const client = createAthenaQueryClient();
  const key = ["files", "org-a"] as const;
  const token = client.getQueryKeyToken(key);
  const stale = createDeferred<Array<{ id: string; name: string }>>();

  const inflight = client.executeQuery({
    dedupe: false,
    force: true,
    queryFn: async () => stale.promise,
    queryKey: key,
    queryKeyToken: token,
  });

  client.setQueryData(key, [{ id: "1", name: "optimistic.pdf" }]);
  assert.deepEqual(client.getQueryData(key), [
    { id: "1", name: "optimistic.pdf" },
  ]);

  stale.resolve([{ id: "1", name: "stale.pdf" }]);
  const result = await inflight;

  assert.equal(
    (result as { __applied?: boolean }).__applied,
    false,
    "stale in-flight generation must not apply"
  );
  assert.deepEqual(
    client.getQueryData(key),
    [{ id: "1", name: "optimistic.pdf" }],
    "setQueryData must remain canonical after stale fetch resolves"
  );
});

test("invalidateQueries can wait on an inflight mounted refetch", async () => {
  const client = createAthenaQueryClient();
  const key = ["athena", "wait"] as const;
  const token = client.getQueryKeyToken(key);
  const deferred = createDeferred<{ ok: boolean }>();
  let calls = 0;

  const unsubscribe = client.subscribeQuery(token, () => undefined);

  await client.executeQuery({
    force: true,
    queryFn: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true };
      }
      return deferred.promise;
    },
    queryKey: key,
    queryKeyToken: token,
  });

  const invalidating = client.invalidateQueries({ queryKey: key });
  deferred.resolve({ ok: true });
  await invalidating;
  assert.equal(calls, 2);

  unsubscribe();
});
