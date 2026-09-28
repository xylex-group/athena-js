import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaEnum, SchemaNamespace } from "./namespace.ts";

export interface SchemaDatabase {
  readonly backend?: string | null;
  readonly enums?: readonly SchemaEnum[];
  readonly id: SchemaObjectId;
  readonly identity: SchemaObjectIdentity;
  readonly namespaces: readonly SchemaNamespace[];
}
