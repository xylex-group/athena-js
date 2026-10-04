import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalizeAthenaAuthorizationSnapshotIr } from "./canonicalize.ts";

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function fingerprintAthenaAuthorizationSnapshotIr(
  value: unknown
): string {
  const canonical = canonicalizeAthenaAuthorizationSnapshotIr(value);
  const semantic = {
    assignments: canonical.assignments,
    irVersion: canonical.irVersion,
    kind: canonical.kind,
    rights: { ...canonical.rights, metadata: {} },
    roles: { ...canonical.roles, metadata: {} },
    scope: canonical.scope,
  };
  return bytesToHex(
    sha256(utf8ToBytes(JSON.stringify(sortObjectKeys(semantic))))
  );
}
