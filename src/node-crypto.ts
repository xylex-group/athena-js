/**
 * Node `createHash` without static `node:crypto` / `Buffer` references.
 * Keeps DTS/tsup builds green when `@types/node` is not on the type path
 * (Workers CI / athena-auth-ui local overlay builds).
 */

type HashLike = {
  update(data: string | Uint8Array, encoding?: string): HashLike;
  digest(encoding: "hex"): string;
};

type NodeCryptoLike = {
  createHash: (algorithm: string) => HashLike;
};

function loadNodeCrypto(): NodeCryptoLike {
  const processLike = (
    globalThis as {
      process?: {
        getBuiltinModule?: (id: string) => unknown;
      };
    }
  ).process;

  // Node 20.16+ / 22.12+: no import graph for DTS.
  const fromBuiltin = processLike?.getBuiltinModule?.("crypto") as
    | NodeCryptoLike
    | undefined;
  if (typeof fromBuiltin?.createHash === "function") {
    return fromBuiltin;
  }

  // Node 18 / older 20: CJS `require` when available (tsup CJS output, some loaders).
  try {
    const nodeRequire = Function(
      "return typeof require !== 'undefined' ? require : null"
    )() as ((id: string) => NodeCryptoLike) | null;
    const fromRequire = nodeRequire?.("crypto");
    if (typeof fromRequire?.createHash === "function") {
      return fromRequire;
    }
  } catch {
    // fall through
  }

  throw new Error(
    "Node.js crypto.createHash is required (process.getBuiltinModule or require)"
  );
}

let cached: NodeCryptoLike | undefined;

/** SHA-256 hex digest of a UTF-8 string (Node crypto, sync). */
export function sha256HexUtf8(text: string): string {
  cached ??= loadNodeCrypto();
  return cached.createHash("sha256").update(text, "utf8").digest("hex");
}
