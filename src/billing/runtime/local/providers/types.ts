import type {
	BillingResolvedCredential,
	BillingProviderBindingCredentials,
} from "../../credentials.ts";
import type { BillingEnvironment } from "../../environment.ts";
import type { BillingOperation } from "../../capabilities.ts";
import type { BillingPage } from "../../types.ts";
import type {
	BillingCustomer,
	BillingInvoice,
	BillingMoney,
	BillingPayment,
	BillingPaymentLink,
	BillingProviderName,
	BillingRefund,
	BillingSubscription,
} from "../../../types.ts";

export interface BillingProviderPortCapabilities {
	customers: boolean;
	invoices: boolean;
	paymentLinks: boolean;
	payments: boolean;
	refunds: boolean;
	subscriptions: boolean;
	webhooks: boolean;
}

export type BillingProviderOperationCapabilities = Partial<
	Record<BillingOperation, boolean>
>;

export interface BillingProviderCapabilities {
	operations: BillingProviderOperationCapabilities;
	ports: BillingProviderPortCapabilities;
}

export interface ConfiguredBillingProviderBinding {
	readonly kind: "configured";
	readonly provider: BillingProviderName;
	readonly credentials: BillingProviderBindingCredentials;
	readonly providerConfig: Readonly<Record<string, unknown>>;
}

export interface PersistedBillingProviderBinding {
	readonly kind: "connection";
	readonly connectionId: string;
	readonly provider: BillingProviderName;
	readonly credentials: BillingProviderBindingCredentials;
}

export type BillingProviderBinding =
	| ConfiguredBillingProviderBinding
	| PersistedBillingProviderBinding;

export interface BillingProviderCreateCustomerInput {
	email?: string | null;
	idempotencyKey: string;
	metadata?: Record<string, unknown>;
	name?: string | null;
}

export interface BillingProviderGetResourceInput {
	id: string;
}

export interface BillingProviderUpdateCustomerInput {
	email?: string | null;
	id: string;
	name?: string | null;
}

export interface BillingProviderListInput {
	cursor?: string;
	limit?: number;
}

export interface BillingProviderCreateRefundInput {
	amount: BillingMoney;
	description?: string | null;
	idempotencyKey: string;
	paymentId: string;
}

export interface BillingProviderGetRefundInput {
	paymentId: string;
	refundId: string;
}

export interface BillingProviderCreatePaymentLinkInput {
	amount: BillingMoney;
	description: string;
	idempotencyKey: string;
	redirectUrl?: string | null;
}

export interface BillingProviderUpdatePaymentLinkInput {
	description?: string | null;
	id: string;
}

export interface BillingCustomersPort {
	readonly kind: "customers";
	create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateCustomerInput,
	): Promise<BillingCustomer>;
	delete(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<void>;
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingCustomer>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingCustomer>>;
	update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdateCustomerInput,
	): Promise<BillingCustomer>;
}

export interface BillingRefundsPort {
	readonly kind: "refunds";
	cancel(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetRefundInput,
	): Promise<BillingRefund>;
	create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateRefundInput,
	): Promise<BillingRefund>;
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetRefundInput,
	): Promise<BillingRefund>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingRefund>>;
}

export interface BillingPaymentLinksPort {
	readonly kind: "payment-links";
	create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreatePaymentLinkInput,
	): Promise<BillingPaymentLink>;
	delete(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<void>;
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingPaymentLink>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingPaymentLink>>;
	update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdatePaymentLinkInput,
	): Promise<BillingPaymentLink>;
}

export interface BillingProviderCreateSubscriptionInput {
	amount: BillingMoney;
	customerId: string;
	description: string;
	idempotencyKey: string;
	interval: string;
	metadata?: Record<string, unknown>;
}

export interface BillingProviderGetSubscriptionInput {
	customerId: string;
	subscriptionId: string;
}

export interface BillingProviderUpdateSubscriptionInput {
	customerId: string;
	description?: string | null;
	subscriptionId: string;
}

export interface BillingProviderListSubscriptionsInput {
	cursor?: string;
	customerId?: string;
	limit?: number;
}

export interface BillingProviderGetInvoiceInput {
	invoiceId: string;
}

export interface BillingSubscriptionsPort {
	readonly kind: "subscriptions";
	cancel(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetSubscriptionInput,
	): Promise<BillingSubscription>;
	create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateSubscriptionInput,
	): Promise<BillingSubscription>;
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetSubscriptionInput,
	): Promise<BillingSubscription>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListSubscriptionsInput,
	): Promise<BillingPage<BillingSubscription>>;
	update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdateSubscriptionInput,
	): Promise<BillingSubscription>;
}

export interface BillingInvoicesPort {
	readonly kind: "invoices";
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetInvoiceInput,
	): Promise<BillingInvoice>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingInvoice>>;
}

export interface BillingWebhooksPort {
	readonly kind: "webhooks";
}

export interface BillingProviderRuntime {
	readonly provider: BillingProviderName;
	readonly payments?: BillingProviderPaymentPort;
	readonly customers?: BillingCustomersPort;
	readonly refunds?: BillingRefundsPort;
	readonly paymentLinks?: BillingPaymentLinksPort;
	readonly subscriptions?: BillingSubscriptionsPort;
	readonly invoices?: BillingInvoicesPort;
	readonly webhooks?: BillingWebhooksPort;
	getCapabilities(
		binding: BillingProviderBinding,
	): Promise<BillingProviderCapabilities>;
}

export interface MollieBillingProviderRuntime extends BillingProviderRuntime {
	readonly provider: "mollie";
}

export interface StripeBillingProviderRuntime extends BillingProviderRuntime {
	readonly provider: "stripe";
}

export type ResolvedBillingExecutionTarget =
	| {
			kind: "configured";
			provider: BillingProviderName;
			runtime: BillingProviderRuntime;
	  }
	| {
			kind: "connection";
			connectionId: string;
			provider?: BillingProviderName;
	  };

export interface BillingProviderExecutionTarget {
	readonly profileId?: string;
}

export interface BillingProviderExecutionContext {
	readonly provider: BillingProviderName;
	readonly environment: BillingEnvironment;
	readonly binding: BillingProviderBinding;
	readonly credential: BillingResolvedCredential;
	readonly target: BillingProviderExecutionTarget;
	readonly idempotencyKey?: string;
	readonly signal?: AbortSignal;
}

export interface BillingProviderCreatePaymentInput {
	amount: BillingMoney;
	customerId?: string | null;
	description?: string | null;
	idempotencyKey: string;
	metadata?: Record<string, unknown>;
	redirectUrl?: string | null;
}

export interface BillingProviderPaymentPort {
	cancel(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingPayment>;
	create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreatePaymentInput,
	): Promise<BillingPayment>;
	get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingPayment>;
	list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingPayment>>;
}
