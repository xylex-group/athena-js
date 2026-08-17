# Athena-js TODO + Linear backfill log

**Branch:** `feat/auth-social-providers`  
**Linear project (all issues):** **Athena**  
**Primary repos:** `athena` (`packages/athena-js`, `apps/docs`) + consumers **demo** / **speedrun-formations**

---

## Field legend

| Field | Values |
|-------|--------|
| **Project** | Always **Athena** |
| **Priority** | `P0` critical · `P1` high · `P2` normal · `P3` low |
| **Effort** | `0`–`5` (0 = track-only/docs-link, 1 = tiny, 2 = small, 3 = medium, 4 = large, 5 = multi-day/epic-sized) |
| **Status** | `Done` · `Done (pending commit)` · `In progress` · `Todo` · `Backlog` |

### Status meanings

| Status | Meaning |
|--------|---------|
| **Done** | Committed on branch (mark Done in Linear when PR merges / or already shippable) |
| **Done (pending commit)** | Implemented in working tree — **not committed**; Linear = In Progress until commit, then Done |
| **Todo** | Not started — open issue |
| **Backlog** | Optional / later |

---

# PART 0 — Linear import table (Athena project)

**Epic (create first in Athena):**

| Field | Value |
|-------|--------|
| Title | `[athena-js] Auth social providers, session bridge, utils absorption, consumer re-exports` |
| Project | **Athena** |
| Priority | **P0** |
| Effort | **5** |
| Status | **In progress** |
| Branch | `feat/auth-social-providers` |

Parent all child issues under this epic. Labels (suggested): `athena-js`, `auth`, `docs`, `sdk`, `backfill`.

---

## Batch A — COMMITTED (backfill as Done)

| ID | Title | Priority | Effort | Status | Notes / commits |
|----|-------|----------|--------|--------|-----------------|
| A1 | Port Better Auth social providers under `auth/social-providers` | P0 | 5 | **Done** | `73ad78fb4`, `f7e4d1810` |
| A2 | Split social-providers + oauth2/jwks; document helpers | P1 | 3 | **Done** | `4b3a57c27`, `283ddcd00` |
| A3 | Next session cookie bridge (handlers, constants, client/server) | P0 | 4 | **Done** | `3c8e00ecb` |
| A4 | Docs: session cookie bridge (SDK + apps/docs) | P1 | 2 | **Done** | `e32c1306e` |
| A5 | Export `hasAuthSessionCookie` + `SESSION_COOKIE_PATTERNS` | P0 | 2 | **Done** | `3bdd42f37` |
| A6 | CLI clearer errors on DB ECONNRESET / connection failure | P1 | 1 | **Done** | `1944645e0` |
| A7 | Export Athena Auth URL helpers + improve CLI messaging | P0 | 3 | **Done** | `5947764fc` |
| A8 | Export/document `clearAuthCookies` + cookie prefixes | P0 | 2 | **Done** | `cf152593b`, `aa88e8aa7` |
| A9 | Export `AuthClient` type (root + react) | P1 | 1 | **Done** | `6301ff3d9` |
| A10 | Export `resolveEmailVerificationCallbackUrl` | P1 | 1 | **Done** | `d025088ff` |
| A11 | Re-export `AuthSocialProvider` from social-providers entry | P1 | 1 | **Done** | `e229d94b2` |
| A12 | Export `requireEnv` / `readEnv` from utils | P1 | 1 | **Done** | `f76652ac7` |
| A13 | Export auth view routes + Auth UI base-url name aliases | P1 | 2 | **Done** | `d2ef762ab` |

**Batch A totals:** 13 issues · Effort sum **28** · All **Done** (committed).

---

## Batch B — UNCOMMITTED (backfill as In Progress → Done after commit)

| ID | Title | Priority | Effort | Status | Key paths |
|----|-------|----------|--------|--------|-----------|
| B1 | `ensureActiveOrganization` + `@xylex-group/athena/organization` entry | P0 | 3 | **Done (pending commit)** | `src/organization/*`, exports, tsup, tests |
| B2 | `createFreshSessionLookupUrl` + disableCookieCache + migration aliases | P0 | 2 | **Done (pending commit)** | `src/utils/athena-auth-url.ts`, tests |
| B3 | `buildAthenaGatewayHeaders` | P1 | 1 | **Done (pending commit)** | `src/utils/athena-request-headers.ts` |
| B4 | `getOriginFromHeaders` + `isDynamicServerUsageError` | P1 | 2 | **Done (pending commit)** | `src/utils/request-origin.ts`, tests |
| B5 | `asNonEmptyString` coercion | P2 | 1 | **Done (pending commit)** | `src/utils/coercions.ts`, tests |
| B6 | typecheckColumns array fix + column/table IntelliSense + models table names | P0 | 4 | **Done (pending commit)** | `select-column-types.ts`, `client.ts`, `db/module.ts`, type-compat tests |
| B7 | `useSession` createClient support docs/types (`UseSessionAuthClient`) | P1 | 2 | **Done (pending commit)** | `src/react/use-session.ts`, use-session docs |
| B8 | Package docs dump (utils, typecheck, org membership, routing, email send, cookies) | P1 | 3 | **Done (pending commit)** | see Part 3 file list |
| B9 | apps/docs Fumadocs pages + meta.json for new athena-js guides | P1 | 3 | **Done (pending commit)** | `apps/docs/content/docs/sdks/athena-js/**` |
| B10 | Wire package exports (`./organization`, utils re-exports, tsup) | P0 | 1 | **Done (pending commit)** | `package.json`, `tsup.config.ts`, `src/index.ts` |

**Batch B totals:** 10 issues · Effort sum **22** · All **Done (pending commit)** — **must commit before Linear Done**.

---

## Batch C — CONSUMER re-export phase (Athena project; link demo/speedrun)

| ID | Title | Priority | Effort | Status | Repo |
|----|-------|----------|--------|--------|------|
| C1 | Speedrun: re-export fresh-session, ensureActive, verification-callback, base-url | P1 | 2 | **Done (pending commit)** | speedrun-formations |
| C2 | Speedrun: clearAuthCookies on signOut; value-helpers; auth-session-cookie re-exports | P1 | 2 | **Done (pending commit)** | speedrun-formations |
| C3 | Speedrun: get-session uses SDK utils (origin, dynamic error, coercions, fresh session) | P1 | 3 | **Done (pending commit)** | speedrun-formations |
| C4 | Speedrun: useSession from `@xylex-group/athena/react` (settings + forms) | P1 | 1 | **Done (pending commit)** | speedrun-formations |
| C5 | Demo: re-export gateway headers, session cookie, verification, base-url, clearAuthCookies | P1 | 2 | **Done (pending commit)** | demo |
| C6 | Demo: useSession from athena/react on settings page | P2 | 1 | **Done (pending commit)** | demo |
| C7 | Consumers: local package link (`file:`/junction) until npm publish | P2 | 1 | **Done (pending commit)** | both (dev-only) |
| C8 | Consumer phase docs (`docs/athena-sdk-reexport-phase.md`) | P3 | 1 | **Done (pending commit)** | both |

**Batch C totals:** 8 issues · Effort sum **13** · All **Done (pending commit)** in consumer trees.

---

## Batch D — FOLLOW-UP (backfill as Todo / Backlog)

| ID | Title | Priority | Effort | Status |
|----|-------|----------|--------|--------|
| D1 | Publish `@xylex-group/athena` with B1–B10; changelog / release notes | P0 | 3 | **Todo** |
| D2 | Consumers pin published version; remove file:/junction | P0 | 2 | **Todo** |
| D3 | Delete consumer `packages/auth/better-auth/**` after full Athena Auth switch | P1 | 4 | **Todo** |
| D4 | Delete consumer `packages/auth/athena-auth-ui/**` mirrors; use published UI only | P1 | 4 | **Todo** |
| D5 | Thin speedrun get-session via `resolveAthenaServerContext` + ensureActive only | P1 | 3 | **Todo** |
| D6 | auth-ui: first-class `crossOriginSessionBridge` + `resolveAthenaAuthRoutingState` | P2 | 4 | **Todo** |
| D7 | auth-ui: `attachWorkspaceDocumentsRuntime` (absorb demo workspace bridge) | P2 | 4 | **Todo** |
| D8 | Optional: `createClientFromEnv` / standard gateway env key catalog | P2 | 3 | **Backlog** |
| D9 | Optional: shared `sendAthenaAuthTemplate` helper (docs/bindings exist today) | P3 | 2 | **Backlog** |
| D10 | Finish remaining social-provider file splits if any incomplete | P3 | 2 | **Backlog** |
| D11 | Fix builder vs createClient experimental generics compatibility | P2 | 3 | **Todo** |
| D12 | Deploy apps/docs with new Fumadocs pages | P1 | 2 | **Todo** |

**Batch D totals:** 12 issues · Effort sum **36** · Open.

---

## Effort / priority summary

| Batch | Count | Effort sum | Priority focus | Status |
|-------|------:|-----------:|----------------|--------|
| A Committed | 13 | 28 | P0–P1 | Done |
| B Uncommitted SDK/docs | 10 | 22 | P0–P1 | Done (pending commit) |
| C Consumers | 8 | 13 | P1–P3 | Done (pending commit) |
| D Follow-up | 12 | 36 | P0–P3 | Todo/Backlog |
| **Epic total** | **43** | **99** | | |

### P0 only (ship blockers)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| Epic | Parent epic | 5 | In progress |
| A1 | Social providers port | 5 | Done |
| A3 | Session bridge | 4 | Done |
| A5 | hasAuthSessionCookie | 2 | Done |
| A7 | Auth URL helpers | 3 | Done |
| A8 | clearAuthCookies | 2 | Done |
| B1 | ensureActiveOrganization | 3 | Done (pending commit) |
| B2 | createFreshSessionLookupUrl | 2 | Done (pending commit) |
| B6 | typecheckColumns / models IntelliSense | 4 | Done (pending commit) |
| B10 | Package export map | 1 | Done (pending commit) |
| D1 | Publish release | 3 | Todo |
| D2 | Consumers pin published version | 2 | Todo |

---

# PART 1 — COMMITTED git commits (reference)

| Commit | Summary | Maps to |
|--------|---------|---------|
| `d2ef762ab` | Auth view routes + base-url aliases | A13 |
| `f76652ac7` | requireEnv / readEnv | A12 |
| `e229d94b2` | AuthSocialProvider re-export | A11 |
| `d025088ff` | resolveEmailVerificationCallbackUrl | A10 |
| `6301ff3d9` | AuthClient type | A9 |
| `aa88e8aa7` | clearAuthCookies thorough docs | A8 |
| `cf152593b` | Cookie prefixes + clearAuthCookies | A8 |
| `5947764fc` | Auth URL helpers + CLI | A7 |
| `1944645e0` | CLI ECONNRESET | A6 |
| `3bdd42f37` | hasAuthSessionCookie | A5 |
| `e32c1306e` | Session bridge docs | A4 |
| `3c8e00ecb` | Session bridge implementation | A3 |
| `283ddcd00` | Provider split + helper docs | A2 |
| `4b3a57c27` | Social-providers / oauth2 split | A2 |
| `f7e4d1810` | Social providers port | A1 |
| `73ad78fb4` | SocialProvider + AccountStatus | A1 |

---

# PART 2 — UNCOMMITTED file inventory (B*)

### Source

- `src/organization/ensure-active-organization.ts`, `src/organization/index.ts` → **B1**
- `src/utils/request-origin.ts` → **B4**
- `src/utils/coercions.ts` (`asNonEmptyString`) → **B5**
- `src/utils/athena-auth-url.ts` (fresh session + aliases) → **B2**
- `src/utils/athena-request-headers.ts` (`buildAthenaGatewayHeaders`) → **B3**
- `src/utils/index.ts` re-exports → **B10**
- `src/select-column-types.ts`, `src/client.ts`, `src/db/module.ts` → **B6**
- `src/react/use-session.ts`, `src/react/index.ts` → **B7**
- `src/index.ts`, `package.json`, `tsup.config.ts` → **B10**
- Tests: `organization-ensure-active`, `request-origin`, `coercions`, `athena-auth-url`, `type-compatibility` → **B***

### Package docs (new)

| File | Priority | Effort | Status | ID |
|------|----------|--------|--------|-----|
| `docs/utils-and-helpers.md` | P1 | 2 | Done (pending commit) | B8 |
| `docs/typecheck-columns.md` | P1 | 2 | Done (pending commit) | B8 |
| `docs/organization-membership.md` | P1 | 2 | Done (pending commit) | B8 |
| `docs/auth-routing-proxy-and-direct-upstream.md` | P1 | 2 | Done (pending commit) | B8 |
| `docs/auth/email-templates-send.mdx` | P2 | 1 | Done (pending commit) | B8 |

### Package docs (expanded)

`index.md`, `getting-started.md`, `athena-auth-url.md`, `auth-cookies.md`, `auth/use-session.mdx`, `auth/admin.mdx`, `auth/organization.mdx`, `auth/index.mdx`, `api-reference.md`, `type-surface-manifest.md`, `typed-schema-registry.md` → **B8**

### apps/docs (new + nav)

| File | ID |
|------|-----|
| `utils-and-helpers.mdx` | B9 |
| `typecheck-columns.mdx` | B9 |
| `organization-membership.mdx` | B9 |
| `auth/auth-url-helpers.mdx` | B9 |
| `auth/routing-proxy-and-direct-upstream.mdx` | B9 |
| `auth/email-templates-send.mdx` | B9 |
| meta.json / indexes / experimental-options / clear-auth-cookies / use-session / admin / organization | B9 |

---

# PART 3 — Conversation topics → Linear IDs

| Topic | Linear ID | Priority | Effort | Status |
|-------|-----------|----------|--------|--------|
| Social providers port | A1–A2 | P0–P1 | 5+3 | Done |
| Session bridge | A3–A4 | P0–P1 | 4+2 | Done |
| hasAuthSessionCookie / patterns | A5 + B8 docs | P0 | 2 | Done / pending docs commit |
| clearAuthCookies | A8 | P0 | 2 | Done |
| Auth URL / requireEnv / AuthClient / verify-email / routes | A7, A9–A13 | P0–P1 | 1–3 | Done |
| CLI ECONNRESET | A6 | P1 | 1 | Done |
| Fresh session URL | B2 | P0 | 2 | Done (pending commit) |
| Gateway headers | B3 | P1 | 1 | Done (pending commit) |
| Origin + dynamic server error | B4 | P1 | 2 | Done (pending commit) |
| asNonEmptyString | B5 | P2 | 1 | Done (pending commit) |
| typecheckColumns + models | B6 | P0 | 4 | Done (pending commit) |
| useSession + createClient | B7 | P1 | 2 | Done (pending commit) |
| Proxy vs direct-upstream | B8 | P1 | 2 | Done (pending commit) |
| Org list vs member / ensureActive | B1 + B8 | P0 | 3 | Done (pending commit) |
| Email template resolve + send docs | B8 | P2 | 1 | Done (pending commit) |
| Utils mega-doc | B8 | P1 | 2 | Done (pending commit) |
| apps/docs | B9 | P1 | 3 | Done (pending commit) |
| Re-export-first consumers | C1–C8 | P1–P3 | 1–3 | Done (pending commit) |
| Publish / pin version | D1–D2 | P0 | 3+2 | **Todo** |
| Delete BA / UI mirrors | D3–D4 | P1 | 4+4 | **Todo** |
| Thin get-session | D5 | P1 | 3 | **Todo** |
| auth-ui routing/bridge product APIs | D6–D7 | P2 | 4 | **Todo** |
| Optional helpers | D8–D10 | P2–P3 | 2–3 | Backlog |
| Builder generics | D11 | P2 | 3 | **Todo** |
| Deploy docs | D12 | P1 | 2 | **Todo** |

---

# PART 4 — Consumer detail (same Athena project)

### speedrun-formations

| Work | ID | Priority | Effort | Status |
|------|-----|----------|--------|--------|
| fresh-session re-export | C1 | P1 | 2 | Done (pending commit) |
| ensureActive re-export | C1 | P1 | — | (same) |
| verification-callback re-export | C1 | P1 | — | (same) |
| base-url → utils + DEFAULT_* | C1 | P1 | — | (same) |
| clearAuthCookies on signOut | C2 | P1 | 2 | Done (pending commit) |
| value-helpers / auth-session-cookie | C2 | P1 | — | (same) |
| get-session SDK utils | C3 | P1 | 3 | Done (pending commit) |
| useSession athena/react | C4 | P1 | 1 | Done (pending commit) |
| re-export phase doc | C8 | P3 | 1 | Done (pending commit) |

### demo

| Work | ID | Priority | Effort | Status |
|------|-----|----------|--------|--------|
| gateway-headers re-export | C5 | P1 | 2 | Done (pending commit) |
| auth-session-cookie / bridge names | C5 | P1 | — | (same) |
| verification + base-url + clearAuthCookies | C5 | P1 | — | (same) |
| settings useSession | C6 | P2 | 1 | Done (pending commit) |
| re-export phase doc | C8 | P3 | 1 | Done (pending commit) |

---

# PART 5 — Pre-existing backlog (Athena project, separate from epic if preferred)

| Title | Priority | Effort | Status |
|-------|----------|--------|--------|
| Fix docs code blocks missing language labels | P3 | 1 | Backlog |
| Deploy docs (Fuma) | P1 | 2 | Todo (overlaps D12) |
| Write web terminal | P3 | 5 | Backlog |
| OpenAPI v3 schema for SDK surface | P2 | 4 | Backlog |
| Publish benchmarks | P3 | 3 | Backlog |
| Easier onboarding | P2 | 3 | Backlog |
| Throughput / fault tolerance (duplicate errors) | P2 | 4 | Backlog |
| Expand fault tolerance | P2 | 3 | Backlog |
| Express standalone connector | P3 | 4 | Backlog |
| Prometheus exporter stub | P3 | 2 | Backlog |
| Realtime stats | P3 | 3 | Backlog |
| Resource usage coverage | P3 | 2 | Backlog |
| Interactive examples on the web | P3 | 5 | Backlog |

---

# PART 6 — Paste into Linear (CSV-style)

```text
Project,Epic,ID,Title,Priority,Effort,Status
Athena,[athena-js] Auth social providers...,—,Epic parent,P0,5,In progress
Athena,[athena-js] Auth social providers...,A1,Port Better Auth social providers under auth/social-providers,P0,5,Done
Athena,[athena-js] Auth social providers...,A2,Split social-providers + oauth2/jwks; document helpers,P1,3,Done
Athena,[athena-js] Auth social providers...,A3,Next session cookie bridge,P0,4,Done
Athena,[athena-js] Auth social providers...,A4,Docs session cookie bridge,P1,2,Done
Athena,[athena-js] Auth social providers...,A5,Export hasAuthSessionCookie + SESSION_COOKIE_PATTERNS,P0,2,Done
Athena,[athena-js] Auth social providers...,A6,CLI ECONNRESET / connection diagnostics,P1,1,Done
Athena,[athena-js] Auth social providers...,A7,Export Athena Auth URL helpers + CLI messaging,P0,3,Done
Athena,[athena-js] Auth social providers...,A8,clearAuthCookies + cookie prefixes + docs,P0,2,Done
Athena,[athena-js] Auth social providers...,A9,Export AuthClient type root + react,P1,1,Done
Athena,[athena-js] Auth social providers...,A10,resolveEmailVerificationCallbackUrl,P1,1,Done
Athena,[athena-js] Auth social providers...,A11,Re-export AuthSocialProvider from social-providers entry,P1,1,Done
Athena,[athena-js] Auth social providers...,A12,requireEnv / readEnv from utils,P1,1,Done
Athena,[athena-js] Auth social providers...,A13,Auth view routes + base-url name aliases,P1,2,Done
Athena,[athena-js] Auth social providers...,B1,ensureActiveOrganization + /organization entry,P0,3,Done (pending commit)
Athena,[athena-js] Auth social providers...,B2,createFreshSessionLookupUrl + aliases,P0,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,B3,buildAthenaGatewayHeaders,P1,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,B4,getOriginFromHeaders + isDynamicServerUsageError,P1,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,B5,asNonEmptyString,P2,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,B6,typecheckColumns array + IntelliSense + models table names,P0,4,Done (pending commit)
Athena,[athena-js] Auth social providers...,B7,useSession createClient docs/types,P1,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,B8,Package docs (utils typecheck org routing email cookies),P1,3,Done (pending commit)
Athena,[athena-js] Auth social providers...,B9,apps/docs Fumadocs pages + nav,P1,3,Done (pending commit)
Athena,[athena-js] Auth social providers...,B10,Package exports organization + utils wiring,P0,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,C1,Speedrun re-exports fresh-session ensureActive base-url verify,P1,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,C2,Speedrun clearAuthCookies value-helpers session-cookie,P1,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,C3,Speedrun get-session SDK utils,P1,3,Done (pending commit)
Athena,[athena-js] Auth social providers...,C4,Speedrun useSession athena/react,P1,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,C5,Demo re-exports headers cookies verification base-url,P1,2,Done (pending commit)
Athena,[athena-js] Auth social providers...,C6,Demo useSession athena/react,P2,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,C7,Consumers file/junction link until publish,P2,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,C8,Consumer re-export phase docs,P3,1,Done (pending commit)
Athena,[athena-js] Auth social providers...,D1,Publish @xylex-group/athena release B1-B10,P0,3,Todo
Athena,[athena-js] Auth social providers...,D2,Consumers pin published version drop file link,P0,2,Todo
Athena,[athena-js] Auth social providers...,D3,Delete consumer better-auth forks,P1,4,Todo
Athena,[athena-js] Auth social providers...,D4,Delete consumer athena-auth-ui mirrors,P1,4,Todo
Athena,[athena-js] Auth social providers...,D5,Thin get-session resolveAthenaServerContext,P1,3,Todo
Athena,[athena-js] Auth social providers...,D6,auth-ui crossOriginSessionBridge + routing state,P2,4,Todo
Athena,[athena-js] Auth social providers...,D7,auth-ui attachWorkspaceDocumentsRuntime,P2,4,Todo
Athena,[athena-js] Auth social providers...,D8,createClientFromEnv optional,P2,3,Backlog
Athena,[athena-js] Auth social providers...,D9,sendAthenaAuthTemplate helper optional,P3,2,Backlog
Athena,[athena-js] Auth social providers...,D10,Remaining social-provider splits,P3,2,Backlog
Athena,[athena-js] Auth social providers...,D11,Builder vs createClient experimental generics,P2,3,Todo
Athena,[athena-js] Auth social providers...,D12,Deploy apps/docs new pages,P1,2,Todo
```

---

# PART 7 — Shipping order (status honesty)

| Step | Action | Then set Linear |
|------|--------|-----------------|
| 1 | Commit **B1–B10** on branch | B* → **Done** |
| 2 | Merge PR for A+B | A* stay **Done** |
| 3 | **D1** publish npm | D1 → Done |
| 4 | **D2** consumers pin version | C7 → Done/cancelled; C* complete |
| 5 | **D3–D4** delete mirrors | only after C* stable |
| 6 | **D5–D12** as capacity | Todo → Done |

---

# PART 8 — What still needs Linear action (highlight)

### Do immediately (backfill)

1. Create epic in **Athena** (P0, effort 5, In progress).  
2. Create **A1–A13** as Done (or one Done umbrella + commit list).  
3. Create **B1–B10** as **In Progress** (or Done only after you commit).  
4. Create **C1–C8** as In Progress / Done-pending-commit under same epic.  
5. Create **D1–D12** as Todo/Backlog with priorities above.

### Blocked on commit (not Done in product until then)

**All B* and C*** — code exists locally; Linear must not say “Done / shipped” until git commit (and for consumers, their repos + publish).

### Open product work (true Todo)

**D1, D2** (P0) → **D3, D4, D5, D12** (P1) → **D6, D7, D11** (P2) → backlog D8–D10.

---

*All issues: Linear project **Athena**. Add Linear issue IDs next to A1… after filing. Effort 0–5 · Priority P0–P3 · Status as above.*
