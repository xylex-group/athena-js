import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { createAthenaQueryClient } from "../../src/react/index.ts";
import {
  attachReduxLikeAdapter,
  attachZustandLikeAdapter,
} from "../examples/react-hooks/adapters.ts";
import { ManualDemoQuery } from "../examples/react-hooks/manual-query.tsx";
import { DemoProductsPanel } from "../examples/react-hooks/products-panel.tsx";
import { createExampleAthenaClient } from "../examples/react-hooks/shared.ts";

interface FetchCall {
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function installAthenaGatewayMock(baseUrl: string) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  const products: Array<{
    id: string;
    name: string;
    price: number;
    organization_id?: string;
  }> = [
    { id: "p-1", name: "Chair", organization_id: "org_1", price: 120 },
    { id: "p-2", name: "Desk", organization_id: "org_2", price: 420 },
  ];
  let sequence = products.length;

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    const method = (init?.method ?? "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const body = rawBody
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : null;
    calls.push({ body, method, url });

    if (url.endsWith("/gateway/fetch") && body?.table_name === "products") {
      const conditions = Array.isArray(body.conditions) ? body.conditions : [];
      const orgCondition = conditions.find(
        (condition) =>
          typeof condition === "object" &&
          condition !== null &&
          condition.column === "organization_id" &&
          condition.operator === "eq"
      ) as { value?: unknown } | undefined;

      const rows = orgCondition?.value
        ? products.filter(
            (product) => product.organization_id === orgCondition.value
          )
        : products;

      return new Response(JSON.stringify({ data: rows }), { status: 200 });
    }

    if (url.endsWith("/gateway/insert") && body?.table_name === "products") {
      const insertBody = body.insert_body as
        | { name?: string; price?: number }
        | undefined;
      const row = {
        id: `p-${++sequence}`,
        name: insertBody?.name ?? "Unknown",
        price: typeof insertBody?.price === "number" ? insertBody.price : 0,
      };
      products.push(row);
      return new Response(JSON.stringify({ data: [row] }), { status: 200 });
    }

    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("react examples e2e: DemoProductsPanel uses Athena fetch/insert and refetches after mutation", async () => {
  const baseUrl = "https://mock-athena.local";
  const athena = createExampleAthenaClient({
    apiKey: "test-key",
    athenaUrl: baseUrl,
    client: "test-client",
  });
  const gatewayMock = installAthenaGatewayMock(baseUrl);

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(DemoProductsPanel, { athena }));
      await flush();
    });

    await waitFor(() => renderer?.root.findAllByType("li").length === 2);

    const initialFetchCalls = gatewayMock.calls.filter((call) =>
      call.url.endsWith("/gateway/fetch")
    );
    assert.equal(initialFetchCalls.length, 1);
    assert.equal(initialFetchCalls[0].body?.table_name, "products");

    const createButton = renderer?.root.findAllByType("button")[0];
    await act(async () => {
      createButton.props.onClick();
      await flush();
    });

    await waitFor(() =>
      gatewayMock.calls.some((call) => call.url.endsWith("/gateway/insert"))
    );

    const insertCalls = gatewayMock.calls.filter((call) =>
      call.url.endsWith("/gateway/insert")
    );
    assert.equal(insertCalls.length, 1);
    assert.equal(insertCalls[0].body?.table_name, "products");
    assert.deepEqual(insertCalls[0].body?.insert_body, {
      name: "New Athena Product",
      price: 100,
    });

    const refetchButton = renderer?.root.findAllByType("button")[1];
    await act(async () => {
      refetchButton.props.onClick();
      await flush();
    });

    await waitFor(
      () =>
        gatewayMock.calls.filter((call) => call.url.endsWith("/gateway/fetch"))
          .length >= 2
    );

    const refetchCalls = gatewayMock.calls.filter((call) =>
      call.url.endsWith("/gateway/fetch")
    );
    assert.equal(refetchCalls.length >= 2, true);
    assert.equal(refetchCalls.at(-1).body?.table_name, "products");
    assert.equal(renderer?.root.findAllByType("li").length >= 2, true);
  } finally {
    renderer?.unmount();
    gatewayMock.restore();
  }
});

test("react examples e2e: ManualDemoQuery runs Athena select with organization filter", async () => {
  const baseUrl = "https://mock-athena.local";
  const athena = createExampleAthenaClient({
    apiKey: "test-key",
    athenaUrl: baseUrl,
    client: "test-client",
  });
  const gatewayMock = installAthenaGatewayMock(baseUrl);

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(ManualDemoQuery, { athena }));
      await flush();
    });

    const initialFetchCalls = gatewayMock.calls.filter((call) =>
      call.url.endsWith("/gateway/fetch")
    );
    assert.equal(initialFetchCalls.length, 0);

    const input = renderer?.root.findByType("input");
    await act(async () => {
      input.props.onChange({ target: { value: "org_1" } });
      await flush();
    });

    await waitFor(() =>
      gatewayMock.calls.some((call) => call.url.endsWith("/gateway/fetch"))
    );

    const fetchCall = gatewayMock.calls.find((call) =>
      call.url.endsWith("/gateway/fetch")
    );
    assert(fetchCall);
    const conditions = fetchCall.body?.conditions as Record<string, unknown>[];
    const organizationCondition = conditions.find(
      (condition) =>
        condition.column === "organization_id" &&
        condition.operator === "eq" &&
        condition.value === "org_1"
    );
    assert(organizationCondition);
  } finally {
    renderer?.unmount();
    gatewayMock.restore();
  }
});

test("react examples e2e: Zustand-like adapter receives query and mutation events", async () => {
  const client = createAthenaQueryClient();
  const key = client.getQueryKeyToken(["products"]);
  const mutationKey = client.getMutationKeyToken(["products-create"]);

  const state = {
    events: [] as Array<{ type: string }>,
    querySnapshots: {} as Record<string, unknown>,
  };

  const detach = attachZustandLikeAdapter(client, {
    set(updater) {
      const nextState = updater(state);
      state.querySnapshots = nextState.querySnapshots;
      state.events = nextState.events;
    },
  });

  try {
    await client.executeQuery({
      force: true,
      queryFn: async () => [{ id: "p-1" }],
      queryKey: ["products"],
      queryKeyToken: key,
    });

    await client.executeMutation({
      mutationFn: async () => ({ id: "p-2" }),
      mutationKey: ["products-create"],
      mutationKeyToken: mutationKey,
      variables: { name: "Desk" },
    });

    assert.equal(state.querySnapshots[key] !== null, true);
    assert.equal(state.events.length > 0, true);
    assert.equal(
      state.events.some((event) => event.type === "mutation_updated"),
      true
    );
  } finally {
    detach();
  }
});

test("react examples e2e: Redux-like adapter dispatches deterministic event actions", async () => {
  const client = createAthenaQueryClient();
  const key = client.getQueryKeyToken(["products"]);
  const dispatched: Array<{ type: string; payload: unknown }> = [];

  const detach = attachReduxLikeAdapter(client, {
    dispatch(action) {
      dispatched.push(action);
    },
  });

  try {
    const deferred = createDeferred<Array<{ id: string }>>();

    const pending = client.executeQuery({
      force: true,
      queryFn: async () => deferred.promise,
      queryKey: ["products"],
      queryKeyToken: key,
    });

    deferred.resolve([{ id: "p-1" }]);
    await pending;

    assert.equal(
      dispatched.some(
        (action) => action.type === "athena/runtime/query_updated"
      ),
      true
    );
  } finally {
    detach();
  }
});
