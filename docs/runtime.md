# Runtime architecture

Athena's runtime revolves around the `World` class. It spins up workers, polls the task queue, executes connectors, and exposes telemetry to dashboards.

## Components

- `World` holds the configuration, backend, logger, scheduler, and heartbeat monitor.
- `TaskQueue` is backed by the chosen persistence layer (memory, file, or hybrid). Workers pull jobs from this queue.
- `Worker` instances call `executeTask` to run connectors and report success/failure.
- `Scheduler` runs cron jobs and delayed tasks via the same queue so your connector definitions are reusable for manual and scheduled toil.
- `Logger`, `MetricsCollector`, and `HeartbeatMonitor` track each attempt, start/stop, and worker health.

## Managing the runtime

- Call `world.start()` once, register connectors, and keep the process alive.
- Use `world.shutdown()` during deployments to drain workers.
- `world.getMetrics()` surfaces statistics such as queue length, worker health, and failure counts.

## Scheduling and triggers

- `world.schedule(id, handlerName, payload, cron)` schedules recurring executions using the Cron expression.
- `world.scheduleOnce(handlerName, payload, executeAt)` enqueues future work.
- `world.pauseSchedule(id)`, `resumeSchedule(id)`, and `deleteSchedule(id)` control the scheduler.
- Schedules feed the same queue that manual `world.execute` calls use, ensuring connectors behave the same in both paths.

## Scaling

- `minWorkers`, `maxWorkers`, `scaleThreshold`, and `scaleDownThreshold` configure automatic scaling.
- The world periodically checks the reported workload and adds/removes workers to stay within targets.
- Idle workers are killed gently so your system does not exceed pool limits.

## Observability

- Metrics record totals for queued jobs, running executions, and heartbeat misses.
- Logs include the current `worker.id`, `activityId`, and error context.
- Heartbeat intervals keep long-lived queries visible to dashboards.
