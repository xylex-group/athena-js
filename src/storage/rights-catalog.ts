import { parseAthenaRightKey } from "../rights/key.ts";
import type { AthenaRightDefinition } from "../rights/types.ts";

export const STORAGE_RIGHT_DEFINITIONS: readonly AthenaRightDefinition[] =
  Object.freeze(
    (
      [
        "storage.delete",
        "storage.get",
        "storage.head",
        "storage.list",
        "storage.put",
      ] as const
    ).map((key) => ({
      assignable: true,
      description: `Storage ${key}`,
      displayName: key === "storage.get" ? "Read files" : key,
      domain: "storage",
      key: parseAthenaRightKey(key),
      riskLevel: "low" as const,
      scopeKind: "self" as const,
    }))
  );
