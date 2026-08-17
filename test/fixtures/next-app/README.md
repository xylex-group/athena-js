# Next.js Athena fixture

Minimal App Router shapes used by `test/next-fixture.test.ts` to prove:

- browser import surface (`createAthenaBrowserClient`)
- server import surface (`createAthenaServerClient` + `server-only`)
- explicit public config (no browser `env` bag)
- request-scoped server factory usage in a Route Handler
- package entry graph isolation (`next/headers` / server secrets stay out of the client entry)

This fixture is intentionally not a full Next app (no `next` install / `next build`).
Graph and type checks run from the package test suite against source + built `dist/`.
