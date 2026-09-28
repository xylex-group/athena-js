import type { AthenaRuntimeDiscoveryCapabilities } from "../../gateway/discovery-types.ts";
import type { AthenaCapabilitiesIr } from "../../capabilities/types.ts";

function isAvailable(
  ir: AthenaCapabilitiesIr,
  key: string,
  current: boolean
): boolean {
  const entry = ir.capabilities.find((candidate) => candidate.key === key);
  if (!entry || entry.status === "unknown" || entry.status === "degraded") {
    return current;
  }
  return entry.status === "available";
}

export function projectCapabilitiesToDiscovery(
  ir: AthenaCapabilitiesIr,
  base: AthenaRuntimeDiscoveryCapabilities
): AthenaRuntimeDiscoveryCapabilities {
  return {
    ...base,
    delete: isAvailable(ir, "data.operation.delete", base.delete),
    fetch: isAvailable(ir, "data.operation.fetch", base.fetch),
    insert: isAvailable(ir, "data.operation.insert", base.insert),
    nestedRelations: isAvailable(
      ir,
      "data.query.nested-relations",
      base.nestedRelations
    ),
    rpc: isAvailable(ir, "data.operation.rpc", base.rpc),
    update: isAvailable(ir, "data.operation.update", base.update),
  };
}
