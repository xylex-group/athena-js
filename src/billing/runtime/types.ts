import type {
	BillingCancelPaymentInput,
	BillingCancelRefundInput,
	BillingCancelSubscriptionInput,
	BillingConnectionRef,
	BillingCreateCustomerInput,
	BillingCreatePaymentInput,
	BillingCreatePaymentLinkInput,
	BillingCreateRefundInput,
	BillingCreateSubscriptionInput,
	BillingCreateWebhookInput,
	BillingCustomer,
	BillingDeleteCustomerInput,
	BillingDeletePaymentLinkInput,
	BillingDeleteWebhookInput,
	BillingExecutionTarget,
	BillingGetCustomerInput,
	BillingGetInvoiceInput,
	BillingGetPaymentInput,
	BillingGetPaymentLinkInput,
	BillingGetRefundInput,
	BillingGetSubscriptionInput,
	BillingGetWebhookInput,
	BillingInvoice,
	BillingListCustomersInput,
	BillingListInvoicesInput,
	BillingListPaymentLinksInput,
	BillingListPaymentsInput,
	BillingListRefundsInput,
	BillingListSubscriptionsInput,
	BillingListWebhooksInput,
	BillingPayment,
	BillingPaymentLink,
	BillingRefund,
	BillingRuntimeMode,
	BillingSubscription,
	BillingTestWebhookInput,
	BillingUpdateCustomerInput,
	BillingUpdatePaymentLinkInput,
	BillingUpdateSubscriptionInput,
	BillingUpdateWebhookInput,
	BillingWebhook,
} from "../types.ts";
import type { BillingCapabilities, BillingOperation } from "./capabilities.ts";

export type { BillingConnectionRef };

export interface BillingPage<T> {
	items: T[];
	nextCursor?: string | null;
	previousCursor?: string | null;
}

export interface BillingPaymentPort {
	cancel(input: BillingCancelPaymentInput): Promise<BillingPayment>;
	create(input: BillingCreatePaymentInput): Promise<BillingPayment>;
	get(input: BillingGetPaymentInput): Promise<BillingPayment>;
	list(input: BillingListPaymentsInput): Promise<BillingPage<BillingPayment>>;
}

export interface BillingCustomerPort {
	create(input: BillingCreateCustomerInput): Promise<BillingCustomer>;
	delete(input: BillingDeleteCustomerInput): Promise<void>;
	get(input: BillingGetCustomerInput): Promise<BillingCustomer>;
	list(input: BillingListCustomersInput): Promise<BillingPage<BillingCustomer>>;
	update(input: BillingUpdateCustomerInput): Promise<BillingCustomer>;
}

export interface BillingRefundPort {
	cancel(input: BillingCancelRefundInput): Promise<BillingRefund>;
	create(input: BillingCreateRefundInput): Promise<BillingRefund>;
	get(input: BillingGetRefundInput): Promise<BillingRefund>;
	list(input: BillingListRefundsInput): Promise<BillingPage<BillingRefund>>;
}

export interface BillingPaymentLinkPort {
	create(input: BillingCreatePaymentLinkInput): Promise<BillingPaymentLink>;
	delete(input: BillingDeletePaymentLinkInput): Promise<void>;
	get(input: BillingGetPaymentLinkInput): Promise<BillingPaymentLink>;
	list(
		input: BillingListPaymentLinksInput,
	): Promise<BillingPage<BillingPaymentLink>>;
	update(input: BillingUpdatePaymentLinkInput): Promise<BillingPaymentLink>;
}

export interface BillingSubscriptionPort {
	cancel(input: BillingCancelSubscriptionInput): Promise<BillingSubscription>;
	create(input: BillingCreateSubscriptionInput): Promise<BillingSubscription>;
	get(input: BillingGetSubscriptionInput): Promise<BillingSubscription>;
	list(
		input: BillingListSubscriptionsInput,
	): Promise<BillingPage<BillingSubscription>>;
	update(input: BillingUpdateSubscriptionInput): Promise<BillingSubscription>;
}

export interface BillingInvoicePort {
	get(input: BillingGetInvoiceInput): Promise<BillingInvoice>;
	list(input: BillingListInvoicesInput): Promise<BillingPage<BillingInvoice>>;
}

export interface BillingWebhookPort {
	create(input: BillingCreateWebhookInput): Promise<BillingWebhook>;
	delete(input: BillingDeleteWebhookInput): Promise<void>;
	get(input: BillingGetWebhookInput): Promise<BillingWebhook>;
	list(input: BillingListWebhooksInput): Promise<BillingPage<BillingWebhook>>;
	test(input: BillingTestWebhookInput): Promise<BillingWebhook>;
	update(input: BillingUpdateWebhookInput): Promise<BillingWebhook>;
}

export type BillingRuntimeDispatchOperation =
	| BillingOperation
	| "getCapabilities";

export interface AthenaBillingRuntime {
	readonly customers: BillingCustomerPort;
	readonly invoices: BillingInvoicePort;
	readonly mode: BillingRuntimeMode;
	readonly paymentLinks: BillingPaymentLinkPort;
	readonly payments: BillingPaymentPort;
	readonly refunds: BillingRefundPort;
	readonly subscriptions: BillingSubscriptionPort;
	readonly webhooks: BillingWebhookPort;

	getCapabilities(input: BillingExecutionTarget): Promise<BillingCapabilities>;
}
