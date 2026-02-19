# athena-js

Athena is a database driver and API gateway SDK that tames relational backends through a managed worker runtime and a React-friendly gateway client. The runtime keeps connections warm, dispatches connector tasks, and feeds a lightweight HTTP gateway with typed fetch/insert/update/delete helpers so frontend teams never write raw SQL in the browser.

## Highlights

- **Driver runtime:** `World` keeps a pool of workers, retries connector tasks, and exposes hooks for scheduling, telemetry, and graceful shutdown.
- **Gateway client:** `useAthenaGateway` wraps the Athena HTTP gateway with typed payloads, consistent headers, and logging of every call.
- **Observability:** Built-in logger, metrics collector, and heartbeat coverage keep every database route visible and debuggable.

## Quick start

### 1. Install

```bash
npm install athena-js
```

### 2. Bootstrap the runtime

```ts
import { World, activity } from 'athena-js'

const world = new World({ minWorkers: 1 })

const fetchUsers = activity('fetch-users', async (ctx, { table }) => {
  ctx.heartbeat('starting query')
  // open your favorite driver here (pg, mysql2, drizzle, etc.)
  const rows = await connection.query('SELECT * FROM ??', [table])
  ctx.heartbeat('query complete')
  return rows
})

world.register(fetchUsers)
await world.start()
await world.execute('fetch-users', { table: 'users' })
```

### 3. Call the gateway from React

```tsx
'use client'

import { useAthenaGateway } from 'athena-js'
import { useEffect } from 'react'

export function UsersPanel() {
  const { fetchGateway, lastResponse, isLoading, error } = useAthenaGateway({
    baseUrl: 'https://athena-db.com',
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  })

  useEffect(() => {
    fetchGateway({
      table_name: 'users',
      columns: ['id', 'email'],
      limit: 25,
    })
  }, [fetchGateway])

  // render loading / error / data from lastResponse
}
```

## Learn more

- [Getting started](docs/getting-started.md)
- [API reference](docs/api-reference.md)
- [Connectors](docs/connectors.md)
- [Resilience](docs/resilience.md)
- [Runtime](docs/runtime.md)
