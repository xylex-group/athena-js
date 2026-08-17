"use client";

import type { AthenaClient } from "@xylex-group/athena";
import {
  AthenaQueryClientProvider,
  useMutation,
  useQuery,
} from "@xylex-group/athena/react";
import { useState } from "react";
import {
  assertAthenaSuccess,
  createExampleQueryClient,
  type DemoProductInput,
  type DemoProductRow,
  toDemoProduct,
  toDemoProducts,
} from "./shared";

const queryClient = createExampleQueryClient();

interface ProductsPanelProps {
  athena: AthenaClient;
}

function ProductsPanelInner({ athena }: ProductsPanelProps) {
  const [input, setInput] = useState<DemoProductInput>({
    name: "New Athena Product",
    price: 100,
  });

  const products = useQuery({
    queryFn: async () => {
      const result = await athena
        .from<DemoProductRow>("products")
        .select("id,name,price")
        .limit(50);

      if (result.error) {
        throw new Error(`[${result.status}] list products: ${result.error}`);
      }

      return toDemoProducts(result.data);
    },
    queryKey: ["products"],
    refetchOnWindowFocus: false,
  });

  const createProduct = useMutation({
    mutationFn: async (variables: DemoProductInput) => {
      const result = await athena
        .from<DemoProductRow>("products")
        .insert(variables)
        .select("id,name,price");
      const rawRow = assertAthenaSuccess(result, "create product");
      const row = Array.isArray(rawRow) ? rawRow[0] : rawRow;
      return toDemoProduct(row);
    },
    mutationKey: ["products-create"],
    onSuccess: () => {
      void products.refetch();
    },
  });

  if (products.isLoading) {
    return <p>Loading products...</p>;
  }
  if (products.error) {
    return <p>{products.error.message}</p>;
  }

  return (
    <section>
      <h2>Athena products</h2>
      <button
        disabled={createProduct.isLoading}
        onClick={() => {
          createProduct.mutate(input);
        }}
        type="button"
      >
        {createProduct.isLoading ? "Creating..." : "Create product"}
      </button>
      <button
        onClick={() => {
          void products.refetch();
        }}
        type="button"
      >
        Refetch
      </button>
      <pre>{JSON.stringify(input, null, 2)}</pre>
      <textarea
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value) as DemoProductInput;
            setInput(parsed);
          } catch {
            // Keep last valid input while typing.
          }
        }}
        value={JSON.stringify(input)}
      />
      <ul>
        {products.data?.map((product) => (
          <li key={product.id}>
            {product.name} (${product.price})
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DemoProductsPanel(props: ProductsPanelProps) {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ProductsPanelInner {...props} />
    </AthenaQueryClientProvider>
  );
}
