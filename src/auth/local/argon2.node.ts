/**
 * Node/server Argon2id boundary. Static import so bundlers (Next/Turbopack)
 * can trace `@noble/hashes` from Athena's declared dependency.
 *
 * Must stay off browser / Next client / RN graphs. Isolation is the local
 * Auth runtime boundary (`src/auth/local/**`). Do not add the Next
 * `server-only` package here (ADR 0064: that directive stays on public
 * framework edges).
 */
import { argon2id } from "@noble/hashes/argon2.js";

export function deriveArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  options: {
    dkLen: number;
    m: number;
    p: number;
    t: number;
  }
): Uint8Array {
  return argon2id(password, salt, options);
}
