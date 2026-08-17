# SDD: createClient mode/prefer nullish handling (telemetry dual-suite smoke)

| Field | Value |
| --- | --- |
| **Slug** | `create-client-mode-nullish-telemetry-smoke` |
| **Package root** | `packages/athena-js` |
| **Package manager** | `pnpm` (`pnpm-lock.yaml` canonical; npm/bun locks also present) |
| **Kind** | Telemetry / protocol smoke — **no product delta** |
| **Product code** | **Do not change** `src/**` implementers |
| **ADR** | Not required (`adr_needed: false`) |
| **Report dir** | `packages/athena-js/docs/sdd` |
| **Date** | 2026-08-01 |

## Spec

### Title

Telemetry monitor smoke: dual-suite characterization of `createClient` mode/prefer nullish handling (`!= null` vs `!== null`) as currently shipped.

### Problem / user-visible goal

The SDD workflow and its telemetry surfaces (`TELEMETRY|{json}`, `sdd-telemetry.json` / `.jsonl`, gate map) need a **real package path** that exercises the dual-suite protocol end-to-end without inventing a product change.

For `packages/athena-js`, the durable seam is `createClient` → `normalizeCreateClientConfig` → `applyExecutionMode` nullish handling of `mode` / `prefer`. A prior bug treated omitted `mode` as a mode hint (`undefined !== null` is true), forcing storage-only clients through `resolveAthenaExecutionMode` and breaking R2-only construction.

**Goal of this SDD run:** document and prove a **no-product-change** dual-suite path where:

1. **Baseline** encodes shipped nullish semantics and is **GREEN** on current code.
2. **Target** encodes the **same** shipped semantics (acceptance of current behavior) and is also **GREEN** on current code.
3. `dry_run` (spec + suites only) can complete with intentional **dual-green**, proving telemetry/protocol without requiring implement/supersede product work.

This is **not** a behavior change request for users of `@xylex-group/athena`; it is a monitor smoke + locked characterization of a fixed seam.

### Current behavior (what code does today)

Seam: [`packages/athena-js/src/v3-client.ts`](../../src/v3-client.ts) — `applyExecutionMode` (invoked from `normalizeCreateClientConfig` before edge materialization).

```ts
// Use != null so omitted mode/prefer (undefined) are not treated as hints —
// `undefined !== null` is true and previously forced every createClient
// without D1 through resolveAthenaExecutionMode, breaking storage-only clients.
const hasModeHint =
  config.mode != null ||
  config.prefer != null ||
  Boolean(config.env?.ATHENA_EXECUTION_MODE) ||
  Boolean(config.env?.ATHENA_EXECUTION_PREFER);

if (!(hasD1 || hasModeHint)) {
  return config;
}
```

Observed semantics (as shipped):

| Input | `hasModeHint` from `mode`/`prefer` | Effect |
| --- | --- | --- |
| `mode` / `prefer` **omitted** (`undefined`) | false | Not a mode hint; config returned early when no D1 |
| `mode: null` and/or `prefer: null` | false (`null != null` is false) | Same as omitted — not a mode hint |
| Non-null `mode` and/or `prefer` (e.g. `"auto"`, `"gateway"`) | true | Resolution path via `resolveAthenaExecutionMode` |
| Env `ATHENA_EXECUTION_MODE` / `ATHENA_EXECUTION_PREFER` truthy | true | Treated as mode hint even if config fields nullish |

User-visible consequences already covered by green package tests (reuse patterns/fixtures; **not** dual-suite files):

| Existing test | File | Fact |
| --- | --- | --- |
| `createClient storage.r2 alone configures storage-only client` | `test/cloudflare-client.test.ts` | No `mode`/`prefer`/D1/url → storage-only client materializes (`capabilities.mode === "cloudflare-edge"`, R2 put works, DB unconfigured) |
| `createClient mode prefer gateway ignores d1 when url is set` | `test/cloudflare-client.test.ts` | Explicit non-null `mode`/`prefer` resolve; gateway wins over D1 |
| `resolveAthenaExecutionMode` / prefer-gateway cases | `test/cloudflare-runtime.test.ts`, `test/cloudflare-review-regression.test.ts` | Pure resolution + façade contracts |

Config types already allow nullish: `mode?: AthenaExecutionMode | string | null`, `prefer?: AthenaExecutionPrefer | string | null` on `AthenaClientConfig`.

**No** existing `test/sdd/` tree or dedicated mode-nullish dual-suite files.

### Desired behavior (what should be true after this change)

**Identical to current shipped behavior.** There is **no** product intent flip.

After the dual-suite work (tests + this spec only):

1. Omitted or explicit `null` for `mode` / `prefer` still **must not** count as mode hints under `applyExecutionMode`.
2. Storage-only `createClient({ storage: { r2, prefix } })` (mock R2, no D1/url) still materializes and supports object put.
3. Explicit non-null `mode` / `prefer` with D1+url still resolve (e.g. prefer-gateway → `capabilities.mode === "gateway"`, `db.local === false`).
4. Product source under `src/` remains **unchanged** for this smoke.
5. SDD/telemetry can record baseline **GREEN** + target **GREEN** as an intentional **no-delta** dry_run smoke (see protocol note below).

### Acceptance criteria (testable)

1. **Baseline suite exists** under `packages/athena-js/test/sdd/` with titles prefixed `baseline: …` that assert current nullish semantics.
2. **Target suite exists** under `packages/athena-js/test/sdd/` with titles prefixed `target: …` that assert the **same** nullish semantics (mirroring acceptance of shipped behavior, not inverted intent).
3. Running baseline from package CWD is **GREEN** on current product code (no `src/` edits).
4. Running target from package CWD is **GREEN** on current product code (intentional dual-green for smoke).
5. At least one case proves: `createClient({ storage: { r2, prefix } })` with **no** `mode`/`prefer` succeeds (storage-only; mock R2 only).
6. At least one case proves: `createClient({ storage: { r2, prefix }, mode: null, prefer: null })` behaves like omitted (still storage-only; not forced through resolution failure).
7. At least one case proves: explicit non-null mode hint path still works (`mode: "auto"`, `prefer: "gateway"`, mock D1 + url → gateway capabilities).
8. Suites use **mock R2 / mock D1 only** — no live HTTP, no live D1/R2, no network.
9. Suites run via `pnpm test` (includes `test/sdd/**/*.test.ts`) and `pnpm test:sdd` (SDD-only). Shared mocks live in `test/sdd/sdd-mocks.ts`.
10. Product implementers (`packages/athena-js/src/**`) are **not** modified for this smoke.
11. Spec + dual-suite report lives under `packages/athena-js/docs/sdd/`; no new ADR required.
12. If a workflow gate strictly requires target **RED** before `dry_run` stop, document **dual-green as intentional no-delta smoke** rather than inventing inverted product intent (see Protocol note).

### Out of scope

- Changing `applyExecutionMode`, `resolveAthenaExecutionMode`, or any `src/**` product code
- Changing `!==` vs `!=` “the other way” or reintroducing the old bug
- New ADR / changes to ADR 0019 (execution mode façades) beyond optional cross-link
- (Done) package test globs now include `test/sdd/**/*.test.ts` via `pnpm test` / `pnpm test:sdd`
- Live Cloudflare bindings, network fetch, real D1/R2
- Refactoring shared mock helpers out of `cloudflare-client.test.ts` (inline or small local mocks in SDD files is fine)
- Superseding or deleting existing characterization in `test/cloudflare-*.test.ts`
- Full SDD implement → target-only CI supersede lifecycle (smoke stops at dual-green / dry_run)

### Risks

- Workflow gate assumes target is RED on current code; dual-green may fail a strict `target_red` gate unless the run is labeled no-delta smoke / gate waived for characterization-only acceptance.
- Future product edits to `hasModeHint` could break both suites at once (desired for this lock-in; still a blast radius if someone reverts to `!== null`).
- Shared `test/sdd/sdd-mocks.ts` can still drift from richer mocks in `cloudflare-client.test.ts` if edge cases diverge.
- Confusing this smoke with a real feature SDD may lead implementers to “fix” a non-problem.

### ADR

- **`adr_needed`:** `false`
- Rationale: no architecture or public-contract change; shipped nullish semantics already align with ADR 0019 auto/default paths and storage-only construction. Smoke only locks characterization.
- **No draft ADR path.**

## Protocol note (dual-green intentional)

Standard SDD order expects:

```text
Baseline GREEN on current → Target RED on current → Implement → Target GREEN → Supersede baseline
```

This smoke **intentionally collapses** baseline and target to the **same** acceptance surface so that:

- Telemetry can still emit phase/gate events and dual-suite file layout.
- `dry_run: true` proves “spec + suites run” without inventing a false product failure.
- Operators document **dual-green / no-delta** rather than forcing a RED target by asserting the old bug (which would either fail on current code for the wrong reason or require product sabotage).

| Step | Expected for this smoke | Notes |
| --- | --- | --- |
| Spec written | yes | this file |
| Baseline on current code | **PASS** | characterization |
| Target on current code | **PASS** (same assertions) | not RED — intentional |
| Implement product code | **skip** | no product change |
| Supersede baseline | **skip** / N/A | both suites remain documentation of shipped behavior until a real delta SDD |
| Docs / ADR | this report only | no ADR |

If automation cannot accept dual-green, prefer **waiving `target_red`** for this slug over writing a target that asserts broken storage-only clients.

## Proposed dual-suite layout

Invent under the package test tree (not picked up by default `pnpm test` glob):

```text
packages/athena-js/test/sdd/
  create-client-mode-nullish.baseline.test.ts
  create-client-mode-nullish.target.test.ts
```

### Naming

- Baseline titles: `baseline: <current behavior fact>`
- Target titles: `target: <same acceptance fact>` (mirror, do not invert)

### Suggested cases (both suites)

1. `… omitted mode/prefer is not a mode hint (storage-only R2 materializes)`
2. `… explicit null mode/prefer is not a mode hint (storage-only R2 materializes)`
3. `… non-null mode/prefer still resolve (prefer gateway drops local db)`

Reuse patterns from `test/cloudflare-client.test.ts` (`createMockR2`, `createMockD1`, capability assertions). Prefer small local mocks in the SDD files over exporting product refactors.

### Test commands (from `packages/athena-js` CWD)

Default package test (includes nested SDD):

```bash
pnpm test
# → … test/*.test.ts test/sdd/**/*.test.ts

pnpm test:sdd
# → SDD dual-suite only
```

Explicit dual-suite invocation:

```bash
node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit \
  test/sdd/create-client-mode-nullish.baseline.test.ts \
  test/sdd/create-client-mode-nullish.target.test.ts
```

## Related characterization (do not treat as dual-suite)

- `test/cloudflare-client.test.ts` — storage-only R2; mode prefer gateway
- `test/cloudflare-runtime.test.ts` — `resolveAthenaExecutionMode`
- `test/cloudflare-review-regression.test.ts` — prefer/gateway regressions
- ADR 0019 — execution mode resolution and runtime façades (context only)

## Protocol table (fill during run)

| Step | Expected | Actual | Evidence |
| --- | --- | --- | --- |
| Spec written | yes | **yes** | `docs/sdd/create-client-mode-nullish-telemetry-smoke.md` |
| Baseline suite on current code | **PASS** | **PASS** (3/3) | `node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit test/sdd/create-client-mode-nullish.baseline.test.ts test/sdd/create-client-mode-nullish.target.test.ts` → exit 0 |
| Target suite on current code | **PASS** (no-delta) | **PASS** (3/3) | same command; dual-green intentional — not RED |
| Implement | skipped | **skipped** | no `src/**` edits (`git status` clean under `packages/athena-js/src`) |
| Baseline on “new” code | N/A (no delta) | N/A | no product delta |
| Docs / ADR | this file; ADR no | this file; ADR no | no ADR |
| Supersede baseline | skipped (smoke) | skipped | both suites remain lock-in of shipped behavior |
| Target still | **PASS** | **PASS** | intentional dual-green no-delta telemetry smoke |

### Run excerpt (2026-08-01)

```text
✔ baseline: omitted mode/prefer is not a mode hint (storage-only R2 materializes)
✔ baseline: explicit null mode/prefer is not a mode hint (storage-only R2 materializes)
✔ baseline: non-null mode/prefer still resolve (prefer gateway drops local db)
✔ target: omitted mode/prefer is not a mode hint (storage-only R2 materializes)
✔ target: explicit null mode/prefer is not a mode hint (storage-only R2 materializes)
✔ target: non-null mode/prefer still resolve (prefer gateway drops local db)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

**Gate note:** Generic SDD “target must be RED on current” does **not** apply. Dual-green is the success signal for this slug; do not invert product intent to force RED.

## Telemetry

Correlate workflow `telemetry_run_id` / `run_id` with:

- Live: `TELEMETRY|{json}` lines
- Scratch: `sdd-telemetry.json`, `sdd-telemetry.jsonl`
- Durable (if finalize writes): `docs/sdd/*-telemetry.json` next to this report

Gate snapshot expectation for successful **dry_run smoke**:

```json
{
  "baseline_green": true,
  "target_red": false,
  "target_green": true,
  "baseline_superseded": false,
  "dry_run": true,
  "note": "intentional dual-green no-delta telemetry smoke"
}
```

---

## Summary

Lock current `createClient` / `applyExecutionMode` nullish (`!= null`) semantics for `mode`/`prefer` via paired baseline + target SDD suites that both assert shipped behavior. No product implementation, no ADR. Dual-green is the success signal for telemetry/protocol smoke under `packages/athena-js`.
