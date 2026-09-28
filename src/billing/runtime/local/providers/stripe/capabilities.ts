import type { BillingProviderCapabilities } from "../types.ts";

/**
 * Reserved Stripe slot. Every flag is false — local Stripe has no HTTP client
 * and no webhook signature verification. Enabling any operation here without
 * an adapter is a product defect.
 */
export const STRIPE_BILLING_PROVIDER_CAPABILITIES: BillingProviderCapabilities =
  {
    operations: {
      "checkout.create": false,
      "customers.create": false,
      "customers.delete": false,
      "customers.get": false,
      "customers.list": false,
      "customers.update": false,
      "invoices.get": false,
      "invoices.list": false,
      "paymentLinks.create": false,
      "paymentLinks.delete": false,
      "paymentLinks.get": false,
      "paymentLinks.list": false,
      "paymentLinks.update": false,
      "payments.cancel": false,
      "payments.create": false,
      "payments.get": false,
      "payments.list": false,
      "prices.list": false,
      "products.list": false,
      "relations.list": false,
      "refunds.cancel": false,
      "refunds.create": false,
      "refunds.get": false,
      "refunds.list": false,
      "subscriptions.cancel": false,
      "subscriptions.create": false,
      "subscriptions.get": false,
      "subscriptions.list": false,
      "subscriptions.update": false,
      "webhooks.create": false,
      "webhooks.delete": false,
      "webhooks.get": false,
      "webhooks.list": false,
      "webhooks.test": false,
      "webhooks.update": false,
    },
    ports: {
      checkout: false,
      customers: false,
      invoices: false,
      paymentLinks: false,
      payments: false,
      prices: false,
      products: false,
      relations: false,
      refunds: false,
      subscriptions: false,
      webhooks: false,
    },
  };
