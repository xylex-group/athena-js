import { strict as assert } from "assert";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "../src/react/index.ts";
import { createAthenaTestSdkServer } from "../test-sdk/src/server.ts";

type DemoProduct = {
  id: string;
  name: string;
  price: number;
};

type DemoProductInput = {
  name: string;
  price: number;
};

function QueryProbe<TData>(props: {
  onChange: (value: UseQueryResult<TData>) => void;
  hook: () => UseQueryResult<TData>;
}) {
  props.onChange(props.hook());
  return null;
}

function QueryMutationProbe(props: {
  baseUrl: string;
  onChange: (value: {
    query: UseQueryResult<DemoProduct[]>;
    mutation: UseMutationResult<DemoProductInput, DemoProduct>;
  }) => void;
}) {
  const query = useQuery<DemoProduct[]>({
    queryKey: ["demo-products"],
    queryFn: async () => {
      const response = await fetch(`${props.baseUrl}/demo/products`);
      const body = (await response.json()) as { data: DemoProduct[] };
      return body.data;
    },
  });

  const mutation = useMutation<DemoProductInput, DemoProduct>({
    mutationKey: ["demo-products-create"],
    mutationFn: async (input) => {
      const response = await fetch(`${props.baseUrl}/demo/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as { data: DemoProduct };
      return body.data;
    },
    onSuccess: () => {
      void query.refetch();
    },
  });

  props.onChange({ query, mutation });
  return null;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
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

async function startServer() {
  const appServer = createAthenaTestSdkServer({
    config: {
      athenaUrl: "https://mock-athena.local",
      athenaApiKey: "test-key",
      athenaClient: "test-client",
    },
  });

  return await new Promise<{
    close: () => Promise<void>;
    baseUrl: string;
  }>((resolve) => {
    const server = appServer.expressApp.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) closeReject(error);
              else closeResolve();
            });
          }),
      });
    });
  });
}

test("react runtime integration: useQuery loads data from test-sdk demo route", async () => {
  const server = await startServer();
  const client = createAthenaQueryClient();
  let latest: UseQueryResult<DemoProduct[]> | undefined;
  let renderer: ReactTestRenderer | undefined;

  try {
    await act(async () => {
      renderer = create(
        createElement(
          AthenaQueryClientProvider,
          { client },
          createElement(QueryProbe, {
            onChange: (value) => {
              latest = value;
            },
            hook: () =>
              useQuery({
                queryKey: ["demo-products"],
                queryFn: async () => {
                  const response = await fetch(`${server.baseUrl}/demo/products`);
                  const body = (await response.json()) as { data: DemoProduct[] };
                  return body.data;
                },
              }),
          }),
        ),
      );
      await flush();
    });

    await waitFor(() => latest?.status === "success");

    assert(latest);
    assert.equal(latest.status, "success");
    assert.equal(Array.isArray(latest.data), true);
    assert.equal(latest.data?.length, 2);
    assert.equal(latest.data?.[0]?.id, "demo-1");
  } finally {
    renderer?.unmount();
    await server.close();
  }
});

test("react runtime integration: useMutation creates product and refetches query in test-sdk flow", async () => {
  const server = await startServer();
  const client = createAthenaQueryClient();
  let snapshot:
    | {
        query: UseQueryResult<DemoProduct[]>;
        mutation: UseMutationResult<DemoProductInput, DemoProduct>;
      }
    | undefined;
  let renderer: ReactTestRenderer | undefined;

  try {
    await act(async () => {
      renderer = create(
        createElement(
          AthenaQueryClientProvider,
          { client },
          createElement(QueryMutationProbe, {
            baseUrl: server.baseUrl,
            onChange: (value) => {
              snapshot = value;
            },
          }),
        ),
      );
      await flush();
    });

    await waitFor(() => snapshot?.query.status === "success");
    assert(snapshot);
    assert.equal(snapshot.query.data?.length, 2);

    await act(async () => {
      snapshot?.mutation.mutate({ name: "Desk Lamp", price: 79 });
      await flush();
    });

    await waitFor(() => snapshot?.mutation.status === "success");
    await waitFor(() => snapshot?.query.data?.length === 3);

    assert(snapshot);
    assert.equal(snapshot.mutation.data?.name, "Desk Lamp");
    assert.equal(snapshot.query.data?.length, 3);
    assert.equal(snapshot.query.data?.[2]?.id, "demo-3");
  } finally {
    renderer?.unmount();
    await server.close();
  }
});
