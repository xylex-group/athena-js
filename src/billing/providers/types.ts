import type { BillingCredentialAuthority } from "../runtime/authority.ts";
import type {
  BillingCredentialKind,
  BillingProviderBindingCredentials,
} from "../runtime/credentials.ts";
import type { BillingProviderName } from "../types.ts";

export type MollieBillingApiMode = "test" | "live" | "both";

export type MollieBillingCredentialKind =
  | "api_key"
  | "advanced_access_token"
  | "organization_access_token"
  | "oauth_access_token";

export type MollieBillingAuthorityScope =
  | { kind: "organization" }
  | { kind: "profile"; profileId: string };

export type MollieDeclaredPermissions = Record<
  string,
  boolean | Record<string, boolean | undefined>
>;

export interface MollieDeclaredAuthorityConfig {
  permissions?: MollieDeclaredPermissions;
  source?: "declared";
}

export interface MollieSdkClientSecurity {
  advancedAccessToken?: string;
  apiKey?: string;
  oAuth?: string;
}

export interface MollieSdkClientOptions {
  customUserAgent?: string;
  profileId?: string;
  security?: MollieSdkClientSecurity;
  serverURL?: string;
  testmode?: boolean;
}

export interface MollieSdkResourcePort {
  cancel?(request: Record<string, unknown>): Promise<unknown>;
  create?(request: Record<string, unknown>): Promise<unknown>;
  delete?(request: Record<string, unknown>): Promise<unknown>;
  get?(request: Record<string, unknown>): Promise<unknown>;
  list?(request: Record<string, unknown>): Promise<unknown>;
  update?(request: Record<string, unknown>): Promise<unknown>;
}

export interface MollieSdkClient {
  customers: MollieSdkResourcePort;
  invoices?: MollieSdkResourcePort;
  paymentLinks: MollieSdkResourcePort;
  payments: MollieSdkResourcePort;
  refunds: MollieSdkResourcePort;
  salesInvoices?: MollieSdkResourcePort;
  subscriptions: MollieSdkResourcePort;
}

export type MollieSdkConstructor = new (
  options?: MollieSdkClientOptions
) => MollieSdkClient;

export type MollieSdkAdapterFactory = (
  options?: MollieSdkClientOptions
) => MollieSdkClient;

/** @deprecated Use {@link MollieSdkConstructor}. */
export type MollieInjectedSdk = MollieSdkConstructor;

export type StripeBillingCredentialKind =
  | "secret_key"
  | "restricted_key"
  | "oauth_access_token";

export type MollieBillingProviderSdkConfig = {
  apiBaseUrl?: string;
} & (
  | {
      adapter?: MollieSdkAdapterFactory;
      sdk: MollieSdkConstructor;
    }
  | {
      adapter: MollieSdkAdapterFactory;
      sdk?: MollieSdkConstructor;
    }
);

export type MollieBillingProviderConfig = MollieBillingProviderSdkConfig &
  (
    | {
        credentialKind?: "api_key";
        liveKey?: string;
        profileId?: string | null;
        testKey?: string;
      }
    | {
        accessToken: string;
        apiMode?: MollieBillingApiMode;
        authority?: MollieDeclaredAuthorityConfig;
        credentialKind?: "advanced_access_token";
        defaultProfileId?: string | null;
        permissions?: MollieDeclaredPermissions;
        profileId?: string | null;
        scope?: MollieBillingAuthorityScope;
      }
    | {
        authority?: MollieDeclaredAuthorityConfig;
        credentialKind: "organization_access_token";
        defaultProfileId?: string | null;
        liveToken?: string;
        permissions?: MollieDeclaredPermissions;
        profileId?: string | null;
        testToken?: string;
      }
    | {
        authority?: MollieDeclaredAuthorityConfig;
        credentialKind: "oauth_access_token";
        defaultProfileId?: string | null;
        liveToken?: string;
        permissions?: MollieDeclaredPermissions;
        profileId?: string | null;
        testToken?: string;
      }
  );

export type StripeBillingProviderConfig =
  | {
      credentialKind?: "secret_key";
      testKey?: string;
      liveKey?: string;
      accountId?: string | null;
      apiBaseUrl?: string;
    }
  | {
      credentialKind: "restricted_key";
      testKey?: string;
      liveKey?: string;
      accountId?: string | null;
      apiBaseUrl?: string;
    }
  | {
      credentialKind: "oauth_access_token";
      testToken?: string;
      liveToken?: string;
      accountId?: string | null;
      apiBaseUrl?: string;
    };

export interface MollieBillingProviderConfigWrapper {
  accounts?: Record<string, MollieBillingProviderConfig>;
  default?: MollieBillingProviderConfig;
}

export interface StripeBillingProviderConfigWrapper {
  accounts?: Record<string, StripeBillingProviderConfig>;
  default?: StripeBillingProviderConfig;
}

export interface BillingProviderConfigs {
  mollie?: MollieBillingProviderConfig | MollieBillingProviderConfigWrapper;
  /**
   * Named Mollie credential slots. A connection's `credential_reference`
   * `providers.mollie:<id>` selects `mollieAccounts[id]`.
   */
  mollieAccounts?: Record<string, MollieBillingProviderConfig>;
  stripe?: StripeBillingProviderConfig | StripeBillingProviderConfigWrapper;
  stripeAccounts?: Record<string, StripeBillingProviderConfig>;
}

export type BillingProviderConfigMap = BillingProviderConfigs & {
  [provider: string]: unknown;
};

export interface NormalizedMollieBillingProviderConfig {
  adapter?: MollieSdkAdapterFactory;
  apiBaseUrl: string;
  authority: BillingCredentialAuthority;
  credentialKind: MollieBillingCredentialKind;
  credentials: BillingProviderBindingCredentials;
  defaultProfileId?: string | null;
  profileId?: string | null;
  provider: "mollie";
  sdk: MollieSdkConstructor;
}

export interface NormalizedStripeBillingProviderConfig {
  accountId?: string | null;
  apiBaseUrl: string;
  credentialKind: StripeBillingCredentialKind;
  credentials: BillingProviderBindingCredentials;
  provider: "stripe";
}

export interface NormalizedBillingProviderConfigs {
  mollie?: NormalizedMollieBillingProviderConfig;
  stripe?: NormalizedStripeBillingProviderConfig;
}

export interface BillingProviderDiagnostics {
  availableEnvironments?: Array<"test" | "live">;
  configured: boolean;
  credentialKind?: BillingCredentialKind;
  profileId?: string;
  provider?: BillingProviderName;
}
