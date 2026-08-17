import type { AthenaExecutable, AthenaQueryDescriptor } from "./descriptor.ts";
import { hashAthenaValue } from "./canonicalize.ts";

export interface AthenaQueryExplanation {
  cacheKey: string;
  dependencies: {
    fieldCount: number;
    modelCount: number;
    relationCount: number;
  };
  filters: string;
  operation: AthenaQueryDescriptor["operation"];
  projection: string;
  scope: string;
  target: string;
  transport: "gateway";
}

function formatScope(descriptor: AthenaQueryDescriptor): string {
  const scope = descriptor.scope ?? descriptor.context;
  if (!scope) {
    return "(none)";
  }
  const parts = [
    scope.organizationId ? `org=${scope.organizationId}` : undefined,
    scope.userId ? `user=${scope.userId}` : undefined,
    scope.accessScope ? `access=${scope.accessScope}` : undefined,
    scope.policyRevision ? `policy=${scope.policyRevision}` : undefined,
  ].filter(Boolean);
  return parts.join(" / ") || "(none)";
}

export function explainAthenaQuery(
  input: AthenaExecutable<unknown> | AthenaQueryDescriptor
): AthenaQueryExplanation {
  const descriptor =
    "getDescriptor" in input ? input.getDescriptor() : input;
  const target = [descriptor.target.schema, descriptor.target.table]
    .filter(Boolean)
    .join(".");
  const projection = descriptor.projection?.star
    ? "*"
    : (descriptor.projection?.columns ?? []).join(",") || "(none)";
  const filters = (descriptor.filters ?? [])
    .map(
      (filter) =>
        `${filter.column ?? "?"} ${filter.operator} ${JSON.stringify(filter.value)}`
    )
    .join(" AND ");

  return {
    cacheKey: hashAthenaValue(descriptor.queryKey),
    dependencies: {
      fieldCount: descriptor.dependency.fields.length,
      modelCount: descriptor.dependency.models.length,
      relationCount: descriptor.dependency.relations.length,
    },
    filters: filters || "(none)",
    operation: descriptor.operation,
    projection,
    scope: formatScope(descriptor),
    target,
    transport: "gateway",
  };
}
