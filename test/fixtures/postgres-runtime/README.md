# postgres-runtime

Self-contained PostgreSQL fixture for `pnpm test:finality`.

Resolution:

1. `ATHENA_TEST_DATABASE_URL`
2. `DATABASE_URL`
3. auto-launch ephemeral Postgres (`docker` or `podman`)

Never skip. The orchestrator auto-launches a local container when no URI is set.
