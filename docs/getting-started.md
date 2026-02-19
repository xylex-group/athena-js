# Getting started with athena-js

Athena is a database driver API gateway SDK that keeps SQL access predictable and secure. The runtime manages a pool of worker processes, retries connector tasks, and feeds a small HTTP gateway so your React clients talk to structured data endpoints instead of raw SQL.

## Install

```bash
npm install athena-js
```

Pair it with the runtime in the server and the gateway hook in the client to keep everything in sync.

## Runtime sketch

```ts
import { World, activity } from 'athena-js'

const world = new World({ minWorkers: 1 })

const fetchOrders = activity('fetch-orders', async (ctx, { table }) => {
  ctx.heartbeat('querying orders table')
  const result = await db.query('SELECT * FROM ?? WHERE status = $1', [table, 'open'])
  return result.rows
})

world.register(fetchOrders)
await world.start()
await world.execute('fetch-orders', { table: 'orders' })
```

Workers keep retries, heartbeats, and retries in the background so each connector call is resilient.

## Gateway hook

```tsx
'use client'

import { useAthenaGateway } from 'athena-js'
import { useEffect } from 'react'

export function OrdersPanel() {
  const { fetchGateway, isLoading, lastResponse } = useAthenaGateway({
    baseUrl: 'https://athena-db.com',
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  })

  useEffect(() => {
    fetchGateway({
      table_name: 'orders',
      columns: ['id', 'total', 'status'],
      limit: 15,
    })
  }, [fetchGateway])

  // render loading, lastResponse.data.rows, and so on
}
```

## Next steps

- Use the gateway hook for typed fetch/insert/update/delete calls.
- Add connector activities for every database integration and register them with the runtime.
- Tune the `World` config for worker counts, scaling, and telemetry.
