import type { AthenaBillingClientConfig } from "./module.ts";
import type { BillingSelfEnrollmentConfig } from "./self-enrollment.ts";
import type { AthenaBillingCatalogConfig } from "./types.ts";

/** `createClient({ billing })` fields for local, remote, and Embedded HTTP. */
export interface AthenaBillingConfig
  extends Omit<
    AthenaBillingClientConfig,
    "baseUrl" | "apiKey" | "client" | "fetchImpl"
  > {
  /**
   * Athena-owned product/price/relation catalog for local
   * `products.list` / `prices.list` / `relations.list`.
   * Not Mollie SDK products. Checkout stays provider-executed.
   */
  catalog?: AthenaBillingCatalogConfig;
  /**
   * Same-origin Embedded Billing HTTP path for browser/RN `createClient()`.
   * Defaults to `/api/athena/billing`. Discovery `endpoints.billing` overrides
   * when this is omitted.
   */
  endpoint?: string | null;
  /**
   * Customer importer. Disabled unless `import.customers.enabled` is true.
   * Unique-email auto-bind stays off unless `allowUniqueEmailAutoBind`.
   */
  import?: {
    customers?: {
      allowUniqueEmailAutoBind?: boolean;
      enabled?: boolean;
      execution?: "embedded" | "external";
      limits?: {
        maxCustomers?: number;
        maxDurationMs?: number;
        maxPages?: number;
        pageSize?: number;
      };
      mode?: "automatic" | "manual";
      schedule?: {
        intervalMs?: number;
        jitterMs?: number;
      };
      strategy?: "safe";
    };
  };
  ingestion?: import("./ingestion/types.ts").AthenaBillingIngestionConfig;
  /**
   * Runtime selection. `auto` uses a configured provider locally and
   * otherwise keeps `/billing/v1`. Explicit `local` never remotes.
   */
  mode?: "auto" | "local" | "remote";
  observability?: import("./observability/types.ts").AthenaBillingObservabilityConfig;
  /** Configured local provider bindings. Trusted-runtime only; never browser/RN. */
  providers?: import("./providers/types.ts").BillingProviderConfigMap;
  /**
   * Recurring `self.subscription.enroll`. Defaults to off in every environment.
   * Does not disable invoices, current subscription, cancellation, or
   * one-time `self.checkout.create`.
   * `planChange` is independent and must be explicitly true in every
   * environment to enable `self.subscription.change`.
   */
  selfEnrollment?: BillingSelfEnrollmentConfig | boolean | null;
  /**
   * Canonical environment for local provider execution.
   * Defaults to test so a live credential is never selected by accident.
   */
  testMode?: boolean;
  /** Optional override; defaults to the unified/root or db Athena URL. */
  url?: string | null;
}
