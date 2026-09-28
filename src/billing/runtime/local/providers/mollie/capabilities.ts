import type { BillingProviderCapabilities } from "../types.ts";

/**
 * Native Mollie SDK surface. Athena catalog `products` / `prices` overlay
 * `getCapabilities` on the Mollie runtime when `billing.catalog` is configured.
 * Do not set these static flags true — that would claim Mollie-native catalog.
 */
export const MOLLIE_BILLING_PROVIDER_CAPABILITIES: BillingProviderCapabilities =
  {
    operations: {
      "checkout.create": false,
      "customers.create": true,
      "customers.delete": true,
      "customers.get": true,
      "customers.list": true,
      "customers.update": true,
      "invoices.get": true,
      "invoices.list": true,
      "paymentLinks.create": true,
      "paymentLinks.delete": true,
      "paymentLinks.get": true,
      "paymentLinks.list": true,
      "paymentLinks.update": true,
      "payments.cancel": true,
      "payments.create": true,
      "payments.get": true,
      "payments.list": true,
      "prices.list": false,
      "products.list": false,
      "relations.list": false,
      "refunds.cancel": true,
      "refunds.create": true,
      "refunds.get": true,
      "refunds.list": true,
      "subscriptions.cancel": true,
      "subscriptions.create": true,
      "subscriptions.get": true,
      "subscriptions.list": true,
      "subscriptions.update": true,
      "webhooks.create": true,
      "webhooks.delete": true,
      "webhooks.get": false,
      "webhooks.list": true,
      "webhooks.test": false,
      "webhooks.update": true,
    },
    ports: {
      checkout: false,
      customers: true,
      invoices: true,
      paymentLinks: true,
      payments: true,
      prices: false,
      products: false,
      relations: false,
      refunds: true,
      subscriptions: true,
      webhooks: true,
    },
  };
