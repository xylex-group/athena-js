# Schema Diff (Athena-managed surface)

Programmatic foundation for comparing **desired** and **actual** Athena-managed
schema. Canonical structure is **Schema IR v2** (`AthenaSchemaIr`); see
[schema-ir.md](./schema-ir.md). v1 `AthenaSchemaSnapshot` is a compatibility
projection that `diffSchemas` lifts at the boundary.

```text
AthenaModels ──► table().ir / schemaIrFromModels ──┐
                                                   ├──► canonicalize ──► diffSchemas ──► SchemaDiff
Postgres DB  ──► schemaIrFromIntrospection ────────┘
                   (v1 snapshot lifts via schemaIrFromSnapshot)
```

This layer describes **what changed**. It does **not**:

- generate SQL / DDL
- classify destructive risk
- plan or execute migrations
- apply drift policy across unmanaged database objects

Those concerns are separate downstream stages.

CLI `athena-js schema diff --policy-impact` is an **authored-policy impact report** (which policies, by model/table, reference dropped or renamed tables/columns). It uses the same `diffSchemas` operations and Policy CLI loader (`loadAthenaConfig` + lazy `tooling.policies`). It is **not** a schema lifecycle engine.

## Public API

```ts
import {
  diffSchemas,
  schemaIrFromIntrospection,
  schemaIrFromModels,
  type AthenaSchemaIr,
  type SchemaDiff,
} from "@xylex-group/athena/schema";

// v1 snapshot helpers remain on the root and /migrations entries:
// schemaSnapshotFromModels, schemaSnapshotFromIntrospection, AthenaSchemaSnapshot
```

### Direction

```ts
const diff = diffSchemas({
  from: actual,   // current / database side
  to: desired,    // target / models side
});
```

- `add_column` → present in `to`, absent in `from`
- `drop_column` → present in `from`, absent in `to`

### Empty check

```ts
diff.isEmpty === true  // equivalent normalized schemas
```

## What is compared

| Resource | Support |
| --- | --- |
| Schemas (namespaces) | FULL |
| Tables (schema-qualified) | FULL |
| Columns (type, nullability, default, generated) | FULL |
| Primary keys (ordered, composite) | FULL |
| Unique constraints (structural columns) | FULL |
| Foreign keys + ON DELETE / ON UPDATE | FULL |
| Indexes (structural columns / unique / predicate / method) | FULL |
| Views, functions, triggers, extensions, RLS | **UNSUPPORTED** (ignored) |
| Check constraints | Represented on IR (`SchemaConstraint` kind `check`); v1 snapshot projection still omits them |
| Enum lifecycle (CREATE TYPE …) | First-class `SchemaEnum` on IR; v1 snapshot still has column `enumValues` only |

Athena bookkeeping (`athena.*`, e.g. `athena.schema_migrations`) is excluded by
default when adapting introspection snapshots.

## Identity

IR identity is logical vs physical `{ database, namespace, name }` plus a
branded `SchemaObjectId`. Same id + changed physical name is a **rename**.

v1 snapshots still key tables as `{ schema, name }` (never bare name):

```ts
{ schema: "billing", name: "users" }
// ≠
{ schema: "public", name: "users" }
```

Constraint/index **physical names** are preserved on operations but comparison
is primarily **structural** (ordered columns, targets, actions) so generated
Postgres names do not create noise.

## Normalization

Representational aliases are folded before compare, including:

| Alias family | Canonical |
| --- | --- |
| `int2` / `smallint` | `smallint` |
| `int4` / `integer` | `integer` |
| `int8` / `bigint` | `bigint` |
| `float4` / `real` | `real` |
| `float8` / `double precision` | `double precision` |
| `bool` / `boolean` | `boolean` |
| `varchar` / `character varying` | `varchar` |
| `bpchar` / `character` | `char` |
| `decimal` / `numeric` | `numeric` |
| `timestamp` / `timestamp without time zone` | `timestamp` |
| `timestamptz` / `timestamp with time zone` | `timestamptz` |

Length/precision remain meaningful (`varchar(64)` ≠ `varchar(255)`).

`integer` ≠ `bigint`, `timestamp` ≠ `timestamptz`.

Defaults: conservative only (`'x'::text` → `'x'`, `now()` / `CURRENT_TIMESTAMP`,
`nextval('s'::regclass)` → `nextval('s')`). Uncertain expressions are left as-is.

## Column alters

Multiple property changes on one column produce a **single** `alter_column`
operation with explicit `before`, `after`, and `changes` deltas — safer for later
planning than three separate ops without linkage.

## Renames

`rename_table` / `rename_column` exist on the operation union. IR branded ids
are the rename signal (same id, changed physical name). Heuristic name matching
alone is not the SSOT.

## Adapters

### Models

`schemaIrFromModels(input)` (and `table().ir`) walks the same model graph as
`modelsToSql`. `schemaSnapshotFromModels` projects that IR to v1.

### Introspection

`schemaIrFromIntrospection(snapshot)` is the public structural emit.
`schemaSnapshotFromIntrospection` is the v1 projection. Direct Postgres
introspection also gathers defaults, unique constraints, indexes, and FK
actions via catalog SQL.

## Invariants (tested)

| ID | Rule |
| --- | --- |
| SDIFF-01 | `diff(A,A) = ∅` |
| SDIFF-02 | Input ordering does not affect output |
| SDIFF-03 | Schema-qualified identity |
| SDIFF-04 | Supported type aliases are silent |
| SDIFF-05 | Semantic type differences surface |
| SDIFF-06 | Composite key/index order preserved |
| SDIFF-07 | Cross-schema FK identity |
| SDIFF-08 | Unmanaged/internal objects not treated as app deletions |
| SDIFF-09 | Before/after metadata retained |
| SDIFF-10 | Inputs are not mutated |
| SDIFF-11 | No SQL generation |
| SDIFF-12 | No database connection required for `diffSchemas` |

## Next layers (out of scope here)

```text
SchemaDiff → Destructive Analysis → Migration Planning → SQL Render → Execute
```
