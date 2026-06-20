# Athena JS Type Surface Manifest

This page is the single long-form reference for the newer Athena JS type surface.

Use it when you want one copy-pasteable page that explains:

- the Zero-style table DSL
- the derived TypeScript helper types
- the generated Zod schemas
- generator output and internal schema metadata
- strict column typechecking behavior
- debug AST and trace typing
- the newer error and operation helper types
- which docs page to open next when you need more detail

This page is intentionally redundant with `typed-schema-registry.md`,
`type-safety-playbook.md`, `generator-quickstart.md`, `generator-config.md`,
`runtime-method-ast-models.md`, `findmany-ast-and-server-contract.md`, and
`api-reference.md`. The goal here is consolidation.

## 1) Canonical stance

The canonical typed authoring surface is now the Zero-style table DSL:

```ts
import {
  boolean,
  enumeration,
  json,
  string,
  table,
} from "@xylex-group/athena";

const users = table("users")
  .schema("public")
  .columns({
    id: string().generated(),
    email: string(),
    active: boolean().defaulted(),
    mood: enumeration(["happy", "sad"] as const).optional(),
    settings: json<{ theme: "light" | "dark" }>(),
  })
  .primaryKey("id");
```

`defineModel(...)` is deprecated and retained for compatibility and lower-level
manual contracts. This is additive, not a replacement-only migration.

## 2) Root export manifest

### Runtime value exports most relevant to the new type surface

| Export | Purpose |
| --- | --- |
| `table` | Zero-style table/model authoring |
| `string` | string column helper |
| `number` | number column helper |
| `boolean` | boolean column helper |
| `json` | JSON column helper with optional runtime Zod schema |
| `enumeration` | enum column helper from runtime tuple values |
| `defineModel` | deprecated legacy/manual model contract builder |
| `defineSchema` | groups models/tables into a schema |
| `defineDatabase` | groups schemas into a database |
| `defineRegistry` | groups databases into a registry |
| `createTypedClient` | registry-aware typed client |
| `createModelFormAdapter` | runtime model-aware form defaults/payload adapter |
| `toModelFormDefaults` | normalize model values into form defaults |
| `toModelPayload` | normalize form values back into insert/update payloads |
| `getAthenaDebugAst` | read attached debug ASTs when `experimental.debugAst` is enabled |
| `AthenaOperation` | enum-like value object for known operation names |
| `AthenaErrorCode` | enum-like value object for normalized Athena error codes |
| `AthenaGatewayErrorCode` | enum-like value object for gateway transport error codes |
| `AthenaErrorKind` | enum-like value object for normalized error kinds |
| `AthenaErrorCategory` | enum-like value object for normalized error categories |

### Type exports most relevant to the new type surface

| Export | Purpose |
| --- | --- |
| `AthenaTableDef` | the concrete built table/model contract |
| `AthenaColumnBuilder` | typed column-builder interface |
| `AnyColumnBuilder` | generic column-builder umbrella type |
| `ColumnRuntimeConfig` | internalized column metadata shape |
| `AthenaTableSchemaBundle` | `row` / `insert` / `update` / `form` Zod bundle |
| `RowOf<Model>` | derive read row type from a model/table |
| `InsertOf<Model>` | derive insert payload type from a model/table |
| `UpdateOf<Model>` | derive update payload type from a model/table |
| `FormValuesOf<Model>` | derive UI form value type from a model/table |
| `RowFromColumns<TColumns>` | derive row type straight from a column record |
| `InsertFromColumns<TColumns>` | derive insert type straight from a column record |
| `UpdateFromColumns<TColumns>` | derive update type straight from a column record |
| `FormValuesFromColumns<TColumns>` | derive form type straight from a column record |
| `ModelFormValues<Model>` | low-level generic form-value mapper |
| `ModelFormDefaults<Model>` | partial default-value shape for forms |
| `ModelFormAdapter<Model>` | runtime adapter contract |
| `ModelFormNullishMode` | `'empty-string' | 'undefined' | 'null'` |
| `AthenaResultErrorCode` | semi-open result error code type |
| `AthenaDataOperation` | known runtime data operations: select/insert/upsert/update/delete/rpc/query |
| `AthenaStorageOperation` | known storage operation names |
| `AthenaKnownOperation` | all built-in known operation names |
| `AthenaStorageFallbackOperation` | fallback storage shape like ``storage:get`` |
| `AthenaOperationName` | semi-open operation name type used on normalized errors |

## 3) Table DSL reference

### `table(name)`

Starts a new table builder.

- `name` is the logical TypeScript table/model name
- empty names throw immediately
- by default, the logical name is also the physical DB table name

```ts
const users = table("users");
```

### `.schema(schemaName)`

Sets the schema explicitly.

- canonical form for schema-aware authoring
- must be a bare schema name
- dotted input is rejected here
- prefer this over encoding schema inside `.from(...)`

```ts
const users = table("users").schema("public");
```

### `.from(tableName)`

Maps the TypeScript table name to a different DB target.

- accepts a plain table name such as `"user_pref"`
- also accepts `"schema.table"` for compatibility
- if you already used `.schema("public")`, then `.from("public.users")`
  must agree with that schema or the builder throws

```ts
const user_preferences = table("user_preferences")
  .schema("public")
  .from("user_pref");
```

### `.columns({...})`

Attaches a typed column record.

- keys remain the logical TypeScript field names
- exact DB snake_case is supported directly
- each value must be one of the Athena column helpers
- invalid/non-column values throw immediately

### `.primaryKey(...)`

Finalizes the table contract.

- requires at least one column key
- returns the built `AthenaTableDef`
- derives the internal `defineModel(...)` metadata contract
- derives the attached Zod schema bundle

## 4) Column helper reference

### Scalar helpers

| Helper | Type produced | Notes |
| --- | --- | --- |
| `string()` | `string` | fallback for textual DB families |
| `number()` | `number` | JS-safe numeric surface |
| `boolean()` | `boolean` | boolean column |
| `json<T>()` | `T` | runtime validator defaults to `z.unknown()` when no schema is provided |
| `enumeration(["a", "b"] as const)` | `"a" \| "b"` | runtime tuple drives both TS and Zod |

### Column builder modifiers

| Modifier | Effect on row type | Effect on insert type | Effect on update type | Effect on form schema |
| --- | --- | --- | --- | --- |
| `.optional()` | field becomes `T \| null` | field becomes optional | field remains optional | nullable scalar fields accept `""` and normalize to `null` |
| `.from("db_column")` | no change | no change | no change | no change |
| `.defaulted()` | no change | field becomes optional | field remains optional | field becomes optional |
| `.generated()` | no change | omitted from writable schemas | omitted from writable schemas | omitted from writable schemas |

### JSON rule

`json<TValue>(schema?)` has two layers:

- TypeScript generic controls the compile-time value type
- optional runtime Zod schema controls runtime parsing/validation

If you omit the runtime Zod schema, the runtime validator falls back to `z.unknown()`.

```ts
const settings = json<{ theme: "light" | "dark" }>();
const strict_settings = json(
  z.object({
    theme: z.enum(["light", "dark"]),
  }),
);
```

### Enum rule

`enumeration(...)` must receive runtime values.

```ts
const mood = enumeration(["happy", "sad"] as const);
```

That runtime tuple feeds:

- the TypeScript union
- the generated `z.enum(...)`
- generator re-emission

## 5) Built table contract

Once finalized with `.primaryKey(...)`, a table exposes:

| Property | Meaning |
| --- | --- |
| `kind` | always `'table'` |
| `name` | logical TypeScript table/model name |
| `mappedName` | explicit physical mapping from `.from(...)`, if present |
| `schemaName` | resolved schema name |
| `tableName` | resolved physical table name |
| `qualifiedName` | resolved `schema.table` or plain table name |
| `columns` | readonly column-builder map |
| `schemas` | derived Zod bundle |
| `meta` | inherited model metadata contract used by typed client and generator seams |

Important resolution rules:

1. `table("users").schema("public")` resolves `qualifiedName` to `public.users`
2. `table("user_preferences").schema("public").from("user_pref")` resolves `qualifiedName` to `public.user_pref`
3. `table("event").from("analytics.event")` resolves `schemaName` to `analytics` and `tableName` to `event`
4. conflicting `.schema(...)` plus schema-qualified `.from(...)` throws early

## 6) Derived TypeScript helper rules

### `RowOf<typeof table>`

- all columns are present
- nullable columns become `T | null`
- generated columns remain present because they still exist on read rows

### `InsertOf<typeof table>`

- generated columns are omitted
- non-nullable, non-defaulted columns are required
- nullable columns are optional and accept `null`
- defaulted columns are optional

### `UpdateOf<typeof table>`

- generated columns are omitted
- all writable fields are optional
- nullable fields still accept `null`

### `FormValuesOf<typeof table>`

- derived from the insert contract
- nullable fields default to the selected form nullish representation
- default mode is `'empty-string'`

Example:

```ts
import type { FormValuesOf, InsertOf, RowOf, UpdateOf } from "@xylex-group/athena";

type UserRow = RowOf<typeof users>;
type UserInsert = InsertOf<typeof users>;
type UserUpdate = UpdateOf<typeof users>;
type UserFormValues = FormValuesOf<typeof users>;
```

## 7) Derived Zod schema rules

Every built table exposes:

```ts
users.schemas.row
users.schemas.insert
users.schemas.update
users.schemas.form
```

### `schemas.row`

- includes every column
- nullable columns use `.nullable()`

### `schemas.insert`

- omits generated columns
- required only for non-nullable, non-defaulted writable columns

### `schemas.update`

- omits generated columns
- every writable field is optional

### `schemas.form`

- built from writable insert fields
- nullable scalar fields accept `""`
- `""` is normalized back to `null`
- final output shape is the insert payload shape

Example:

```ts
const parsedInsert = users.schemas.insert.parse({
  email: "demo@example.com",
});

const parsedForm = users.schemas.form.parse({
  email: "demo@example.com",
  mood: "",
});

// parsedForm.mood === null
```

## 8) Form helper manifest

The form helpers work on both manual models and table-built models.

| Helper | Purpose |
| --- | --- |
| `createModelFormAdapter(model)` | binds a model/table to runtime defaults and payload helpers |
| `toModelFormDefaults(model, values?, options?)` | converts model row values into UI-safe defaults |
| `toModelPayload(model, formValues, options?)` | converts form values back into insert/update payloads |

`ModelFormNullishMode` options:

- `'empty-string'`: `null -> ""`
- `'undefined'`: `null -> undefined`
- `'null'`: keep `null`

Canonical pattern:

```ts
const formAdapter = createModelFormAdapter(users);

const defaultValues = formAdapter.toDefaults(existingRow);
const insertPayload = formAdapter.toInsert(formValues);
const updatePayload = formAdapter.toUpdate(formValues);
```

## 9) Typed client and strict column typing

The typed path is additive.

You can still use:

- `createClient(...).from<Row>("users")`
- `createClient(...).from<Row>("users", { schema: "public" })`
- `createClient(...).from(users)`
- `createTypedClient(registry, ...).fromModel("app", "public", "users")`

### `experimental.typecheckColumns`

This flag is type-only. It does not change runtime payloads.

When row keys are known, Athena validates simple column strings and array inputs
for:

- `select(...)`
- `single(...)`
- `maybeSingle(...)`
- `order(...)`
- RPC `.select(...)`
- RPC filter and order column names

Canonical strict usage:

```ts
const athena = createClient(url, apiKey, {
  experimental: {
    typecheckColumns: true,
  },
});

await athena.from(users).select("id, email");
await athena.from<UserRow>("users").order("email");
await athena.db.from<UserRow>("users").select("id, email");
```

Important shortcut rule:

- `db.select<Row>(table)` supports row-aware result typing
- inline typed columns should use `db.from<Row>(table).select(...)`
- `db.select<Row>(table, columns)` is intentionally not the typed inline-column path

## 10) Debug AST and tracing type surface

### `experimental.debugAst`

Builds a normalized operation AST for executed runtime calls.

- successful results carry the AST
- use `getAthenaDebugAst(result)` to read it
- if query tracing is also enabled, the same AST is emitted on the trace event

### `experimental.traceQueries`

Emits `AthenaQueryTraceEvent` objects.

Relevant type details:

- `AthenaQueryTraceEvent.operation` is `AthenaDataOperation`
- `AthenaQueryTraceEvent.endpoint` is a typed gateway or RPC endpoint union
- `AthenaQueryTraceEvent.ast` is populated when `debugAst` is enabled
- `AthenaQueryTraceEvent.callsite` is best-effort user callsite metadata

### `experimental.findManyAst`

Allows clean `findMany(...)` object-select reads to send the original AST body
directly when the SDK can do so losslessly.

### `experimental.retryReads`

Retries retryable read failures with the SDK's internal policy.

## 11) Error and operation typing manifest

### Closed normalized error enums

Use these when you want the SDK's stable normalized classification layer:

- `AthenaErrorCode`
- `AthenaErrorKind`
- `AthenaErrorCategory`

### Gateway transport enum

Use `AthenaGatewayErrorCode` for transport-level failures such as:

- `NETWORK_ERROR`
- `INVALID_URL`
- `HTTP_ERROR`
- `INVALID_JSON`
- `UNKNOWN_ERROR`

### Why `AthenaResultError.code` is not fully closed

`AthenaResultError.code` is typed as:

```ts
type AthenaResultErrorCode =
  | AthenaErrorCode
  | AthenaGatewayErrorCode
  | (string & {});
```

This is intentional.

Reasons:

- gateways may surface raw upstream codes
- DB payloads may surface custom codes
- compatibility envelopes may not map cleanly into the normalized closed set

Use:

- `error.athenaCode` for the closed normalized Athena code
- `error.code` when you want the raw or semi-open code channel

### Operation helper types

`AthenaOperation` is the enum-like value object for known operation names.

Examples:

```ts
AthenaOperation.Select
AthenaOperation.Insert
AthenaOperation.GetStorageFile
```

Operation type layers:

- `AthenaDataOperation`: runtime data operations only
- `AthenaStorageOperation`: built-in storage operation names
- `AthenaKnownOperation`: all built-in known operations plus fallback storage verbs
- `AthenaOperationName`: semi-open operation name used on normalized errors

`AthenaOperationName` stays semi-open because downstream or compatibility layers
may still attach custom operation labels.

## 12) Generator and emitted artifact manifest

### Output formats

The generator supports:

- `define-model` (default)
- `table-builder`

### Canonical table-builder artifact shape

Generated table-builder files emit:

```ts
import { table, string } from "@xylex-group/athena";
import type { FormValuesOf, InsertOf, RowOf, UpdateOf } from "@xylex-group/athena";

export const users = table("users")
  .schema("public")
  .columns({
    id: string(),
    email: string(),
  })
  .primaryKey("id");

export type PublicUsersRow = RowOf<typeof users>;
export type PublicUsersInsert = InsertOf<typeof users>;
export type PublicUsersUpdate = UpdateOf<typeof users>;
export type PublicUsersFormValues = FormValuesOf<typeof users>;

export const users_row_schema = users.schemas.row;
export const users_insert_schema = users.schemas.insert;
export const users_update_schema = users.schemas.update;
export const users_form_schema = users.schemas.form;
```

### Internal schema metadata

Generated registry artifacts export:

```ts
export const __athena_schema_meta = {
  schemaVersion: 1,
  generatedAt: "...",
  database: "app",
  outputPreset: "athena-direct",
  outputFormat: "table-builder",
} as const;
```

This metadata is intended for:

- tooling
- debugging
- artifact version detection

It is not needed for ordinary runtime queries.

### Internal config version

The normalized generator config currently carries:

```ts
internal.schemaVersion = 1
```

That version lets downstream tooling detect the newer generated contract family.

### Zero-config defaults

`athena-js generate` now works in the common case with far less config when env
vars already exist.

Common defaults:

- default schema selection: `public`
- default output preset: `athena-direct`
- default output format: `table-builder`
- legacy compatibility opt-ins: `output.preset = "legacy"` and/or `output.format = "define-model"`

Useful env knobs:

- `ATHENA_GENERATOR_SCHEMAS`
- `ATHENA_GENERATOR_OUTPUT_FORMAT`
- `ATHENA_GENERATOR_MODEL_TARGET`
- `ATHENA_GENERATOR_SCHEMA_TARGET`
- `ATHENA_GENERATOR_DATABASE_TARGET`
- `ATHENA_GENERATOR_REGISTRY_TARGET`

## 13) Browser-safe surface note

`@xylex-group/athena/browser` preserves the new type contracts and table DSL
exports, but Node-only generator and introspection helpers still throw there.

That means browser-safe consumers can still import:

- `table`
- column helpers
- `createTypedClient`
- form helpers
- type exports

But should not use browser entrypoints for:

- Postgres introspection
- config-file loading
- generator execution

## 14) Recommended defaults

Use these defaults unless you have a specific reason not to:

1. prefer `table(...).schema("...").columns(...).primaryKey(...)` for new model contracts
2. use `.from("physical_name")` only when the DB name differs from the TypeScript name
3. keep exact DB snake_case when that is the real domain language
4. derive `RowOf`, `InsertOf`, `UpdateOf`, and `FormValuesOf` instead of hand-writing duplicate interfaces
5. use `table.schemas.*` as the first runtime validation surface
6. use `createTypedClient(...)` plus `fromModel(...)` when you want registry-driven runtime target resolution
7. use `createClient(...).from(tableValue)` when the table value is already in scope
8. use `db.from<Row>(...).select(...)` for inline strict column validation
9. use `error.athenaCode` for normalized branching and `error.code` for raw compatibility branching
10. treat `__athena_schema_meta` as tooling metadata, not application state

## 15) Anti-patterns to avoid

- writing duplicate `interface Row`, `interface Insert`, `interface Update` beside a table that already derives them
- using `.schema("public.users")` instead of `.schema("public").from("users")`
- assuming `.generated()` removes a field from read rows; it only removes it from writable schemas
- assuming `json<T>()` validates `T` at runtime without a Zod schema
- assuming `error.code` is a closed enum
- assuming `AthenaOperationName` is closed to only the built-in operations
- using typed `db.select<Row>(table, columns)` as the inline strict column path

## 16) Documentation map

Use this page as the hub, then jump out to the narrower docs when needed.

| Page | Open it for |
| --- | --- |
| `getting-started.md` | runtime setup, day-one examples, tracing/debug AST quickstarts |
| `typed-schema-registry.md` | registry composition, `fromModel(...)`, table DSL authoring basics |
| `type-safety-playbook.md` | migration strategy, anti-patterns, contract hardening |
| `generator-quickstart.md` | zero-config generation and minimal examples |
| `generator-config.md` | full generator knobs, targets, naming, env behavior |
| `api-reference.md` | exact signatures and public exported contracts |
| `runtime-method-ast-models.md` | normalized AST/state models for select/mutation/rpc/query |
| `findmany-ast-and-server-contract.md` | `findMany(...)` AST transport semantics and server contract details |
| `complete-method-reference.md` | exhaustive generated API catalog |

## 17) Short copy block for external docs pages

If you need a condensed intro paragraph for another docs site:

> Athena JS now exposes a Zero-style table DSL built around `table(...).schema(...).columns(...).primaryKey(...)`, with first-class derived TypeScript helpers (`RowOf`, `InsertOf`, `UpdateOf`, `FormValuesOf`), generated Zod schemas (`row`, `insert`, `update`, `form`), registry-aware typed clients, opt-in compile-time column checking, normalized debug AST tracing, and a richer error/operation type surface. The older `defineModel(...)` path is deprecated and retained for compatibility, but new model contracts should prefer the table DSL and derive from the exported model/table value instead of duplicating interfaces by hand.
