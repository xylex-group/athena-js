export type AthenaQueryBackend = "gateway" | "postgresql" | "d1" | "sqlite";

export interface AthenaQueryCapabilityMatrix {
  backend: AthenaQueryBackend;
  ilike: boolean;
  jsonbContainment: boolean;
  manyToManyRelations: boolean;
  nestedOrdering: boolean;
  nestedPagination: boolean;
  nestedRelations: boolean;
  nullsOrdering: boolean;
  relationFirstSelection: boolean;
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
  relationFirstSelection: false,
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
  relationFirstSelection: true,
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
  relationFirstSelection: true,
  relationalPredicates: true,
};

export const SQLITE_LOCAL_QUERY_CAPABILITIES: AthenaQueryCapabilityMatrix = {
  backend: "sqlite",
  ilike: false,
  jsonbContainment: false,
  manyToManyRelations: false,
  nestedOrdering: false,
  nestedPagination: false,
  nestedRelations: false,
  nullsOrdering: false,
  relationFirstSelection: false,
  relationalPredicates: false,
};
