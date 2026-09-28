/**
 * Framework social-config entry. Next/RSC graphs import this module.
 * CLI and Node `createClient` must use `auth/social/node/social-config.ts`.
 */
import "server-only";

export {
  type AthenaAuthSocialOptions,
  type AthenaAuthSocialProviderOptions,
  type NormalizedSocialAuthConfig,
  normalizeSocialAuthConfig,
} from "../node/social-config.ts";
