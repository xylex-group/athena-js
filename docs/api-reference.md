# API reference

This document catalogs the runtime and client APIs that make Athena a database driver API gateway SDK.

## Runtime building blocks

### `World`

- **Purpose:** Manages a worker pool, task queue, scheduler, and telemetry so your connector definitions stay reliable.
- **Key methods:**
  - `world.register(...)` accepts connector definitions created with `activity()` and keeps them ready for execution.
  - `world.start()` boots the backend, logger, scheduler, and workers.
  - `world.shutdown()` drains the queue and closes every worker gracefully.
  - `world.execute(name, payload)` runs a connector task by the registered name and returns a handle for awaiting the result.
  - `world.schedule(id, name, payload, cron)` creates a recurring job.
  - `world.scheduleOnce(name, payload, executeAt)` schedules a one-off execution.
  - `world.query(id)` to read the stored state for a connector task.
  - `world.getMetrics()` and `world.getWorkers()` expose telemetry for dashboards.

### `WorldConfig`

Customize the runtime with:

- `minWorkers` / `maxWorkers`: control scaling.
- `scaleThreshold` / `scaleDownThreshold`: when to add or remove workers.
- `persistence`: `hybrid`, `memory`, or `file` storage for task state.
- `failureStrategy`: determines how retries or compensations behave (`retry`, `cascade`, `compensate`, `ignore`, `quarantine`).
- `taskQueues`: route connectors to specific queues.

### Backends and telemetry

- `LocalBackend` provides a default persistence layer with disk+memory storage and a dashboard-ready webhook URL.
- `Backend` is the interface you can implement for custom persistence, queue, auth, and streaming providers.
- `Logger`, `MetricsCollector`, and `HeartbeatMonitor` live under `telemetry/` and are wired into the runtime automatically.

## Connector definitions

- `activity(name, handler, options?)` encapsulates a driver operation.
- Options include `retry`, `timeout`, `heartbeatTimeout`, and `taskQueue`.
- Activities execute inside the `ActivityExecutor`, which tracks attempts, heartbeats, and cancellation.
- The context passed to each activity (`ActivityContext`) exposes `heartbeat(message?)`, `isCancelled()`, and identifiers for tracing.

## Gateway client

Athena ships with a React hook that wraps a light HTTP gateway so browsers stay away from credentials and raw SQL.

### `useAthenaGateway(config?)`

Returns the hook result described in `gateway/types.ts`:

- `fetchGateway(payload, options?)`
- `insertGateway(payload, options?)`
- `updateGateway(payload, options?)`
- `deleteGateway(payload, options?)`
- `isLoading`, `error`, `lastRequest`, `lastResponse`, `baseUrl`

Each call streams structured payloads (`AthenaFetchPayload`, `AthenaInsertPayload`, etc.) and honors the headers, API key, and Supabase settings configured on the hook.

## Retry utilities

- `withRetry(fn, options)` wraps any async function with Athena's retry strategy.
- `retryable(fn)` automatically retries the decorated function inside the runtime.
- `retryPatterns` is a helper for common exponential-backoff timelines.
- `shouldRetryError(err)` centralizes the decision logic for when retries make sense.

## Types overview

- `Activity`, `ActivityOptions`, `ActivityContext`, `ActivityState`
- `WorldConfig`, `WorldMetrics`, `WorkerInfo`, `WorkerStatus`
- `AthenaGateway*` types live under `gateway/types.ts` (see the dedicated documentation for field descriptions).
- `RetryConfig` and `FailureStrategy` govern how connector tasks recover from errors.
