/**
 * Node-facing social OAuth adapter.
 *
 * The normalization algorithm lives in the browser-safe shared config
 * module. Local Node Auth configs retain provider secrets there; remote
 * configs are normalized without them.
 */
export type {
  AthenaAuthSocialOptions,
  AthenaAuthSocialProviderOptions,
  NormalizedSocialAuthConfig,
} from "../config.ts";

import { normalizeAuthSocialProviders } from "../config.ts";

export function normalizeSocialAuthConfig(raw: Record<string, unknown>) {
  return normalizeAuthSocialProviders({ ...raw, mode: "local" });
}
