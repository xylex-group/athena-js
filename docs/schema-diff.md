# Schema Diff (Athena-managed surface)

Programmatic foundation for comparing **desired** and **actual** Athena-managed
schema snapshots.

```text
AthenaModels ──► AthenaSchemaSnapshot ──┐
                                        ├──► normalize ──► diffSchemas ──► SchemaDiff
Postgres DB  ──► IntrospectionSnapshot ─┘
```

This layer describes **what changed**. It does **not**:

- generate SQL / DDL
- classify destructive risk
- plan or execute migrations
- apply drift policy across unmanaged database objects

Those concerns are separate downstream stages.

## Public API

```ts
import {
  diffSchemas,
  normalizeSchemaSnapshot,
  schemaSnapshotFromModels,
  schemaSnapshotFromIntrospection,
  type AthenaSchemaSnapshot,
  type SchemaDiff,
} from "@xylex-group/athena";

// or from the tooling entry:
// import { diffSchemas, ... } from "@xylex-group/athena/migrations";
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
| Check constraints | UNSUPPORTED (models do not own them yet) |
| Enum lifecycle (CREATE TYPE …) | PARTIAL (column enum labels only) |

Athena bookkeeping (`athena.*`, e.g. `athena.schema_migrations`) is excluded by
default when adapting introspection snapshots.

## Identity

Tables are never identified by bare name alone:

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

`rename_table` / `rename_column` exist on the operation union for future explicit
hints. Automatic rename inference is **not** enabled (false renames are worse
than conservative drop + create).

## Adapters

### Models

`schemaSnapshotFromModels(input)` walks the same model graph as `modelsToSql`
and maps column kinds to Postgres SQL types consistently with DDL emission.

### Introspection

`schemaSnapshotFromIntrospection(snapshot)` maps
`IntrospectionSnapshot` → IR. Direct Postgres introspection now also gathers
defaults, unique constraints, indexes, and FK actions via catalog SQL.

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
