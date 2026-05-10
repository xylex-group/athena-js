# React runtime examples (`useQuery` / `useMutation`)

These examples target the local `test-sdk` server and show the Athena React runtime APIs without any TanStack/React Query dependency.

## Files

- `products-panel.tsx`: end-to-end `useQuery` + `useMutation` + manual `refetch` flow.
- `manual-query.tsx`: disabled query pattern (`enabled: false`) with explicit invocation.
- `adapters.ts`: adapter wiring for Zustand-like and Redux-like external state stores.
- `shared.ts`: local demo API calls and query-client factory.

## Local demo backend

Start `test-sdk`:

```bash
cd test-sdk
pnpm install
pnpm start -- --port 4000
```

The examples expect `baseUrl` like `http://127.0.0.1:4000` and use:

- `GET /demo/products`
- `POST /demo/products`

These demo routes are local and do not require live Athena credentials.

## Example usage

```tsx
import { DemoProductsPanel } from "./products-panel";

export default function Page() {
  return <DemoProductsPanel baseUrl="http://127.0.0.1:4000" />;
}
```
