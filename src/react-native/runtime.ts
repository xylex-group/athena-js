import type { AthenaRequestContext } from "../v3-client-core.ts";
import type { AthenaTokenStore } from "./types.ts";

export async function resolveReactNativeRequestContext(input: {
  tokenStore?: AthenaTokenStore;
  base?: AthenaRequestContext | null;
}): Promise<AthenaRequestContext> {
  const base = input.base ?? {};
  const store = input.tokenStore;
  const access =
    base.bearerToken !== undefined && base.bearerToken !== null
      ? base.bearerToken
      : store
        ? await store.getAccessToken()
        : undefined;
  const session =
    base.sessionToken !== undefined && base.sessionToken !== null
      ? base.sessionToken
      : store
        ? await store.getSessionToken()
        : undefined;

  return {
    ...base,
    ...(access !== undefined && access !== null ? { bearerToken: access } : {}),
    ...(session !== undefined && session !== null
      ? { sessionToken: session }
      : {}),
  };
}
