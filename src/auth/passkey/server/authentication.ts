/**
 * Domain authentication entry for the internal passkey server.
 * HTTP parse/authorize stays in `src/auth/local/passkey/`.
 * Do not put WebAuthn algorithms in `runtime.ts`.
 * Engine ceremony remains NotWired until authenticate options/verify land.
 */
import type { AthenaPasskeyServerEngine } from "./engine.ts";
import type {
  AthenaPasskeyAuthenticationFinishInput,
  AthenaPasskeyAuthenticationFinishResult,
  AthenaPasskeyAuthenticationStartInput,
  AthenaPasskeyAuthenticationStartResult,
} from "./types.ts";

export async function generateAuthenticationOptions(
  server: AthenaPasskeyServerEngine,
  input: AthenaPasskeyAuthenticationStartInput
): Promise<AthenaPasskeyAuthenticationStartResult> {
  return server.startAuthentication(input);
}

export async function verifyAuthentication(
  server: AthenaPasskeyServerEngine,
  input: AthenaPasskeyAuthenticationFinishInput
): Promise<AthenaPasskeyAuthenticationFinishResult> {
  return server.finishAuthentication(input);
}
