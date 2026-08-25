import type { AthenaAuthCapabilitiesResult } from "../capabilities.ts";
import type { AthenaAuthSessionController } from "../session-controller.ts";
import type {
  AthenaAuthBindings,
  AthenaAuthCallOptions,
  AthenaAuthRequestInput,
  AthenaAuthResult,
} from "../types.ts";

/** Frozen public method names — do not grow a second namespace. */
export const CANONICAL_PASSKEY_METHODS = [
  "generateRegisterOptions",
  "generateAuthenticateOptions",
  "verifyRegistration",
  "verifyAuthentication",
  "listUserPasskeys",
  "deletePasskey",
  "updatePasskey",
  "getRelatedOrigins",
] as const;

export type CanonicalPasskeyMethod = (typeof CANONICAL_PASSKEY_METHODS)[number];

/** Internal alias of the public `athena.auth.passkey` surface. */
export type AthenaPasskeyBindings = AthenaAuthBindings["passkey"];

export type PasskeyModuleRequest = <T = unknown>(
  input: AthenaAuthRequestInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<T>>;

export type PasskeyModuleCapabilities =
  | AthenaAuthCapabilitiesResult
  | { getSnapshot: () => AthenaAuthCapabilitiesResult };

/** Canonical session store. `verifyAuthentication` success calls `accept`. */
export type PasskeyModuleSessionController = Pick<
  AthenaAuthSessionController,
  "accept"
>;

export interface CreatePasskeyModuleDeps {
  capabilities: PasskeyModuleCapabilities;
  request: PasskeyModuleRequest;
  sessionController: PasskeyModuleSessionController;
}
