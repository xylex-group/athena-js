# changelog

all notable changes to athena-js will be documented here.

## [0.1.0] - 2025-12-01

### initial release

first public release of athena-js. includes:

#### core features
-[x] deterministic runtime coordination for connector tasks
-[x] activity execution with automatic retries
-[x] saga pattern for compensations
-[x] event sourcing for durability
-[x] parent/child connector hierarchies
-[x] cancellation propagation

#### persistence
-[x] memory storage (fast, ephemeral)
-[x] file storage (durable)
-[x] hybrid storage (best of both, suitable for local demos)

#### scheduling
-[x] cron-powered recurring executions
-[x] one-time scheduled execution
-[x] pause/resume schedules

#### auto-scaling
-[x] worker pool management
-[x] automatic scale up/down based on load
-[x] configurable min/max workers

#### failure handling
-[x] multiple failure strategies (compensate, retry, cascade, ignore, quarantine)
-[x] configurable retry with backoff (linear, exponential, constant)
-[x] timeout handling
-[x] heartbeat monitoring

#### monitoring
-[x] real-time metrics collection
-[x] throughput tracking
-[x] task state queries
-[x] activity progress tracking

#### cli
-[x] blessed-based real-time dashboard
-[x] live worker status display
-[x] workload visualization
-[x] metrics display

#### testing
-[x] test harness with time control
-[x] deterministic testing support
-[x] time skipping utilities

#### documentation
-[x] comprehensive readme
-[x] getting started guide
-[x] runtime architecture deep dive
-[x] activity best practices
-[x] resilience guide
-[x] multiple working examples

#### examples
-[x] database connection starter
-[x] express api integration
-[x] order saga with compensations

### known limitations
-[x] single-process only (no distributed mode yet)
-[x] file storage not optimized for huge scale
-[x] no persistence to external databases yet
-[x] test coverage could be better

### roadmap for future releases
-[] distributed mode with redis/postgres
-[] more example projects
-[] comprehensive test suite
-[] performance optimizations
-[] graphql api for monitoring
-[] web-based dashboard
-[] more scheduling features
-[] connector versioning
