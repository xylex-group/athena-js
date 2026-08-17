# Athena JS SDK Documentation

Package: `@xylex-group/athena@3.0.0`.

This set is split so runtime onboarding, Next.js, auth, typing, generation, and
maintainer history stay on separate tracks.

**Published product docs:** a curated allowlist of these pages is auto-synced
into `apps/docs/content/docs/sdks/athena-js`. How the pipeline works, what is
allowlisted, and day-to-day commands:

→ **[site-publish.md](./site-publish.md)** (dual-publish architecture)

Quick commands: `pnpm docs:site:sync` / `pnpm docs:site:check` from this package,
or `pnpm --dir apps/docs docs:sync-athena-js`. Do not hand-edit generated site
MDX that carries the sync banner.

## Start here

| Situation | Open |
| --- | --- |
| New app, first client | [getting-started.md](getting-started.md) |
| Next.js App Router | [next-js.md](next-js.md) |
| Migrating from 2.16.x | [migration-v2-to-v3.md](migration-v2-to-v3.md) |
| Exact signatures | [api-reference.md](api-reference.md) |
| Every method + example | [complete-method-reference.md](complete-method-reference.md) |

---

## Track A — Runtime client

1. [getting-started.md](getting-started.md) — install, `createClient`, queries, models, diagnostics  
2. [api-reference.md](api-reference.md) — construction, config, context, errors, subpaths  
3. [cloudflare-edge-local.md](cloudflare-edge-local.md) — Workers D1/R2 edge-local (`@xylex-group/athena/cloudflare`)  
4. [request-headers-and-auth-examples.md](request-headers-and-auth-examples.md) — header map and surface cookbook  
5. [findmany-ast-and-server-contract.md](findmany-ast-and-server-contract.md) — `findMany` AST and server contract  
6. [runtime-method-ast-models.md](runtime-method-ast-models.md) — builder AST / payload models  
7. [select-column-aliases.md](select-column-aliases.md) — response field aliases  
8. [read-query.md](read-query.md) — portable page definition + `executeAthenaReadQuery`  
9. [storage/index.md](storage/index.md) — stable `client.storage.*`  
10. [contracts/inventory.md](contracts/inventory.md) — layered DTO inventory (ADR 0021)  
11. [adr/0021-layered-contract-policy.md](adr/0021-layered-contract-policy.md) — Persistence ≠ Athena ≠ domain ≠ API ≠ UI  
12. [complete-method-reference.md](complete-method-reference.md) — exhaustive generated catalog  
13. [cli-command-reference.md](cli-command-reference.md) — CLI  
14. [database-transactions.md](database-transactions.md) — portable `db.transaction` vs interactive `db.withTransaction`

## Track B — Next.js

1. [next-js.md](next-js.md) — browser/server façades, context, package splits  
2. [adr/0014-next-client-construction-facades.md](adr/0014-next-client-construction-facades.md) — contract  
3. [auth-session-bridge.md](auth-session-bridge.md) — app-host httpOnly session bridge  
4. [auth-session-forwarding.md](auth-session-forwarding.md) — session/bearer → gateway context  

## Track C — Athena Auth

1. [auth/index.mdx](auth/index.mdx) — domain auth bindings  
2. [auth-client-bindings.md](auth-client-bindings.md) — compact route map  
3. [auth-routing-proxy-and-direct-upstream.md](auth-routing-proxy-and-direct-upstream.md) — proxy vs direct upstream  
4. [auth-cookies.md](auth-cookies.md) — cookie presence / wipe helpers  
5. [auth-routes.md](auth-routes.md) — auth UI view routing  
6. [athena-auth-url.md](athena-auth-url.md) — base/upstream URL resolution  
7. [auth/use-session.mdx](auth/use-session.mdx) — React `useSession`  
8. [organization-membership.md](organization-membership.md) — org membership patterns  
9. [auth/react-email.mdx](auth/react-email.mdx) / [auth/react-email-api.mdx](auth/react-email-api.mdx) — email templates  
10. [auth/email-templates-send.mdx](auth/email-templates-send.mdx) — admin template send  
11. [auth/local-runtime.md](auth/local-runtime.md) — TypeScript local runtime (`auth.mode: "local"`)  

## Track D — Types and registries

1. [typed-schema-registry.md](typed-schema-registry.md) — models / registries on `createClient`  
2. [type-surface-manifest.md](type-surface-manifest.md) — typed surface inventory  
3. [type-safety-playbook.md](type-safety-playbook.md) — anti-patterns and form alignment  
4. [typecheck-columns.md](typecheck-columns.md) — column IntelliSense  

## Track E — Generator and CI

1. [generator-quickstart.md](generator-quickstart.md) — zero-config, `init`, schema auto-fill  
2. [generator-config.md](generator-config.md) — providers, output, intelligent config ensure, APIs  
3. [cli-command-reference.md](cli-command-reference.md) — `generate` / `init` flags and troubleshooting  
4. [generator-cicd.md](generator-cicd.md) — CI gates, `--no-write-config`, gateway vs direct  
5. [generator-codex-handoff-prompt-pack.md](generator-codex-handoff-prompt-pack.md) — agent handoff (package-only)  

## Track F — Shared utils

1. [utils-and-helpers.md](utils-and-helpers.md) — prefer package helpers over app copies  

## Track G — Maintainers (architecture and history)

1. [site-publish.md](site-publish.md) — **how package docs auto-publish to apps/docs**  
2. [client-internal-architecture.md](client-internal-architecture.md) — module ownership  
3. [adr/README.md](adr/README.md) — accepted ADR catalog (incl. 0014)  
4. [client-v3-consolidation-report.md](client-v3-consolidation-report.md) — design history + ADR 0014 addendum  
5. [client-v3-release-readiness-report.md](client-v3-release-readiness-report.md) — release gates  

Historical reports retain pre-0014 narrative; read the **Post-release addendum**
before treating “constructors removed” language as current API.

---

## Concept map

```text
createClient  (sole primitive materializer)
  ├── createAthenaBrowserClient   @xylex-group/athena/next/client
  └── createAthenaServerClient    @xylex-group/athena/next/server
        └── resolve cookies / bearer / session → createClient

AthenaClient
  ├── .from / .rpc / .query / .request / .withContext
  └── .db · .auth · .chat · .storage · .billing

Optional models → typed tables
Optional generator → athena/models/*
```

## Version lines

| Line | Version meaning |
| --- | --- |
| `@xylex-group/athena` | **3.0.0** — this JS SDK |
| athena-rs / monorepo `openapi.json` | **4.x** — HTTP server contract (independent) |

## Decision snapshot (current)

- One client type: `AthenaClient<TModels>`.
- One materializer: `createClient`.
- Next façades allowed when they only compose `createClient` (ADR 0014).
- Storage and billing are stable namespaces (no experimental enable flags).
- Apps own singleton lifetime; SDK does not cache request-bound clients.
