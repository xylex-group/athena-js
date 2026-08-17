import { strict as assert } from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
} from "../src/react/index.ts";
import { createAthenaTestSdkServer } from "../test-sdk/src/server.ts";

interface DemoProduct {
  id: string;
  name: string;
  price: number;
}

interface DemoProductInput {
  name: string;
  price: number;
}

function QueryProbe(props: {
  onChange: (value: UseQueryResult<any>) => void;
  hook: () => UseQueryResult<any>;
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
    queryFn: async () => {
      const response = await fetch(`${props.baseUrl}/demo/products`);
      const body = (await response.json()) as { data: DemoProduct[] };
      return body.data;
    },
    queryKey: ["demo-products"],
  });

  const mutation = useMutation<DemoProductInput, DemoProduct>({
    mutationFn: async (input) => {
      const response = await fetch(`${props.baseUrl}/demo/products`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as { data: DemoProduct };
      return body.data;
    },
    mutationKey: ["demo-products-create"],
    onSuccess: () => {
      void query.refetch();
    },
  });

  props.onChange({ mutation, query });
  return null;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000
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
      athenaApiKey: "test-key",
      athenaClient: "test-client",
      athenaUrl: "https://mock-athena.local",
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
            server.close((error: Error | undefined) => {
              if (error) {
                closeReject(error);
              } else {
                closeResolve();
              }
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
          { client } as any,
          createElement(QueryProbe, {
            hook: () =>
              useQuery({
                queryFn: async () => {
                  const response = await fetch(
                    `${server.baseUrl}/demo/products`
                  );
                  const body = (await response.json()) as {
                    data: DemoProduct[];
                  };
                  return body.data;
                },
                queryKey: ["demo-products"],
              }),
            onChange: (value) => {
              latest = value as any;
            },
          })
        )
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
          { client } as any,
          createElement(QueryMutationProbe, {
            baseUrl: server.baseUrl,
            onChange: (value) => {
              snapshot = value;
            },
          })
        )
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
