import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaType } from "./type.ts";

export type SchemaColumnGenerationStrategy =
  | { readonly kind: "none" }
  | { readonly kind: "identity"; readonly mode: "always" | "by-default" }
  | { readonly kind: "generated-always" };

export interface SchemaColumn {
  readonly default?: string | null;
  readonly generationStrategy?: SchemaColumnGenerationStrategy;
  readonly generated?: boolean;
  readonly id: SchemaObjectId;
  readonly identity: SchemaObjectIdentity;
  readonly nullable: boolean;
  readonly type: SchemaType;
}
