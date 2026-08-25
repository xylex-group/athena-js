# Schema IR v2

Canonical **database structure** for `@xylex-group/athena` is a versioned
document: **Athena Schema IR v2**. Everything that describes tables, columns,
types, enums, constraints, indexes, and semantic relations normalizes into it.

`table()` / `ModelDef` stay the TypeScript authoring surface. They are not a
second schema format.

```ts
import {
  ATHENA_SCHEMA_IR_KIND,
  ATHENA_SCHEMA_IR_VERSION,
  canonicalizeAthenaSchemaIr,
  fingerprintAthenaSchemaIr,
  schemaIrFromIntrospection,
  schemaIrFromModels,
  schemaIrFromTable,
  validateAthenaSchemaIr,
  type AthenaSchemaIr,
} from "@xylex-group/athena/schema";
```

Also re-exported from `@xylex-group/athena` and (v1 names) `@xylex-group/athena/migrations`.

ADR: [0038 technical](../../docs/adr/technical/0038-athena-schema-ir-v2.md).
Spec: [docs/sdd/xylex/athena-schema-ir-v2](../../docs/sdd/xylex/athena-schema-ir-v2/SPEC.md).

## Document

```ts
{
  kind: "athena.schema", // ATHENA_SCHEMA_IR_KIND
  irVersion: 2,          // ATHENA_SCHEMA_IR_VERSION
  databases: SchemaDatabase[],
  metadata: SchemaMetadata
}
```

Database is first-class (`Registry → Database → Schema → Model`). Do not treat
a SQL schema list as the document root.

| Object | What it is |
| --- | --- |
| `SchemaObjectIdentity` | Logical vs physical `database` / `namespace` / `name` |
| `SchemaObjectId` | Branded id; same id + changed physical name is a **rename** |
| `SchemaType` | Discriminated `scalar` \| `enum` \| `native` |
| `NativeTypeDescriptor` | Backend name + length/precision/scale/arrayDimensions |
| `SchemaEnum` | First-class object; columns reference by id |
| `SchemaConstraint` | PK / UNIQUE / FK / **CHECK**, each with a stable id |
| `SchemaRelation` | Semantic `1:1` \| `1:n` \| `n:1` \| `n:n`, optional `through`, `backingConstraintIds` — **not** an FK row |

`SchemaMetadata` holds provenance and extensions. **Fingerprint excludes
metadata** (Policy IR analog; do not import `src/policy`).

## Pipeline

```text
table() / models          introspection provider
        │                          │
        ▼                          ▼
              AthenaSchemaIr
        canonicalize / validate / fingerprint
                    │
                    ▼
              schema/diff
```

- `table()` attaches `ir: AthenaSchemaIr`. `ModelMetadata` is derived from that IR.
- Introspection public emit is `schemaIrFromIntrospection`.
- `diffSchemas({ from, to })` compares IR. v1 `AthenaSchemaSnapshot` is lifted
  at the boundary (`schemaIrFromSnapshot`).

```ts
validateAthenaSchemaIr(doc);
const canonical = canonicalizeAthenaSchemaIr(doc);
const hash = fingerprintAthenaSchemaIr(canonical); // SHA-256 hex
```

`canonicalizeAthenaSchemaIr` is idempotent. Changing only `metadata` does not
change the fingerprint.

## v1 snapshot (compatibility, not SSOT)

`AthenaSchemaSnapshot` (`version: 1`, `schemas[]`, optional `backend`) remains
for existing imports. `validateSchemaSnapshot` still rejects `version !== 1`
and does **not** accept IR documents.

`schemaSnapshotFromIr` / `schemaSnapshotFromModels` /
`schemaSnapshotFromIntrospection` are **lossy** in the v1 direction (CHECK,
first-class enums, M2M `through` may drop). New structure code MUST take
`AthenaSchemaIr`.

See [schema-diff.md](./schema-diff.md) for comparison operations.

## Out of P0

Views, functions, triggers, RLS, SQL generation from IR, Policy/Query/Migration
IR merge, and a Rust Schema IR port are **not** this document.
