import type { AthenaChatWebSocketFactory } from "../chat/types.ts";
import type { AthenaClientModelsInput } from "../schema/types.ts";
// Browser-safe client core: React Native (Hermes) cannot run the Node-only
// direct PostgreSQL transport, so this entry must not reach it.
import {
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaRequestContext,
  type AthenaRequestContextProvider,
  assertDirectPostgresRequiresNodeRuntime,
  assertLocalAuthRequiresNodeRuntime,
  createClient as createUniversalClient,
} from "../v3-client-core.ts";
import { resolveReactNativeRequestContext } from "./runtime.ts";
import type {
  AthenaLifecycleAdapter,
  AthenaLinkingAdapter,
  AthenaReactNativeFetch,
  AthenaTokenStore,
  AthenaUploadAdapter,
} from "./types.ts";
import { resolveReactNativeWebSocketFactory } from "./websocket.ts";

export type AthenaReactNativeClientOptions<
  TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClientConfig<TModels> & {
  /**
   * App-owned secure token store. When set, access/session tokens are merged
   * into request context unless the caller already provided explicit values.
   */
  tokenStore?: AthenaTokenStore;
  /** Injectable fetch (defaults to globalThis.fetch). */
  fetch?: AthenaReactNativeFetch;
  linking?: AthenaLinkingAdapter;
  lifecycle?: AthenaLifecycleAdapter;
  upload?: AthenaUploadAdapter;
  webSocketFactory?: AthenaChatWebSocketFactory | null;
};

function isContextProvider(
  value: AthenaClientConfig["context"],
): value is AthenaRequestContextProvider {
  return typeof value === "function";
}

/**
 * Construct the shared Athena client with React Native-safe defaults:
 * - auth.credentials defaults to `"omit"` (no browser cookie jar)
 * - optional tokenStore → bearer/session context
 * - injectable fetch / WebSocket factory
 *
 * Query runtime is {@link createClient} — no duplicated builders.
 */
export function createReactNativeClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  options: AthenaReactNativeClientOptions<TModels>,
): AthenaClient<TModels> {
  const {
    tokenStore,
    fetch: fetchImpl,
    linking: _linking,
    lifecycle: _lifecycle,
    upload: _upload,
    webSocketFactory,
    auth,
    chat,
    context,
    ...rest
  } = options;

  void _linking;
  void _lifecycle;
  void _upload;

  const userContext = context;
  const contextProvider: AthenaRequestContextProvider = async () => {
    let base: AthenaRequestContext | undefined;
    if (isContextProvider(userContext)) {
      base = await userContext();
    } else if (userContext) {
      base = userContext;
    }
    return resolveReactNativeRequestContext({
      base,
      tokenStore,
    });
  };

  const resolvedWs = resolveReactNativeWebSocketFactory(
    webSocketFactory ?? chat?.webSocketFactory,
  );

  const nextAuth: AthenaClientConfig<TModels>["auth"] =
    auth === false
      ? false
      : {
          ...auth,
          credentials: auth?.credentials ?? ("omit" as const),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        };

  const nextChat = {
    ...chat,
    ...(resolvedWs ? { webSocketFactory: resolvedWs } : {}),
  };

  // Nuclear cast: same pattern as createCloudflareClient / createClient body (TS2589).
  const nextConfig = {
    ...rest,
    auth: nextAuth,
    chat: nextChat,
    context: contextProvider,
  };
  assertDirectPostgresRequiresNodeRuntime(nextConfig);
  assertLocalAuthRequiresNodeRuntime(nextConfig);
  const client = (createUniversalClient as (c: unknown) => unknown)(
    nextConfig,
  );
  return client as AthenaClient<TModels>;
}

/**
 * Documented `createClient` from `@xylex-group/athena/react-native`.
 * Same universal core construction as the root entry, except direct
 * PostgreSQL (`db.pgUri`) is Node/server-only and fails fast with
 * `ATHENA_POSTGRES_DIRECT_NODE_REQUIRED` (must not bypass the RN guard
 * that `createReactNativeClient` already applies).
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels> {
  assertDirectPostgresRequiresNodeRuntime(config);
  assertLocalAuthRequiresNodeRuntime(config);
  const factory = createUniversalClient as unknown as (
    c: unknown,
  ) => unknown;
  return factory(config) as AthenaClient<TModels>;
}