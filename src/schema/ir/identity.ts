/**
 * Branded stable id for a schema object. Same {@link SchemaObjectId} plus a
 * changed physical name is a rename, not drop+create.
 */
declare const schemaObjectIdBrand: unique symbol;

export type SchemaObjectId = string & {
  readonly [schemaObjectIdBrand]: "SchemaObjectId";
};

export interface SchemaNameTriple {
  readonly database: string;
  readonly name: string;
  readonly namespace: string;
}

/** Logical (Athena) vs physical (backend) identity. */
export interface SchemaObjectIdentity {
  readonly logical: SchemaNameTriple;
  readonly physical: SchemaNameTriple;
}

export function asSchemaObjectId(id: string): SchemaObjectId {
  return id as SchemaObjectId;
}

export function schemaNameTriple(
  database: string,
  namespace: string,
  name: string
): SchemaNameTriple {
  return { database, name, namespace };
}

export function schemaObjectIdentity(
  database: string,
  namespace: string,
  name: string,
  physical: Partial<SchemaNameTriple> = {}
): SchemaObjectIdentity {
  return {
    logical: schemaNameTriple(database, namespace, name),
    physical: schemaNameTriple(
      physical.database ?? database,
      physical.namespace ?? namespace,
      physical.name ?? name
    ),
  };
}

export function physicalIdentityKey(identity: SchemaObjectIdentity): string {
  const p = identity.physical;
  return `${p.database}\u0000${p.namespace}\u0000${p.name}`;
}
