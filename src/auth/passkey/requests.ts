import type { AthenaAuthEndpointPath, AthenaAuthMethod } from "../types.ts";
import type { CanonicalPasskeyMethod } from "./contract.ts";

export interface PasskeyRequestSpec {
  gated: boolean;
  method: AthenaAuthMethod;
  path: AthenaAuthEndpointPath;
}

/**
 * HTTP map for `athena.auth.passkey.*`.
 * Seven `/passkey/*` routes are capability-gated; `/.well-known/webauthn` is not.
 */
export const PASSKEY_REQUESTS = {
  delete: {
    gated: true,
    method: "POST",
    path: "/passkey/delete-passkey",
  },
  generateAuthenticateOptions: {
    gated: true,
    method: "POST",
    path: "/passkey/generate-authenticate-options",
  },
  generateRegisterOptions: {
    gated: true,
    method: "GET",
    path: "/passkey/generate-register-options",
  },
  getRelatedOrigins: {
    gated: false,
    method: "GET",
    path: "/.well-known/webauthn",
  },
  listUser: {
    gated: true,
    method: "GET",
    path: "/passkey/list-user-passkeys",
  },
  update: {
    gated: true,
    method: "POST",
    path: "/passkey/update-passkey",
  },
  verifyAuthentication: {
    gated: true,
    method: "POST",
    path: "/passkey/verify-authentication",
  },
  verifyRegistration: {
    gated: true,
    method: "POST",
    path: "/passkey/verify-registration",
  },
} as const satisfies Record<CanonicalPasskeyMethod, PasskeyRequestSpec>;
