import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaEnum, SchemaNamespace } from "./namespace.ts";

export interface SchemaDatabase {
  readonly id: SchemaObjectId;
  readonly identity: SchemaObjectIdentity;
  readonly namespaces: readonly SchemaNamespace[];
  readonly enums?: readonly SchemaEnum[];
  readonly backend?: string | null;
}
