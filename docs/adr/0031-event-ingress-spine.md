# ADR 0031: Internal Event Ingress Spine

**Date:** 2026-08-26
**Status:** Accepted
**Author:** Floris
**Depends on:** 0001, 0014, 0029, 0030
**Monorepo pair:** [docs/adr/technical/0060-athena-js-event-ingress-spine.md](../../../../docs/adr/technical/0060-athena-js-event-ingress-spine.md)
**Spec:** [docs/sdd/xylex/athena-js-event-ingress/SPEC.md](../../../../docs/sdd/xylex/athena-js-event-ingress/SPEC.md)

Package index **0031** pairs with monorepo technical **0060**. Do not conflate it with earlier numeric ids.

## Decision

Internal `EventIngressRuntime.ingest(AthenaIngressIR)` is the only semantic ingest path. Transport IR stays Direct | HTTP. Billing commands stay on `BillingRuntime.execute`. Mollie webhook HTTP is a raw-body adapter, not an RPC operation.

## Contract (landed)

- `src/runtime/ingress/{ir,runtime,identity,persistence,status,compiler/http}.ts`
- `src/runtime/events/{ir,catalog,causality,outbox,hooks}.ts`
- `src/billing/canonical/{document,transition}.ts`
- `src/billing/runtime/local/ingress/{apply,repository,revision}.ts`
- Mollie `webhook-port` under `src/billing/runtime/local/providers/mollie/`
- Ledgers: `athena_event_ingress_migrations`, `athena_billing_migrations`
- Next: `createAthenaBillingIngressHandlers`; unified handler routes `/api/athena/billing/webhook` **before** the command surface
- No package `exports` for `./ingress` or `./events`

## Non-goals

Public Event/Ingress APIs, Stripe webhook port, fifth transport domain, Data Nucleus apply, `billing.event.ingest` on the command dispatcher.
