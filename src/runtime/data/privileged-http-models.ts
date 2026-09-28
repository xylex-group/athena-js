import { parseAthenaResourceRef } from "../../schema/resource.ts";
import type {
  AthenaRuntimeModelDescriptor,
  AthenaRuntimeModelIndex,
} from "./model-registry.ts";

/** Schemas that must not be reachable through customer HTTP Data handlers. */
export const HTTP_PRIVILEGED_DATA_SCHEMAS = new Set([
  "athena",
  "athena_internal",
  "billing",
]);

const PRIVILEGED_TABLE_PREFIXES = ["billing_"] as const;

export function isPrivilegedHttpDataResource(resource: string): boolean {
  const trimmed = resource.trim();
  if (!trimmed) {
    return false;
  }
  const parsed = parseAthenaResourceRef(trimmed);
  if (parsed.schema && HTTP_PRIVILEGED_DATA_SCHEMAS.has(parsed.schema)) {
    return true;
  }
  const table = parsed.table;
  return PRIVILEGED_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix));
}

export function isPrivilegedHttpDataDescriptor(
  descriptor: AthenaRuntimeModelDescriptor
): boolean {
  if (
    descriptor.schema &&
    HTTP_PRIVILEGED_DATA_SCHEMAS.has(descriptor.schema)
  ) {
    return true;
  }
  return isPrivilegedHttpDataResource(descriptor.canonicalResource);
}

export function filterPrivilegedHttpModelIndex(
  index: AthenaRuntimeModelIndex
): AthenaRuntimeModelIndex {
  const descriptors = index.descriptors.filter(
    (descriptor) => !isPrivilegedHttpDataDescriptor(descriptor)
  );
  const allowed = new Set(
    descriptors.map((descriptor) => descriptor.canonicalResource)
  );
  return {
    descriptors,
    enforcement: index.enforcement,
    get(resource: string) {
      const found = index.get(resource);
      if (!(found && allowed.has(found.canonicalResource))) {
        return;
      }
      if (isPrivilegedHttpDataDescriptor(found)) {
        return;
      }
      return found;
    },
  };
}
