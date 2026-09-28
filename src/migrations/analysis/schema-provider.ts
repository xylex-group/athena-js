import { objectKey, type SchemaObjectRef } from "./ast.ts";

export type SchemaProviderSource =
  | "application"
  | "embedded-auth"
  | "embedded-chat"
  | "embedded-event-ingress"
  | "embedded-billing";

export interface SchemaProvider {
  filename: string;
  object: SchemaObjectRef;
  source: SchemaProviderSource;
  state: "applied" | "pending";
  version: number;
}

export function findSchemaProvider(
  providers: readonly SchemaProvider[],
  object: SchemaObjectRef
): SchemaProvider | undefined {
  const key = objectKey(object);
  return providers.find((provider) => objectKey(provider.object) === key);
}
