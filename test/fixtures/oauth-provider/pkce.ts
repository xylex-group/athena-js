import { createHash } from "node:crypto";

export function oauthS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
