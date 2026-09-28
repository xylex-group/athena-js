import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalizeAthenaCapabilitiesIr } from "./canonicalize.ts";

export function fingerprintAthenaCapabilitiesIr(value: unknown): string {
  const canonical = canonicalizeAthenaCapabilitiesIr(value);
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          capabilities: canonical.capabilities,
          irVersion: canonical.irVersion,
          kind: canonical.kind,
        })
      )
    )
  );
}
