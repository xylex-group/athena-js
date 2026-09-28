import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalizeAthenaSchemaIr } from "./canonicalize.ts";
import type { AthenaSchemaIr } from "./document.ts";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * SHA-256 hex of the canonical structural document.
 * Metadata / provenance / extensions are excluded (Policy IR analog).
 */
export function fingerprintAthenaSchemaIr(doc: unknown): string {
  const canonical = canonicalizeAthenaSchemaIr(doc);
  const structure: AthenaSchemaIr = {
    databases: canonical.databases,
    irVersion: canonical.irVersion,
    kind: canonical.kind,
    metadata: {},
  };
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(sortValue(structure)))));
}
