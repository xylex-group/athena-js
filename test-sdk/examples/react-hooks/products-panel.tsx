'use client'

import { useState } from 'react'
import {
  AthenaQueryClientProvider,
  useMutation,
  useQuery,
} from '@xylex-group/athena/react'
import {
  createDemoProduct,
  createExampleQueryClient,
  listDemoProducts,
  type DemoProductInput,
} from './shared'

const queryClient = createExampleQueryClient()

type ProductsPanelProps = {
  baseUrl: string
}

function ProductsPanelInner({ baseUrl }: ProductsPanelProps) {
  const [input, setInput] = useState<DemoProductInput>({
    name: 'New Demo Product',
    price: 100,
  })

  const products = useQuery({
    queryKey: ['demo-products'],
    queryFn: () => listDemoProducts(baseUrl),
    refetchOnWindowFocus: false,
  })

  const createProduct = useMutation({
    mutationKey: ['demo-products-create'],
    mutationFn: (variables: DemoProductInput) =>
      createDemoProduct(baseUrl, variables),
    onSuccess: () => {
      void products.refetch()
    },
  })

  if (products.isLoading) return <p>Loading demo products...</p>
  if (products.error) return <p>{products.error.message}</p>

  return (
    <section>
      <h2>Demo products</h2>
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
