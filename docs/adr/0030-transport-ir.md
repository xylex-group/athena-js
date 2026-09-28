# ADR 0030: Internal Transport IR (Direct | HTTP)

**Date:** 2026-08-26
**Status:** Accepted
**Author:** Floris
**Depends on:** 0001, 0014, 0015, 0020, 0029
**Monorepo pair:** [docs/adr/technical/0059-athena-js-transport-ir.md](../../../../docs/adr/technical/0059-athena-js-transport-ir.md)
**Spec:** [docs/sdd/xylex/athena-js-transport-ir/SPEC.md](../../../../docs/sdd/xylex/athena-js-transport-ir/SPEC.md)

This file is **Accepted** for the Transport IR slice. It does not reopen package 0027 (embedded storage), 0029 (Runtime Plan), or Auth/Billing public constructors.

This slice is HTTP consolidation plus Direct IR vocabulary. Direct execution stays on Runtime Plan. `compileAthenaRpcHttpRequest` is the Storage/Billing envelope only.

Package index **0030** pairs with monorepo technical **0059**. Do not conflate it with technical **0030** (passkey challenge domain).

## Context

Package ADR 0001 / 0014 require a single `createClient`. Package 0029 / monorepo 0049 landed an internal Runtime Plan. Browser Storage and Billing still owned HTTP URL join, GET probes, and error mapping in domain files. Next topology only materialized Auth + Data at protocol 1.1.

## Decision

**Proposition:** Internal `AthenaTransportIR` (Direct | HTTP) is the construction spine for how an invocation crosses its execution boundary. Discovery 1.2 advertises `transports`. HTTP is a dialect. The IR is not a public config object.

## Contract (landed)

- `src/runtime/transport/{domain,ir,invocation,topology,error-envelope,compiler,parser,index}.ts` exist.
- HTTP dialect: `src/runtime/transport/http/{ir,url,request-compiler,response-parser,client,index}.ts`.
- Direct dialect: `src/runtime/transport/direct/ir.ts`.
- Next protocol `ATHENA_NEXT_RUNTIME_PROTOCOL` is **1.2** and serializes `transports` while keeping `endpoints`. Discovery/topology `credentials` wire is `none` | `same-origin` (Fetch `omit`/`include` are request-time; `bearer` is not executed).
- Public `ResolvedNextAthenaTopology` is the compatibility view (`auth?` / `data?` / `protocol`). Internal `ResolvedNextAthenaRuntimeTopology` extends `AthenaRuntimeTopologyIR`.
- Browser Storage/Billing call `executeAthenaHttpTransport`. Topology omit = no fetch. No topology = default path without GET.
- `createAthenaNextHandler` is a unified route handler; `createAthenaNextHandlers` remains.
- `AthenaBillingError.code` is required on the class; browser billing does not `throw new Error(`.
- No package `exports` entry for `./transport`. `src/runtime/index.ts` does not re-export the compiler or HTTP executor.

## Consequences

- Dual-suite `athena-js-transport-ir.target.test.ts` is the gate (**GREEN**). Characterization baseline is archived under `test/sdd/superseded/`.

## Non-goals (this slice)

Public Transport API, Binding/Worker IR, Chat/Notifications domains, putting rights/policy/secrets on transport, reopening Runtime Plan / Data Nucleus / Auth canonical architecture, executing Direct IR, implementing `bearer` credentials, or replacing Auth/Data HTTP with the RPC compiler.
