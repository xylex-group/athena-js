# Resilience and failure handling

Athena keeps connector tasks reliable by wiring every attempt through the runtime's failure strategy and retry helpers.

## Failure strategies

Set `WorldConfig.failureStrategy` to one of the supported policies:

| Strategy | Description |
| --- | --- |
| `retry` | Default. The runtime retries failing connectors according to the attached `RetryConfig`. Useful when transient errors occur on the database or network. |
| `cascade` | Cancels dependent tasks when a connector fails so you can surface the failure immediately while the runtime drains the queue. |
| `compensate` | Allows you to run compensating actions after a failure. Attach a `compensation` callback in your connector to clean up external state. |
| `ignore` | Records the error but keeps the runtime moving. Good for non-critical metrics or telemetry uploads. |
| `quarantine` | Sends the failing task to a quarantine queue for manual inspection.

## Retry configuration

Each `activity` can provide a `retry` block with `maxAttempts`, `delay`, `backoff`, and `jitter`. The shared `RetryStrategy` lives under `strategies/retry.ts`, and helpers like `retryPatterns` and `shouldRetryError` let you reuse the same policy across connectors.

## Logger and metrics

Every connector run emits entries to the built-in `Logger`, including structured metadata such as `activityId`, the active run identifier, and `attempt`. The `MetricsCollector` keeps track of enqueued tasks, running workers, and failure rates so you can plug the data into dashboards or alerting.

## Heartbeats and timeouts

Activities can call `ctx.heartbeat(message)` to keep the runtime informed during long queries. Configure `timeout` and `heartbeatTimeout` on the activity options to stop stuck requests and let the runtime recover gracefully.
