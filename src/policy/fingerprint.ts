import { sha256HexUtf8 } from "../node-crypto.ts";
import type { PolicyDefinition, PolicyIrDocument, PolicyPrincipal } from "./types.ts";

function principalSortKey(p: PolicyPrincipal): [number, string] {
  switch (p.kind) {
    case "public":
      return [0, ""];
    case "anonymous":
      return [1, ""];
    case "authenticated":
      return [2, ""];
    case "role":
      return [3, p.name];
    case "permission":
      return [4, p.name];
    case "service":
      return [5, p.name];
    case "admin":
      return [6, ""];
    default:
      return [99, ""];
  }
}

function principalJson(p: PolicyPrincipal): unknown {
  switch (p.kind) {
    case "role":
    case "permission":
    case "service":
      return { kind: p.kind, name: p.name };
    default:
      return { kind: p.kind };
  }
}

const ACTION_NAMES = ["select", "insert", "update", "delete"] as const;
const ACTION_BITS = [1, 2, 4, 8] as const;

function actionsList(mask: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < ACTION_BITS.length; i++) {
    if (mask & ACTION_BITS[i]) {
      out.push(ACTION_NAMES[i]);
    }
  }
  return out;
}

function canonicalizePolicy(policy: PolicyDefinition): unknown {
  const principals = [...policy.principals].sort((a, b) => {
    const [ak, an] = principalSortKey(a);
    const [bk, bn] = principalSortKey(b);
    return ak - bk || an.localeCompare(bn);
  });

  return {
    id: policy.id,
    name: policy.name ?? null,
    resource: {
      database: policy.resource.database ?? null,
      schema: policy.resource.schema ?? null,
      table: policy.resource.table,
    },
    actions: actionsList(policy.actions),
    composition: policy.composition,
    principals: principals.map(principalJson),
    visibility: policy.visibility ?? null,
    check: policy.check ?? null,
    extensions: {},
  };
}

/** Semantic canonical form matching athena-policy-core::canonicalize_document. */
export function canonicalizeDocument(doc: PolicyIrDocument): unknown {
  const policies = [...doc.policies]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(canonicalizePolicy);
  return {
    irVersion: doc.irVersion,
    policies,
  };
}

/** Recursively sort object keys for cross-language stable hashing. */
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
 * SHA-256 hex fingerprint of the semantic canonical form.
 * Matches Rust `fingerprint_document` (sorted-key compact JSON + SHA-256).
 */
export function fingerprintDocument(doc: PolicyIrDocument): string {
  const canonical = sortValue(canonicalizeDocument(doc));
  // Avoid Buffer / node:crypto static imports so DTS emit does not need @types/node.
  return sha256HexUtf8(JSON.stringify(canonical));
}
