"use client";

import type { AthenaClient } from "@xylex-group/athena";
import { AthenaQueryClientProvider, useQuery } from "@xylex-group/athena/react";
import { useMemo, useState } from "react";
import {
  createExampleQueryClient,
  type DemoProductRow,
  toDemoProducts,
} from "./shared";

const queryClient = createExampleQueryClient();

interface ManualDemoQueryProps {
  athena: AthenaClient;
}

function ManualDemoQueryInner({ athena }: ManualDemoQueryProps) {
  const [organizationId, setOrganizationId] = useState("");

  const queryKey = useMemo(
    () => ["products", organizationId || "unscoped"],
    [organizationId]
  );

  const products = useQuery({
    enabled: Boolean(organizationId),
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }

      const result = await athena
        .from<DemoProductRow>("products")
        .select("id,name,price")
        .eq("organization_id", organizationId)
        .limit(50);

      if (result.error) {
        throw new Error(
          `[${result.status}] list organization products: ${result.error}`
        );
      }
      return toDemoProducts(result.data);
    },
    queryKey,
  });

  return (
    <section>
      <h2>Manual query example</h2>
      <label htmlFor="organizationId">Organization ID</label>
      <input
        id="organizationId"
        onChange={(event) => {
          setOrganizationId(event.target.value);
        }}
        placeholder="org_123"
        value={organizationId}
      />
      <button
        onClick={() => {
          void products.refetch();
        }}
        type="button"
      >
        Run query
      </button>

      <p>Status: {products.status}</p>
      {products.error ? <p>{products.error.message}</p> : null}
      <pre>{JSON.stringify(products.data ?? [], null, 2)}</pre>
    </section>
  );
}

export function ManualDemoQuery(props: ManualDemoQueryProps) {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ManualDemoQueryInner {...props} />
    </AthenaQueryClientProvider>
  );
}
