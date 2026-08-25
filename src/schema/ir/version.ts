/** Canonical Schema IR document kind. */
export const ATHENA_SCHEMA_IR_KIND = "athena.schema" as const;

/** Schema IR document version. Bump only on breaking IR shape changes. */
export const ATHENA_SCHEMA_IR_VERSION = 2 as const;

export type AthenaSchemaIrKind = typeof ATHENA_SCHEMA_IR_KIND;
export type AthenaSchemaIrVersion = typeof ATHENA_SCHEMA_IR_VERSION;
