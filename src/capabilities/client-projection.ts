import type { AthenaClientCapabilities } from "../cloudflare/types.ts";
import type { AthenaCapabilitiesIr } from "./types.ts";

function capabilityState(
  ir: AthenaCapabilitiesIr,
  key: string,
  fallback: boolean
): boolean {
  const entry = ir.capabilities.find((candidate) => candidate.key === key);
  if (!entry || entry.status === "unknown" || entry.status === "degraded") {
    return fallback;
  }
  return entry.status === "available";
}

export function projectAthenaClientCapabilities(
  ir: AthenaCapabilitiesIr,
  base: AthenaClientCapabilities
): AthenaClientCapabilities {
  return {
    ...base,
    db: {
      ...base.db,
      layers: {
        ...base.db.layers,
        flatCrud:
          capabilityState(ir, "data.operation.fetch", base.db.layers.flatCrud) &&
          capabilityState(ir, "data.operation.insert", base.db.layers.flatCrud) &&
          capabilityState(ir, "data.operation.update", base.db.layers.flatCrud) &&
          capabilityState(ir, "data.operation.delete", base.db.layers.flatCrud),
        relations: capabilityState(
          ir,
          "data.query.nested-relations",
          base.db.layers.relations
        ),
        rpc: capabilityState(ir, "data.operation.rpc", base.db.layers.rpc),
      },
    },
    storage: {
      ...base.storage,
      backups: capabilityState(
        ir,
        "storage.backup.create",
        base.storage.backups
      ),
      catalogs: capabilityState(
        ir,
        "storage.catalog.read",
        base.storage.catalogs
      ),
      objects:
        capabilityState(ir, "storage.object.get", base.storage.objects) &&
        capabilityState(ir, "storage.object.put", base.storage.objects) &&
        capabilityState(ir, "storage.object.list", base.storage.objects) &&
        capabilityState(ir, "storage.object.delete", base.storage.objects),
    },
  };
}
