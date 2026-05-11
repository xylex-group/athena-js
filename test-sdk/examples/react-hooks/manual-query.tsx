'use client'

import { useMemo, useState } from 'react'
import type { AthenaSdkClient } from '@xylex-group/athena'
import {
  AthenaQueryClientProvider,
  useQuery,
} from '@xylex-group/athena/react'
import {
  createExampleQueryClient,
  toDemoProducts,
  type DemoProductRow,
} from './shared'

const queryClient = createExampleQueryClient()

type ManualDemoQueryProps = {
  athena: AthenaSdkClient
}

function ManualDemoQueryInner({ athena }: ManualDemoQueryProps) {
  const [organizationId, setOrganizationId] = useState('')

  const queryKey = useMemo(
    () => ['products', organizationId || 'unscoped'],
    [organizationId],
  )

  const products = useQuery({
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: () => {
      if (!organizationId) {
        return Promise.resolve([])
      }

      return athena
        .from<DemoProductRow>('products')
        .select('id,name,price')
        .eq('organization_id', organizationId)
        .limit(50)
        .then((result) => {
          if (result.error) {
            throw new Error(
              `[${result.status}] list organization products: ${result.error}`,
            )
          }
          return toDemoProducts(result.data)
        })
    },
  })

  return (
    <section>
      <h2>Manual query example</h2>
      <label htmlFor='organizationId'>Organization ID</label>
      <input
        id='organizationId'
        value={organizationId}
        onChange={event => {
          setOrganizationId(event.target.value)
        }}
        placeholder='org_123'
      />
      <button
        onClick={() => {
          void products.refetch()
        }}
      >
        Run query
      </button>

      <p>Status: {products.status}</p>
      {products.error ? <p>{products.error.message}</p> : null}
      <pre>{JSON.stringify(products.data ?? [], null, 2)}</pre>
    </section>
  )
}

export function ManualDemoQuery(props: ManualDemoQueryProps) {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ManualDemoQueryInner {...props} />
    </AthenaQueryClientProvider>
  )
}
