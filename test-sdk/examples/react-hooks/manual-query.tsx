'use client'

import { useMemo, useState } from 'react'
import {
  AthenaQueryClientProvider,
  useQuery,
} from '@xylex-group/athena/react'
import { createExampleQueryClient, listDemoProducts } from './shared'

const queryClient = createExampleQueryClient()

type ManualDemoQueryProps = {
  baseUrl: string
}

function ManualDemoQueryInner({ baseUrl }: ManualDemoQueryProps) {
  const [organizationId, setOrganizationId] = useState('')

  const queryKey = useMemo(
    () => ['demo-products', organizationId || 'unscoped'],
    [organizationId],
  )

  const products = useQuery({
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: () => listDemoProducts(baseUrl),
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
