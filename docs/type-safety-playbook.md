# Type safety playbook

This playbook is the practical guide for tightening Athena JS model contracts over time without blocking delivery.

It focuses on the common failure mode: runtime calls are fast to ship, but row/insert/update contracts drift across forms, services, and generated artifacts.

## Goals

- preserve runtime velocity
- reduce cross-layer type drift
- keep contracts explicit at write boundaries
- make generator and hand-written models coexist predictably

## 1) Improvement backlog to prioritize

Start with these improvements in order:

1. introduce explicit `Insert` and `Update` generics for critical models
2. migrate unstable domains from `from("table")` to `fromModel(...)`
3. derive form payload types from `InsertOf` / `UpdateOf` instead of ad-hoc DTO interfaces
4. normalize all outbound payloads to JSON-safe values (`AthenaJsonValue` family)
5. enforce generator dry-run checks in CI (`athena-js generate --dry-run`)
6. lock output targets to schema-aware paths to avoid multi-schema collisions
7. centralize tenant header mapping with `tenantKeyMap` + `withTenantContext(...)`
8. add narrow test coverage for typed filter keys and mutation payload compatibility

If you only do one thing first, do item 1.

## 2) Contract layering model

Treat your contracts in this order:

1. database reality (tables, keys, nullability)
2. model contract (`defineModel<Row, Insert, Update>`)
3. service-boundary validators (for example Zod)
4. UI form state
5. runtime call payload

The model contract must be the source of truth for payload shapes sent through Athena builders.

## 3) Tri-generic model pattern

Defaulting to `Partial<Row>` is convenient but often too loose.

Prefer explicit writes for critical entities:

```ts
const invoices = defineModel<
  {
    id: string;
    organization_id: string;
    amount_cents: number;
    status: "draft" | "sent" | "paid";
    due_at: string | null;
  },
  {
    organization_id: string;
    amount_cents: number;
    status?: "draft" | "sent" | "paid";
    due_at?: string | null;
  },
  {
    amount_cents?: number;
    status?: "draft" | "sent" | "paid";
    due_at?: string | null;
  }
>({
  meta: {
    primaryKey: ["id"],
    nullable: {
      id: false,
      organization_id: false,
      amount_cents: false,
      status: false,
      due_at: true,
    },
  },
});
```

Benefits:

- creates are strict and intention-revealing
- updates remain intentionally partial
- upsert `updateBody` becomes strongly constrained

## 4) Typed query-builder behavior to leverage

With typed registry paths, `TableQueryBuilder<Row, Insert, Update>` gives:

- keyed filter columns when row keys are known
- read contract from `Row`
- write contracts from `Insert` and `Update`

```ts
await typed
  .fromModel("billing", "public", "invoices")
  .eq("organization_id", "org-1")
  .order("due_at", { ascending: true })
  .select("id, amount_cents, status");
```

This eliminates many accidental string-column typos in service code.

## 5) Zod alignment pattern

The safest approach is parser-first payload shaping:

1. parse input with Zod
2. map parsed value to `InsertOf<Model>` or `UpdateOf<Model>`
3. pass directly to Athena mutation methods

```ts
import { z } from "zod";
import type { InsertOf, UpdateOf } from "@xylex-group/athena";

type InvoiceModel = typeof registry.billing.schemas.public.models.invoices;
type InvoiceInsert = InsertOf<InvoiceModel>;
type InvoiceUpdate = UpdateOf<InvoiceModel>;

const invoiceCreateSchema = z.object({
  organization_id: z.string().min(1),
  amount_cents: z.number().int().nonnegative(),
  status: z.enum(["draft", "sent", "paid"]).default("draft"),
  due_at: z.string().datetime().nullable().optional(),
});

const invoicePatchSchema = invoiceCreateSchema
  .pick({ amount_cents: true, status: true, due_at: true })
  .partial();

function parseCreate(input: unknown): InvoiceInsert {
  return invoiceCreateSchema.parse(input);
}

function parsePatch(input: unknown): InvoiceUpdate {
  return invoicePatchSchema.parse(input);
}
```

Keep parse functions in service modules so controllers/routes stay thin.

## 6) React Hook Form alignment pattern

React Hook Form should own UX state, not domain contracts.

Recommended flow:

1. form owns local state (`FormValues`)
2. submit handler validates with Zod
3. parsed value is cast by inference to `InsertOf`/`UpdateOf`
4. mutation calls use typed client methods

```ts
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const form = useForm<z.input<typeof invoiceCreateSchema>>({
  resolver: zodResolver(invoiceCreateSchema),
  defaultValues: {
    status: "draft",
  },
});

async function onSubmit(raw: z.input<typeof invoiceCreateSchema>) {
  const payload: InvoiceInsert = invoiceCreateSchema.parse(raw);
  await typed.fromModel("billing", "public", "invoices").insert(payload);
}
```

This avoids the common anti-pattern of keeping a separate third DTO layer that diverges from model contracts.

## 7) DTO collapse strategy

When multiple payload interfaces exist (`CreateXRequest`, `XForm`, `XInsert`, `XMutationPayload`), collapse them:

1. keep one validator schema
2. keep one `InsertOf<Model>`/`UpdateOf<Model>` target
3. keep optional UI-only projection type

Use dedicated mapper functions only for explicit semantic transforms (for example currency conversions).

## 8) Multi-schema safety rules

In multi-schema systems (`public` + `athena`), enforce all of the following:

- generator model path includes schema token (`{schema_kebab}`)
- schema artifact path includes schema token
- `fromModel(...)` path always includes explicit database/schema/model keys
- physical table mapping uses `meta.tableName` only when needed

This prevents collisions and namespace ambiguity.

## 9) Gateway payload typing rules

Use JSON-safe types at boundaries:

- `AthenaJsonPrimitive`
- `AthenaJsonValue`
- `AthenaJsonObject`
- `AthenaJsonArray`

Practical implications:

- avoid passing functions, class instances, or non-JSON structures
- normalize dates/times to strings before mutation payloads
- keep nested payloads serializable and deterministic

## 10) Tenant context strategy

Do not manually assemble tenant headers at every call site.

Instead:

1. define `tenantKeyMap` once in client bootstrap
2. call `withTenantContext(...)` per request context
3. pass domain-specific context values only

This keeps tenancy behavior consistent and testable.

## 11) Migration roadmap for legacy code

### Phase 0: Baseline

- keep existing `from("table")` usage
- add tests around critical read/write paths

### Phase 1: Contract introduction

- add `defineModel` for high-value entities
- define explicit `Insert`/`Update`

### Phase 2: Typed runtime adoption

- migrate selected services to `fromModel(...)`
- keep legacy services untouched until churn warrants migration

### Phase 3: Form/service alignment

- replace ad-hoc payload interfaces with `InsertOf`/`UpdateOf`
- add parser functions for create/update payloads

### Phase 4: Generator integration

- configure `athena-js generate`
- enable CI dry-runs
- gradually replace hand-written models where stable

## 12) Anti-pattern catalog

- `Row` is strict but writes are left as `Partial<Row>` on critical entities
- UI form types are treated as DB write contracts directly without validation
- generated and manual model definitions compete for the same registry key
- direct table strings are mixed with logical model names unpredictably
- tenancy headers are hardcoded per call path
- schema/table renames are handled by wide string replace instead of metadata mapping

## 13) Validation checklist

Before merging type-contract changes:

1. run `pnpm typecheck`
2. run focused tests for query-builder typing and typed registry paths
3. run `athena-js generate --dry-run` when generator config is involved
4. inspect changed docs/examples for signature accuracy

## 14) Team conventions worth codifying

- model files define explicit write contracts for critical entities
- form submit handlers always parse before mutation
- service layer owns `InsertOf`/`UpdateOf` mapping
- typed `fromModel(...)` is default for new domain modules
- CI blocks generator drift before commit

## 15) Quick reference snippets

### Typed create helper

```ts
function createUser(payload: InsertOf<typeof registry.app.schemas.public.models.users>) {
  return typed.fromModel("app", "public", "users").insert(payload).single("id, email");
}
```

### Typed patch helper

```ts
function updateUser(id: string, patch: UpdateOf<typeof registry.app.schemas.public.models.users>) {
  return typed.fromModel("app", "public", "users").eq("id", id).update(patch).single("id, email");
}
```

### Typed list helper

```ts
function listUsers() {
  return typed
    .fromModel("app", "public", "users")
    .select("id, email, created_at")
    .order("created_at", { ascending: false });
}
```

## 16) Related docs

- [`getting-started.md`](getting-started.md)
- [`typed-schema-registry.md`](typed-schema-registry.md)
- [`api-reference.md`](api-reference.md)
- [`generator-config.md`](generator-config.md)
