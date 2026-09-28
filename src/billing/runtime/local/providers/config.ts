import {
  type AthenaRuntimeEnvironment,
  detectAthenaRuntimeEnvironment,
} from "../../../../runtime/resolve.ts";
import {
  ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
  ATHENA_BILLING_PROVIDER_SDK_REQUIRED,
  ATHENA_BILLING_PROVIDER_SERVER_REQUIRED,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import type {
  BillingProviderConfigMap,
  BillingProviderDiagnostics,
  MollieBillingApiMode,
  MollieBillingCredentialKind,
  MollieBillingProviderConfig,
  MollieSdkAdapterFactory,
  MollieSdkConstructor,
  NormalizedBillingProviderConfigs,
  NormalizedMollieBillingProviderConfig,
  StripeBillingProviderConfig,
} from "../../../providers/types.ts";
import type { BillingCredentialAuthority } from "../../authority.ts";
import {
  availableBillingCredentialEnvironments,
  type BillingProviderBindingCredentials,
  BillingSecret,
  type BillingStoredCredential,
} from "../../credentials.ts";
import {
  assertCredentialSlotEnvironment,
  classifyMollieCredentialPrefix,
  inferMollieCredentialEnvironment,
} from "./inspect.ts";
import { normalizeStripeBillingProviderConfig } from "./stripe/config.ts";
import {
  resolveMollieAdvancedTokenAuthority,
  resolveMollieApiKeyAuthority,
  resolveMollieCompatibleTokenAuthority,
} from "./token-authority.ts";

const DEFAULT_MOLLIE_API_BASE_URL = "https://api.mollie.com";

function configuredProviderNames(
  configured: BillingProviderConfigMap | undefined
): string[] {
  if (configured == null) {
    return [];
  }

  return Object.keys(configured).filter((name) => configured[name] != null);
}

function canonicalProviderDefault(
  configured: BillingProviderConfigMap | undefined,
  provider: "mollie" | "stripe"
): unknown {
  const value = configured?.[provider];
  if (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "default" in value
  ) {
    return (value as { default?: unknown }).default;
  }
  return value;
}

export function assertBillingProviderRuntimeEnvironment(
  configured?: BillingProviderConfigMap,
  options?: { environment?: AthenaRuntimeEnvironment }
): void {
  if (configuredProviderNames(configured).length === 0) {
    return;
  }
  const environment = options?.environment ?? detectAthenaRuntimeEnvironment();
  if (environment === "browser" || environment === "react-native") {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_SERVER_REQUIRED,
      message:
        "billing.providers requires a trusted server runtime and cannot be configured in the browser or React Native.",
    });
  }
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultProfileIdFrom(config: {
  defaultProfileId?: string | null;
  profileId?: string | null;
}): string | undefined {
  return nonEmpty(config.defaultProfileId) ?? nonEmpty(config.profileId);
}

function storeMollieCredential(
  secret: string,
  environment: "test" | "live",
  kind: MollieBillingCredentialKind
): BillingStoredCredential {
  assertCredentialSlotEnvironment({
    environment,
    inferred: inferMollieCredentialEnvironment(secret),
    provider: "mollie",
  });
  return {
    kind,
    secret: new BillingSecret(secret),
  };
}

function assertMollieSecretKind(
  secret: string,
  kind: MollieBillingCredentialKind
): void {
  const prefix = classifyMollieCredentialPrefix(secret);
  if (kind === "api_key" && prefix === "access_token") {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message:
        "billing.providers.mollie API keys cannot use an Advanced Access Token secret.",
    });
  }
  if (kind === "advanced_access_token" && prefix !== "access_token") {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message:
        prefix === "api_key"
          ? "billing.providers.mollie advanced_access_token cannot use a test_ or live_ API key."
          : "billing.providers.mollie advanced_access_token requires an access_ token prefix.",
    });
  }
}

function pairCredentials(
  testSecret: string | undefined,
  liveSecret: string | undefined,
  kind: MollieBillingCredentialKind
): BillingProviderBindingCredentials {
  if (testSecret) {
    assertMollieSecretKind(testSecret, kind);
  }
  if (liveSecret) {
    assertMollieSecretKind(liveSecret, kind);
  }
  const credentials: BillingProviderBindingCredentials = {
    ...(testSecret
      ? { test: storeMollieCredential(testSecret, "test", kind) }
      : {}),
    ...(liveSecret
      ? { live: storeMollieCredential(liveSecret, "live", kind) }
      : {}),
  };
  if (credentials.test == null && credentials.live == null) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: "billing.providers.mollie requires a test or live credential.",
    });
  }
  return credentials;
}

function modesFromCredentials(credentials: BillingProviderBindingCredentials): {
  test: boolean;
  live: boolean;
} {
  return {
    live: credentials.live != null,
    test: credentials.test != null,
  };
}

function adapterBackedSdk(
  adapter: MollieSdkAdapterFactory
): MollieSdkConstructor {
  return adapter as unknown as MollieSdkConstructor;
}

function requireMollieSdkBinding(config: MollieBillingProviderConfig): {
  adapter?: MollieSdkAdapterFactory;
  sdk: MollieSdkConstructor;
} {
  if (config.adapter != null) {
    return {
      adapter: config.adapter,
      sdk: config.sdk ?? adapterBackedSdk(config.adapter),
    };
  }
  if (config.sdk == null) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_SDK_REQUIRED,
      message:
        "billing.providers.mollie.sdk or adapter is required. Inject the official mollie-api-typescript Client constructor.",
    });
  }
  return { sdk: config.sdk };
}

function declaredPermissionsFrom(config: {
  authority?: { permissions?: Record<string, unknown> };
  permissions?: Record<string, unknown>;
}): Record<string, boolean | Record<string, boolean | undefined>> | undefined {
  return (
    (config.permissions as
      | Record<string, boolean | Record<string, boolean | undefined>>
      | undefined) ??
    (config.authority?.permissions as
      | Record<string, boolean | Record<string, boolean | undefined>>
      | undefined)
  );
}

function normalizeAdvancedMollieConfig(
  config: Extract<MollieBillingProviderConfig, { accessToken: string }>
): NormalizedMollieBillingProviderConfig {
  const accessToken = nonEmpty(config.accessToken);
  if (accessToken == null) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message:
        "billing.providers.mollie.accessToken is required for advanced_access_token.",
    });
  }
  assertMollieSecretKind(accessToken, "advanced_access_token");
  const apiMode: MollieBillingApiMode = config.apiMode ?? "test";
  const credentials = pairCredentials(
    apiMode === "live" ? undefined : accessToken,
    apiMode === "test" ? undefined : accessToken,
    "advanced_access_token"
  );
  const inferredProfileId = nonEmpty(config.profileId);
  const configuredScopeProfileId =
    config.scope?.kind === "profile"
      ? nonEmpty(config.scope.profileId)
      : undefined;
  if (config.scope?.kind === "profile" && configuredScopeProfileId == null) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message:
        "billing.providers.mollie.scope.profileId is required when scope.kind is profile.",
    });
  }
  const scope =
    config.scope == null
      ? inferredProfileId === null
        ? { kind: "organization" as const }
        : { kind: "profile" as const, profileId: inferredProfileId }
      : config.scope.kind === "profile" && configuredScopeProfileId != null
        ? { kind: "profile" as const, profileId: configuredScopeProfileId }
        : config.scope;
  const profileId =
    scope.kind === "profile" ? scope.profileId : defaultProfileIdFrom(config);
  const authority: BillingCredentialAuthority =
    resolveMollieAdvancedTokenAuthority({
      apiMode,
      declaredPermissions: declaredPermissionsFrom(config),
      scope,
    });
  const defaultProfileId = defaultProfileIdFrom(config);
  return {
    apiBaseUrl: nonEmpty(config.apiBaseUrl) ?? DEFAULT_MOLLIE_API_BASE_URL,
    authority,
    credentialKind: "advanced_access_token",
    credentials,
    defaultProfileId: defaultProfileId ?? null,
    profileId: profileId ?? defaultProfileId ?? null,
    provider: "mollie",
    ...requireMollieSdkBinding(config),
  };
}

export function normalizeMollieBillingProviderConfig(
  config: MollieBillingProviderConfig
): NormalizedMollieBillingProviderConfig {
  const credentialKind: MollieBillingCredentialKind =
    config.credentialKind ??
    ("accessToken" in config && nonEmpty(config.accessToken) != null
      ? "advanced_access_token"
      : "api_key");
  if (credentialKind === "advanced_access_token") {
    if (!("accessToken" in config)) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
        message:
          "billing.providers.mollie advanced_access_token configuration is invalid.",
      });
    }
    return normalizeAdvancedMollieConfig(config);
  }
  const testSecret =
    credentialKind === "api_key"
      ? nonEmpty("testKey" in config ? config.testKey : undefined)
      : nonEmpty("testToken" in config ? config.testToken : undefined);
  const liveSecret =
    credentialKind === "api_key"
      ? nonEmpty("liveKey" in config ? config.liveKey : undefined)
      : nonEmpty("liveToken" in config ? config.liveToken : undefined);
  const credentials = pairCredentials(testSecret, liveSecret, credentialKind);
  const profileId =
    credentialKind === "api_key"
      ? nonEmpty("profileId" in config ? config.profileId : undefined)
      : defaultProfileIdFrom({
          defaultProfileId:
            "defaultProfileId" in config ? config.defaultProfileId : undefined,
          profileId: "profileId" in config ? config.profileId : undefined,
        });
  if (
    (credentialKind === "organization_access_token" ||
      credentialKind === "oauth_access_token") &&
    profileId == null
  ) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message:
        "billing.providers.mollie.defaultProfileId or profileId is required for organization_access_token and oauth_access_token.",
    });
  }
  const declaredPermissions =
    "permissions" in config || "authority" in config
      ? declaredPermissionsFrom(config)
      : undefined;
  const authority =
    credentialKind === "api_key"
      ? resolveMollieApiKeyAuthority({
          modes: modesFromCredentials(credentials),
          profileId,
        })
      : resolveMollieCompatibleTokenAuthority({
          declaredPermissions,
          modes: modesFromCredentials(credentials),
          profileId,
        });
  return {
    apiBaseUrl: nonEmpty(config.apiBaseUrl) ?? DEFAULT_MOLLIE_API_BASE_URL,
    authority,
    credentialKind,
    credentials,
    defaultProfileId: profileId ?? null,
    profileId: profileId ?? null,
    provider: "mollie",
    ...requireMollieSdkBinding(config),
  };
}

export function normalizeBillingProviderConfig(
  configured?: BillingProviderConfigMap
): NormalizedBillingProviderConfigs {
  assertBillingProviderRuntimeEnvironment(configured);
  const next: NormalizedBillingProviderConfigs = {};
  const mollie = canonicalProviderDefault(configured, "mollie");
  if (mollie != null) {
    next.mollie = normalizeMollieBillingProviderConfig(
      mollie as MollieBillingProviderConfig
    );
  }
  const stripe = canonicalProviderDefault(configured, "stripe");
  if (stripe != null) {
    next.stripe = normalizeStripeBillingProviderConfig(
      stripe as StripeBillingProviderConfig
    );
  }
  return next;
}

export function toBillingProviderDiagnostics(
  normalized: NormalizedBillingProviderConfigs
): BillingProviderDiagnostics {
  if (normalized.mollie != null) {
    return {
      availableEnvironments: availableBillingCredentialEnvironments(
        normalized.mollie.credentials
      ),
      configured: true,
      credentialKind: normalized.mollie.credentialKind,
      profileId: normalized.mollie.profileId ?? undefined,
      provider: "mollie",
    };
  }
  if (normalized.stripe != null) {
    return {
      availableEnvironments: availableBillingCredentialEnvironments(
        normalized.stripe.credentials
      ),
      configured: true,
      credentialKind: normalized.stripe.credentialKind,
      provider: "stripe",
    };
  }
  return { configured: false };
}
