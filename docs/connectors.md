# Connectors and activities

Connectors in Athena are defined with the `activity()` helper. Each activity handles a discrete driver task, keeps retries on lock, and reports heartbeats so long-lived requests stay healthy.

## Define a connector

```ts
import { activity } from 'athena-js'

const syncCustomers = activity('sync-customers', async (ctx, { view }) => {
  ctx.heartbeat('starting sync')
  const client = await clientPool.acquire()
  try {
    const rows = await client.query('SELECT * FROM ??', [view])
    return rows
  } finally {
    client.release()
  }
})
```

Each connector is registered with the runtime via `world.register(syncCustomers)` and then executed through the worker pool.

## Activity options

- `retry: RetryConfig` (default is a single attempt). Configure `maxAttempts`, `delay`, and exponential backoff.
- `timeout` / `heartbeatTimeout`: ensure slow drivers are canceled and reported.
- `taskQueue`: pin latency-sensitive connectors to dedicated queues.

## Activity context

The handler receives an `ActivityContext` with:

- `activityId` plus correlated metadata (useful for logging, tracing, and correlating gateway calls).
- `attempt` count so you can tag telemetry.
- `heartbeat(message?)` to extend the heartbeat timer during long queries.
- `isCancelled()` to gracefully bail when the runtime requests it.

## Observability

Activities stream their status to the built-in `Logger` and `MetricsCollector`. Every attempt, retry, success, and failure becomes part of the runtime telemetry so dashboards and alerting can stay current.
