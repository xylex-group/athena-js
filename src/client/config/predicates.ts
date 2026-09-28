import type { AthenaChatConfig, AthenaClientConfig } from "../contracts.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import {
  ATHENA_ENV_DB_URL_KEYS,
  ATHENA_ENV_URL_KEYS,
} from "../../env/index.ts";
import {
  athenaAuthConfig,
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
} from "../../auth/config.ts";
import {
  getLocalObjectStore,
  isLocalStorageConfig,
} from "../../storage/runtime.ts";
import type { R2BucketLike } from "../../cloudflare/types.ts";
import { CLOUDFLARE_EDGE_BASE_URL } from "../../cloudflare/types.ts";

export function athenaChatConfig(
  chat: boolean | AthenaChatConfig | undefined,
): AthenaChatConfig | undefined {
  return chat === undefined || chat === false || chat === true
    ? undefined
    : chat;
}

export function normalizeOptional(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function isD1Binding(value: unknown): value is { prepare: unknown } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { prepare?: unknown }).prepare === "function",
  );
}

export function isR2Binding(value: unknown): value is R2BucketLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as R2BucketLike).put === "function" &&
      typeof (value as R2BucketLike).get === "function",
  );
}

export function isEdgeLocalSentinelUrl(url: string | undefined): boolean {
  return Boolean(
    url &&
      (url === CLOUDFLARE_EDGE_BASE_URL ||
        url.startsWith("https://athena.local/") ||
        url.startsWith("http://athena.local/")),
  );
}

function readFirstEnvHttpUrl(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptional(env?.[key]);
    if (!value) {
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return value;
      }
    } catch {
      continue;
    }
  }
}

export function resolveUnifiedRemoteRoot(
  config: Pick<AthenaClientConfig, "env" | "url">,
): string | undefined {
  return (
    normalizeOptional(config.url) ??
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_URL_KEYS)
  );
}

export function hasRemoteDbGatewayUrl<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const dbUrl =
    normalizeOptional(config.db?.url) ??
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_DB_URL_KEYS);
  return Boolean(dbUrl && !isEdgeLocalSentinelUrl(dbUrl));
}

export function hasExplicitRemoteHttpApiKeyNeed<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authDisabled = isDisabledAthenaAuthConfig(config.auth);
  const authLocal = isLocalAthenaAuthConfig(config.auth);
  const authObject = athenaAuthConfig(config.auth);
  return Boolean(
    (!(authDisabled || authLocal) &&
      (normalizeOptional(authObject?.url) ||
        readFirstEnvHttpUrl(config.env, [
          "ATHENA_AUTH_URL",
          "NEXT_PUBLIC_ATHENA_AUTH_URL",
        ]))) ||
      normalizeOptional(config.storage?.url) ||
      readFirstEnvHttpUrl(config.env, [
        "ATHENA_STORAGE_URL",
        "NEXT_PUBLIC_ATHENA_STORAGE_URL",
      ]) ||
      normalizeOptional(athenaChatConfig(config.chat)?.url) ||
      readFirstEnvHttpUrl(config.env, [
        "ATHENA_CHAT_URL",
        "NEXT_PUBLIC_ATHENA_CHAT_URL",
      ]) ||
      normalizeOptional(config.billing?.url),
  );
}

export function hasRemoteHttpServices<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authObject = athenaAuthConfig(config.auth);
  return Boolean(
    resolveUnifiedRemoteRoot(config) ||
      hasRemoteDbGatewayUrl(config) ||
      (!isDisabledAthenaAuthConfig(config.auth) &&
        (normalizeOptional(authObject?.url) ||
          readFirstEnvHttpUrl(
            config.env,
            ["ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"],
          ))) ||
      normalizeOptional(config.storage?.url) ||
      readFirstEnvHttpUrl(
        config.env,
        ["ATHENA_STORAGE_URL", "NEXT_PUBLIC_ATHENA_STORAGE_URL"],
      ) ||
      normalizeOptional(athenaChatConfig(config.chat)?.url) ||
      readFirstEnvHttpUrl(
        config.env,
        ["ATHENA_CHAT_URL", "NEXT_PUBLIC_ATHENA_CHAT_URL"],
      ) ||
      normalizeOptional(config.billing?.url),
  );
}

export function hasRemoteHttpStorage<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  return Boolean(
    normalizeOptional(config.storage?.url) ||
      readFirstEnvHttpUrl(
        config.env,
        ["ATHENA_STORAGE_URL", "NEXT_PUBLIC_ATHENA_STORAGE_URL"],
      ) ||
      resolveUnifiedRemoteRoot(config),
  );
}

export function hasRemoteAuthService<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  if (
    isDisabledAthenaAuthConfig(config.auth) ||
    isLocalAthenaAuthConfig(config.auth)
  ) {
    return false;
  }
  const authObject = athenaAuthConfig(config.auth);
  return Boolean(
    normalizeOptional(authObject?.url) ||
      readFirstEnvHttpUrl(
        config.env,
        ["ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"],
      ) ||
      resolveUnifiedRemoteRoot(config),
  );
}

export function hasChatSessionCredentials(
  chat?: boolean | AthenaChatConfig,
): boolean {
  const options = athenaChatConfig(chat);
  return Boolean(
    normalizeOptional(options?.bearerToken) ??
      normalizeOptional(options?.cookie) ??
      normalizeOptional(options?.sessionToken),
  );
}

export function isRemoteAuthOnlyClient<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const authObject = athenaAuthConfig(config.auth);
  if (
    isDisabledAthenaAuthConfig(config.auth) ||
    isLocalAthenaAuthConfig(config.auth) ||
    !normalizeOptional(authObject?.url) ||
    config.gatewayTransport
  ) {
    return false;
  }
  return !(
    normalizeOptional(config.url) ||
    normalizeOptional(config.db?.url) ||
    normalizeOptional(config.db?.pgUri) ||
    normalizeOptional(config.databaseUrl) ||
    normalizeOptional(config.storage?.url) ||
    (isLocalStorageConfig(config.storage) &&
      Boolean(
        getLocalObjectStore(config.storage) ||
          normalizeOptional(config.storage.root),
      )) ||
    normalizeOptional(athenaChatConfig(config.chat)?.url) ||
    normalizeOptional(config.billing?.url) ||
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_URL_KEYS) ||
    readFirstEnvHttpUrl(config.env, ATHENA_ENV_DB_URL_KEYS) ||
    readFirstEnvHttpUrl(
      config.env,
      ["ATHENA_STORAGE_URL", "NEXT_PUBLIC_ATHENA_STORAGE_URL"],
    ) ||
    readFirstEnvHttpUrl(
      config.env,
      ["ATHENA_CHAT_URL", "NEXT_PUBLIC_ATHENA_CHAT_URL"],
    )
  );
}
