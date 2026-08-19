# Next local-runtime fixture

Canonical app layout for the process-wide Athena root.

```text
lib/athena/root.ts      # createClient from @xylex-group/athena/server
lib/athena/server.ts    # request view (no close / no pool)
lib/athena/browser.ts   # HTTP consumer, no DATABASE_URL
app/api/athena/[...path]/route.ts
app/api/auth/[...all]/route.ts
```

Live Next + Turbopack boot against PostgreSQL is the remaining CI fixture.
This tree is the contract that `create-athena-app` and packed-consumer probes
must emit and import.
