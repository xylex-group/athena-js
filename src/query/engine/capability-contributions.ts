import type { AthenaCapabilityContribution } from "../../capabilities/resolver.ts";
import {
  capabilityContribution,
  unsupportedCapabilityContribution,
} from "../../capabilities/contribution.ts";
import type { AthenaQueryCapabilityMatrix } from "./capabilities.ts";

export function queryCapabilitiesToContributions(
  matrix: AthenaQueryCapabilityMatrix
): AthenaCapabilityContribution[] {
  const source = { kind: "catalog" as const, source: `query:${matrix.backend}` };
  const facts: readonly (readonly [string, boolean])[] = [
    ["data.query.ilike", matrix.ilike],
    ["data.query.jsonb-containment", matrix.jsonbContainment],
    ["data.query.many-to-many-relations", matrix.manyToManyRelations],
    ["data.query.nested-ordering", matrix.nestedOrdering],
    ["data.query.nested-pagination", matrix.nestedPagination],
    ["data.query.nested-relations", matrix.nestedRelations],
    ["data.query.nulls-ordering", matrix.nullsOrdering],
    ["data.query.relation-first-selection", matrix.relationFirstSelection],
    ["data.query.relational-predicates", matrix.relationalPredicates],
  ];
  return facts.map(([key, enabled]) =>
    enabled
      ? capabilityContribution({ key, domain: "data", kind: "feature" }, source)
      : unsupportedCapabilityContribution(
          { key, domain: "data", kind: "feature" },
          source
        )
  );
}
