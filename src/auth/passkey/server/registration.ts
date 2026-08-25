/**
 * Domain registration entry for the internal passkey server.
 * HTTP parse/authorize stays in `src/auth/local/passkey/`.
 * Engine ceremony remains NotWired until a later wire slice.
 */
import type { AthenaPasskeyServerEngine } from "./engine.ts";
import type {
  AthenaPasskeyRegistrationFinishInput,
  AthenaPasskeyRegistrationStartInput,
  AthenaPasskeyRegistrationStartResult,
  AthenaStoredPasskey,
} from "./types.ts";

export async function generateRegistrationOptions(
  server: AthenaPasskeyServerEngine,
  input: AthenaPasskeyRegistrationStartInput
): Promise<AthenaPasskeyRegistrationStartResult> {
  return server.startRegistration(input);
}

export async function verifyRegistration(
  server: AthenaPasskeyServerEngine,
  input: AthenaPasskeyRegistrationFinishInput
): Promise<AthenaStoredPasskey> {
  return server.finishRegistration(input);
}
