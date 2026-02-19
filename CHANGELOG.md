# changelog

fucking wrote this in less timea meeting with temportal wouldd of been

all notable changes to worlds-engine will be documented here.

## [0.1.0] - 2025-12-01

### initial release

first public release of worlds-engine. includes:

#### core features
-[x] workflow orchestration with deterministic execution
-[x] activity execution with automatic retries
-[x] saga pattern for compensations
-[x] event sourcing for durability
-[x] parent/child workflow hierarchies
-[x] cancellation propagation

#### persistence
-[x] memory storage (fast, ephemeral)
-[x] file storage (durable)
-[x] hybrid storage (best of bothm, glitchy as FUCK do not use this boss)

#### scheduling
-[x] cron-based recurring workflows
-[x] one-time scheduled execution
-[x] pause/resume schedules

#### auto-scaling
-[x] worker (worker) pool management
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
-[x] workflow state queries
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
-[x] workflow deep dive
-[x] activity best practices
-[x] failure strategies guide
-[x] multiple working examples

#### examples
-[x] basic workflow
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
-[] workflow versioning

