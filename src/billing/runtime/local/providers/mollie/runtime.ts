import type {
  MollieBillingProviderConfig,
  NormalizedMollieBillingProviderConfig,
} from "../../../../providers/types.ts";
import type { NormalizedAthenaBillingCatalog } from "../../catalog/normalize.ts";
import { createAthenaBillingPricesPort } from "../../catalog/prices.ts";
import { createAthenaBillingProductsPort } from "../../catalog/products.ts";
import { createAthenaBillingRelationsPort } from "../../catalog/relations.ts";
import type {
  BillingProviderBinding,
  BillingProviderCapabilities,
  MollieBillingProviderRuntime,
} from "../types.ts";
import { MOLLIE_BILLING_PROVIDER_CAPABILITIES } from "./capabilities.ts";
import { normalizeMollieRuntimeConfig } from "./config.ts";
import { createMollieBillingCustomersPort } from "./customers.ts";
import { createMollieBillingInvoicesPort } from "./invoices.ts";
import { createMollieBillingPaymentLinksPort } from "./payment-links.ts";
import { createMollieBillingPaymentsPort } from "./payments.ts";
import { createMollieBillingRefundsPort } from "./refunds.ts";
import { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { createMollieBillingSubscriptionsPort } from "./subscriptions.ts";
import { resolveMollieWebhookManagementCapability } from "./webhook-capability.ts";
import { createMollieBillingWebhooksPort } from "./webhooks.ts";

export class MollieBillingProviderRuntimeImpl
  implements MollieBillingProviderRuntime
{
  readonly provider = "mollie" as const;
  readonly payments;
  readonly customers;
  readonly refunds;
  readonly paymentLinks;
  readonly subscriptions;
  readonly invoices;
  readonly webhooks;
  readonly products;
  readonly prices;
  readonly relations;
  readonly checkout = undefined;

  constructor(
    readonly config: NormalizedMollieBillingProviderConfig,
    catalog?: NormalizedAthenaBillingCatalog
  ) {
    const pool = new MollieSdkClientPool(config);
    this.payments = createMollieBillingPaymentsPort(config, pool);
    this.customers = createMollieBillingCustomersPort(config, pool);
    this.refunds = createMollieBillingRefundsPort(config, pool);
    this.paymentLinks = createMollieBillingPaymentLinksPort(config, pool);
    this.subscriptions = createMollieBillingSubscriptionsPort(config, pool);
    this.invoices = createMollieBillingInvoicesPort(config, pool);
    this.webhooks = createMollieBillingWebhooksPort(pool);
    this.products =
      catalog?.products == null
        ? undefined
        : createAthenaBillingProductsPort(catalog.products);
    this.prices =
      catalog?.prices == null
        ? undefined
        : createAthenaBillingPricesPort(catalog.prices);
    this.relations =
      catalog?.relations == null
        ? undefined
        : createAthenaBillingRelationsPort(catalog.relations);
  }

  async getCapabilities(
    binding: BillingProviderBinding
  ): Promise<BillingProviderCapabilities> {
    const hasProducts = this.products != null;
    const hasPrices = this.prices != null;
    const hasRelations = this.relations != null;
    const webhookCapability = resolveMollieWebhookManagementCapability(binding);
    const canListWebhooks = webhookCapability.nextGen.list === true;
    const canWriteWebhooks = webhookCapability.nextGen.write === true;
    return {
      operations: {
        ...MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations,
        "prices.list": hasPrices,
        "products.list": hasProducts,
        "relations.list": hasRelations,
        "webhooks.create": canWriteWebhooks,
        "webhooks.delete": canWriteWebhooks,
        "webhooks.get": false,
        "webhooks.list": canListWebhooks,
        "webhooks.test": false,
        "webhooks.update": canWriteWebhooks,
      },
      ports: {
        ...MOLLIE_BILLING_PROVIDER_CAPABILITIES.ports,
        prices: hasPrices,
        products: hasProducts,
        relations: hasRelations,
        webhooks: true,
      },
    };
  }
}

export function createMollieBillingProviderRuntime(
  config: MollieBillingProviderConfig | NormalizedMollieBillingProviderConfig,
  catalog?: NormalizedAthenaBillingCatalog
): MollieBillingProviderRuntime {
  return new MollieBillingProviderRuntimeImpl(
    normalizeMollieRuntimeConfig(config),
    catalog
  );
}
