import document from "./live-http-routes.json" with { type: "json" };

/**
 * One METHOD+path row from the billing live HTTP inventory.
 * Typed explicitly so rollup-plugin-dts does not inline the JSON into
 * `dist/billing.d.ts` (illegal ambient `var` initializers).
 */
export interface BillingLiveHttpRoute {
  method: string;
  path: string;
  surface: string;
}

/** JS mirror of `contracts/billing/live-http-routes.json`. */
export interface BillingLiveHttpRoutes {
  consumers: string[];
  description: string;
  domain: string;
  routes: BillingLiveHttpRoute[];
  schemaVersion: number;
  sourceOfTruth: string;
  sources: string[];
}

/**
 * Live Athena billing HTTP surface. Owned by athena_billing::live_http_routes
 * (Rust). Export with: cargo run -p athena-billing --bin billing-contract-spine -- --write
 */
export const billingLiveHttpRoutes: BillingLiveHttpRoutes = document;
