import type { BillingProviderCapabilities } from "../types.ts";
import type {
	MollieBillingProviderConfig,
	NormalizedMollieBillingProviderConfig,
} from "../../../../providers/types.ts";
import type {
	BillingProviderBinding,
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
	readonly webhooks = undefined;

	constructor(
		readonly config: NormalizedMollieBillingProviderConfig,
	) {
		const pool = new MollieSdkClientPool(config);
		this.payments = createMollieBillingPaymentsPort(config, pool);
		this.customers = createMollieBillingCustomersPort(config, pool);
		this.refunds = createMollieBillingRefundsPort(config, pool);
		this.paymentLinks = createMollieBillingPaymentLinksPort(config, pool);
		this.subscriptions = createMollieBillingSubscriptionsPort(config, pool);
		this.invoices = createMollieBillingInvoicesPort(config, pool);
	}

	async getCapabilities(
		_binding: BillingProviderBinding,
	): Promise<BillingProviderCapabilities> {
		return MOLLIE_BILLING_PROVIDER_CAPABILITIES;
	}
}

export function createMollieBillingProviderRuntime(
	config: MollieBillingProviderConfig | NormalizedMollieBillingProviderConfig,
): MollieBillingProviderRuntime {
	return new MollieBillingProviderRuntimeImpl(
		normalizeMollieRuntimeConfig(config),
	);
}
