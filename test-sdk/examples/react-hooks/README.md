# React runtime examples (`useQuery` / `useMutation`)

These examples place Athena DB calls directly inside `useQuery` and `useMutation` (`createClient` + `athena.from(...).select()/insert()/eq()`), without any TanStack/React Query dependency.

## Files

- `products-panel.tsx`: end-to-end `useQuery` + `useMutation` + manual `refetch` flow.
- `manual-query.tsx`: disabled query pattern (`enabled: false`) with explicit invocation.
- `adapters.ts`: adapter wiring for Zustand-like and Redux-like external state stores.
- `shared.ts`: Athena client factory + small result helpers.

## Athena credentials

Provide Athena connection values in your app:

- `NEXT_PUBLIC_ATHENA_URL`
- `NEXT_PUBLIC_ATHENA_API_KEY`
- Optional: `NEXT_PUBLIC_ATHENA_CLIENT`

Then create a client and pass it into the examples:

```tsx
import { createExampleAthenaClient } from './shared'

const athena = createExampleAthenaClient({
  athenaUrl: process.env.NEXT_PUBLIC_ATHENA_URL!,
  apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY!,
  client: process.env.NEXT_PUBLIC_ATHENA_CLIENT,
})
```

```tsx
import { DemoProductsPanel } from './products-panel'

export default function Page() {
  return <DemoProductsPanel athena={athena} />
}
```

## Direct Athena hook pattern

```tsx
const products = useQuery({
  queryKey: ['products', organizationId],
  enabled: Boolean(organizationId),
  queryFn: async () => {
    const result = await athena
      .from('products')
      .select('id,name,price')
      .eq('organization_id', organizationId)
      .limit(50)

    if (result.error) throw new Error(result.error)
    return result.data ?? []
  },
})

const createProduct = useMutation({
  mutationFn: async (input) => {
    const result = await athena
      .from('products')
      .insert(input)
      .select('id,name,price')
      .single()

    if (result.error || !result.data) throw new Error(result.error ?? 'insert failed')
    return result.data
  },
  onSuccess: () => void products.refetch(),
})
```
