export type AthenaQueryBackend = "gateway" | "postgresql" | "d1";

export interface AthenaQueryCapabilityMatrix {
  backend: AthenaQueryBackend;
  ilike: boolean;
  jsonbContainment: boolean;
  manyToManyRelations: boolean;
  nestedOrdering: boolean;
  nestedPagination: boolean;
  nestedRelations: boolean;
  nullsOrdering: boolean;
  relationalPredicates: boolean;
}

export const GATEWAY_QUERY_CAPABILITIES: AthenaQueryCapabilityMatrix = {
  backend: "gateway",
  ilike: true,
  jsonbContainment: true,
  manyToManyRelations: false,
  nestedOrdering: true,
  nestedPagination: true,
  nestedRelations: true,
  nullsOrdering: true,
  relationalPredicates: false,
};

export const POSTGRES_QUERY_CAPABILITIES: AthenaQueryCapabilityMatrix = {
  backend: "postgresql",
  ilike: true,
  jsonbContainment: true,
  manyToManyRelations: true,
  nestedOrdering: true,
  nestedPagination: true,
  nestedRelations: true,
  nullsOrdering: true,
  relationalPredicates: true,
};

export const D1_QUERY_CAPABILITIES: AthenaQueryCapabilityMatrix = {
  backend: "d1",
  ilike: false,
  jsonbContainment: false,
  manyToManyRelations: true,
  nestedOrdering: true,
  nestedPagination: true,
  nestedRelations: true,
  nullsOrdering: false,
  relationalPredicates: true,
};
