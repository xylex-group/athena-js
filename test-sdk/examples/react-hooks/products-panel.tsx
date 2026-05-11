'use client'

import React, { useState } from 'react'
import type { AthenaSdkClient } from '@xylex-group/athena'
import {
  AthenaQueryClientProvider,
  useMutation,
  useQuery,
} from '@xylex-group/athena/react'
import {
  assertAthenaSuccess,
  createExampleQueryClient,
  toDemoProduct,
  toDemoProducts,
  type DemoProductRow,
  type DemoProductInput,
} from './shared'

const queryClient = createExampleQueryClient()

type ProductsPanelProps = {
  athena: AthenaSdkClient
}

function ProductsPanelInner({ athena }: ProductsPanelProps) {
  const [input, setInput] = useState<DemoProductInput>({
    name: 'New Athena Product',
    price: 100,
  })

  const products = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const result = await athena
        .from<DemoProductRow>('products')
        .select('id,name,price')
        .limit(50)

      if (result.error) {
        throw new Error(`[${result.status}] list products: ${result.error}`)
      }

      return toDemoProducts(result.data)
    },
    refetchOnWindowFocus: false,
  })

  const createProduct = useMutation({
    mutationKey: ['products-create'],
    mutationFn: async (variables: DemoProductInput) => {
      const result = await athena
        .from<DemoProductRow>('products')
        .insert(variables)
        .select('id,name,price')
        .single()
      const rawRow = assertAthenaSuccess(result, 'create product')
      const row = Array.isArray(rawRow) ? rawRow[0] : rawRow
      return toDemoProduct(row)
    },
    onSuccess: () => {
      void products.refetch()
    },
  })

  if (products.isLoading) return <p>Loading products...</p>
  if (products.error) return <p>{products.error.message}</p>

  return (
    <section>
      <h2>Athena products</h2>
      <button
        onClick={() => {
          createProduct.mutate(input)
        }}
        disabled={createProduct.isLoading}
      >
        {createProduct.isLoading ? 'Creating...' : 'Create product'}
      </button>
      <button
        onClick={() => {
          void products.refetch()
        }}
      >
        Refetch
      </button>
      <pre>{JSON.stringify(input, null, 2)}</pre>
      <textarea
        value={JSON.stringify(input)}
        onChange={event => {
          try {
            const parsed = JSON.parse(event.target.value) as DemoProductInput
            setInput(parsed)
          } catch {
            // Keep last valid input while typing.
          }
        }}
      />
      <ul>
        {products.data?.map(product => (
          <li key={product.id}>
            {product.name} (${product.price})
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DemoProductsPanel(props: ProductsPanelProps) {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ProductsPanelInner {...props} />
    </AthenaQueryClientProvider>
  )
}
