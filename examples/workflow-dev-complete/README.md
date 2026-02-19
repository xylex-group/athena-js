# Complete Workflow Dev Example

comprehensive demonstration of all workflow dev kit api features in worlds-engine

## features demonstrated

### directives
- use workflow directive for pure orchestration
- use step directive for side effecting operations
- deterministic execution and replay safety

### workflow functions
- getWorkflowMetadata returns workflow context
- getStepMetadata returns step execution info
- sleep for deterministic delays
- fetch with automatic retry semantics
- createHook for external system integration
- createWebhook for http callback suspension
- getWritable for streaming workflow data

### orchestration patterns
- parent child workflow hierarchies
- workflow cancellation and propagation
- activity retries with backoff strategies
- compensation logic for saga pattern
- scheduled recurring workflows

### worlds
- local world for development
- pluggable storage queue auth stream providers
- infrastructure abstraction layer

## running the example

install dependencies
```bash
npm install
```

run the example
```bash
npm start
```

## what happens

1 order workflow demonstrates basic orchestration with compensation
2 scheduled workflow runs on cron schedule
3 hook workflow suspends until external approval
4 webhook workflow waits for http callback
5 streaming workflow emits progress updates
6 parent workflow spawns multiple children
7 query workflows to inspect state

## key concepts

workflows are deterministic pure functions that orchestrate steps
steps are retryable side effecting operations
worlds provide pluggable infrastructure backends
hooks and webhooks enable external system integration
streaming allows real time progress updates
compensation provides automatic rollback on failure

## workflow dev parity

this example matches the workflow dev kit api
- same function signatures and behavior
- compatible directive system
- similar world abstraction
- equivalent error handling

worlds-engine provides temporal style durability and distributed execution on top of the workflow dev kit api

