/**
 * @xylex-group/athena/react-native
 *
 * Thin platform adapter over the shared Athena runtime.
 * Public surface is intentionally small — see architecture pack INV-H.
 */

// Shared error helpers used by mobile apps (same as browser core surface essentials)
export {
  AthenaError,
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  isOk,
  normalizeAthenaError,
  requireSuccess,
  unwrap,
  unwrapOne,
  unwrapRows,
} from "../auxiliaries.js";
export type {
  AthenaClient,
  AthenaClientConfig,
  AthenaRequestContext,
} from "../v3-client-core.ts";
export {
  type AthenaReactNativeClientOptions,
  createClient,
  createReactNativeClient,
} from "./client.ts";

export {
  type AthenaLifecycleAdapter,
  createNoopLifecycleAdapter,
} from "./lifecycle.ts";
export {
  type AthenaLinkingAdapter,
  createNoopLinkingAdapter,
} from "./linking.ts";
export { resolveReactNativeRequestContext } from "./runtime.ts";
export {
  type AthenaUploadAdapter,
  createDefaultUploadAdapter,
} from "./storage.ts";
export {
  type AthenaTokenStore,
  createMemoryTokenStore,
} from "./token-store.ts";
export type {
  AthenaLifecycleState,
  AthenaReactNativeFetch,
} from "./types.ts";
export { resolveReactNativeWebSocketFactory } from "./websocket.ts";
