import type {
	BillingCancelPaymentInput,
	BillingCancelRefundInput,
	BillingCancelSubscriptionInput,
	BillingCreateCustomerInput,
	BillingExecutionTarget,
	BillingCreatePaymentInput,
	BillingCreatePaymentLinkInput,
	BillingCreateRefundInput,
	BillingCreateSubscriptionInput,
	BillingCreateWebhookInput,
	BillingCustomer,
	BillingDeleteCustomerInput,
	BillingDeletePaymentLinkInput,
	BillingDeleteWebhookInput,
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
	BillingSubscription,
	BillingTestWebhookInput,
	BillingUpdateCustomerInput,
	BillingUpdatePaymentLinkInput,
	BillingUpdateSubscriptionInput,
	BillingUpdateWebhookInput,
	BillingWebhook,
} from "../../types.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts"; // src/billing/safety
import { invokeBillingRuntimePort } from "../dispatch.ts";
import type { AthenaBillingRuntimeDispatch } from "../dispatch.ts";
import type { BillingPage } from "../types.ts";
import type { BillingCapabilities } from "../capabilities.ts";
import { projectRemoteBillingCapabilities } from "./project-capabilities.ts";
import {
	type AthenaBillingClientConfig,
	appendQuery,
	createBillingHttpTransport,
	withPathParam,
} from "./transport.ts";

/**
 * GET /billing/v1/payments honors cursor (provider) or a hardcoded
 * persistence page (limit 50, offset 0). Remote callers must not
 * pretend limit/offset were applied.
 */
export function rejectUnsupportedRemotePaymentListPaging(input: {
	limit?: number;
	offset?: number;
}): void {
	if (input.offset == null && input.limit == null) {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation: "payments.list",
		reason: "unsupported_operation",
	});
}

/**
 * Remote /billing/v1 ConnectionQuery has no profileId. Adapters use the
 * connection's stored provider_profile_id, so a requested profile must
 * fail closed instead of silently targeting another profile.
 */
export function rejectUnenforcedRemoteProfileTarget(
	input: { profileId?: string | null },
	operation: string,
): void {
	if (input.profileId == null || input.profileId === "") {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation,
		reason: "unsupported_operation",
	});
}

/**
 * Remote /billing/v1 ConnectionQuery requires connection_id. Local
 * getCapabilities may target a configured provider without one.
 */
export function rejectMissingRemoteConnectionId(
	input: { connectionId?: string | null },
	operation: string,
): void {
	if (input.connectionId != null && input.connectionId !== "") {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation,
		reason: "missing_connection",
	});
}

function connectionQuery(
	input: BillingExecutionTarget & {
		cursor?: string;
		customerId?: string;
		limit?: number;
		offset?: number;
		paymentId?: string;
		source?: string;
	},
): Record<string, string> {
	const query: Record<string, string> = {};
	if (input.connectionId) {
		query.connectionId = input.connectionId;
	}
	if (input.clientName) {
		query.clientName = input.clientName;
	}
	if (input.cursor) {
		query.cursor = input.cursor;
	}
	if (input.customerId) {
		query.customerId = input.customerId;
	}
	if (input.paymentId) {
		query.paymentId = input.paymentId;
	}
	if (input.source) {
		query.source = input.source;
	}
	if (input.limit !== undefined) {
		query.limit = String(input.limit);
	}
	if (input.offset !== undefined) {
		query.offset = String(input.offset);
	}
	return query;
}

function asPage<T>(data: unknown): BillingPage<T> {
	if (Array.isArray(data)) {
		return { items: data as T[] };
	}
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		if (Array.isArray(record.items)) {
			return {
				items: record.items as T[],
				nextCursor: (record.nextCursor as string | null | undefined) ?? null,
				previousCursor:
					(record.previousCursor as string | null | undefined) ?? null,
			};
		}
	}
	return { items: [] };
}

/**
 * HTTP implementation of AthenaBillingRuntime. Does not change the public
 * createBillingModule method bag; that façade still maps 1:1 to /billing/v1.
 */
export function createRemoteBillingRuntime(
	config: AthenaBillingClientConfig,
): AthenaBillingRuntimeDispatch {
	const { call } = createBillingHttpTransport(config);

	return {
		mode: "remote",
		execute(operation, payload, _principal) {
			return invokeBillingRuntimePort(this, operation, payload);
		},
		customers: {
			create(input: BillingCreateCustomerInput): Promise<BillingCustomer> {
				const prepared = prepareBillingCommand({
					operation: "customers.create",
					payload: input,
				});
				return call("POST", "/billing/v1/customers", prepared.payload);
			},
			delete(input: BillingDeleteCustomerInput): Promise<void> {
				return call(
					"DELETE",
					appendQuery(
						withPathParam("/billing/v1/customers/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			get(input: BillingGetCustomerInput): Promise<BillingCustomer> {
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/customers/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListCustomersInput,
			): Promise<BillingPage<BillingCustomer>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/customers", connectionQuery(input)),
					),
				);
			},
			update(input: BillingUpdateCustomerInput): Promise<BillingCustomer> {
				return call(
					"PATCH",
					withPathParam("/billing/v1/customers/{id}", "id", input.id),
					input,
				);
			},
		},
		invoices: {
			get(input: BillingGetInvoiceInput): Promise<BillingInvoice> {
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/invoices/{id}", "id", input.invoiceId),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListInvoicesInput,
			): Promise<BillingPage<BillingInvoice>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/invoices", connectionQuery(input)),
					),
				);
			},
		},
		paymentLinks: {
			create(input: BillingCreatePaymentLinkInput): Promise<BillingPaymentLink> {
				const prepared = prepareBillingCommand({
					operation: "paymentLinks.create",
					payload: input,
				});
				return call("POST", "/billing/v1/payment-links", prepared.payload);
			},
			delete(input: BillingDeletePaymentLinkInput): Promise<void> {
				return call(
					"DELETE",
					appendQuery(
						withPathParam("/billing/v1/payment-links/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			get(input: BillingGetPaymentLinkInput): Promise<BillingPaymentLink> {
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/payment-links/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListPaymentLinksInput,
			): Promise<BillingPage<BillingPaymentLink>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/payment-links", connectionQuery(input)),
					),
				);
			},
			update(input: BillingUpdatePaymentLinkInput): Promise<BillingPaymentLink> {
				return call(
					"PATCH",
					withPathParam("/billing/v1/payment-links/{id}", "id", input.id),
					input,
				);
			},
		},
		payments: {
			cancel(input: BillingCancelPaymentInput): Promise<BillingPayment> {
				rejectUnenforcedRemoteProfileTarget(input, "payments.cancel");
				return call(
					"POST",
					appendQuery(
						withPathParam("/billing/v1/payments/{id}/cancel", "id", input.id),
						connectionQuery(input),
					),
					{},
				);
			},
			create(input: BillingCreatePaymentInput): Promise<BillingPayment> {
				rejectUnenforcedRemoteProfileTarget(input, "payments.create");
				const prepared = prepareBillingCommand({
					operation: "payments.create",
					payload: input,
				});
				return call("POST", "/billing/v1/payments", prepared.payload);
			},
			get(input: BillingGetPaymentInput): Promise<BillingPayment> {
				rejectUnenforcedRemoteProfileTarget(input, "payments.get");
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/payments/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListPaymentsInput,
			): Promise<BillingPage<BillingPayment>> {
				rejectUnsupportedRemotePaymentListPaging(input);
				rejectUnenforcedRemoteProfileTarget(input, "payments.list");
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/payments", connectionQuery(input)),
					),
				);
			},
		},
		refunds: {
			cancel(input: BillingCancelRefundInput): Promise<BillingRefund> {
				return call(
					"POST",
					appendQuery(
						withPathParam(
							"/billing/v1/refunds/{id}/cancel",
							"id",
							input.refundId,
						),
						connectionQuery(input),
					),
					{},
				);
			},
			create(input: BillingCreateRefundInput): Promise<BillingRefund> {
				const prepared = prepareBillingCommand({
					operation: "refunds.create",
					payload: input,
				});
				return call("POST", "/billing/v1/refunds", prepared.payload);
			},
			get(input: BillingGetRefundInput): Promise<BillingRefund> {
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/refunds/{id}", "id", input.refundId),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListRefundsInput,
			): Promise<BillingPage<BillingRefund>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/refunds", connectionQuery(input)),
					),
				);
			},
		},
		subscriptions: {
			cancel(
				input: BillingCancelSubscriptionInput,
			): Promise<BillingSubscription> {
				return call(
					"POST",
					appendQuery(
						withPathParam(
							"/billing/v1/subscriptions/{id}/cancel",
							"id",
							input.subscriptionId,
						),
						connectionQuery(input),
					),
					{},
				);
			},
			create(
				input: BillingCreateSubscriptionInput,
			): Promise<BillingSubscription> {
				const prepared = prepareBillingCommand({
					operation: "subscriptions.create",
					payload: input,
				});
				return call("POST", "/billing/v1/subscriptions", prepared.payload);
			},
			get(input: BillingGetSubscriptionInput): Promise<BillingSubscription> {
				return call(
					"GET",
					appendQuery(
						withPathParam(
							"/billing/v1/subscriptions/{id}",
							"id",
							input.subscriptionId,
						),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListSubscriptionsInput,
			): Promise<BillingPage<BillingSubscription>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/subscriptions", connectionQuery(input)),
					),
				);
			},
			update(
				input: BillingUpdateSubscriptionInput,
			): Promise<BillingSubscription> {
				return call(
					"PATCH",
					appendQuery(
						withPathParam(
							"/billing/v1/subscriptions/{id}",
							"id",
							input.subscriptionId,
						),
						connectionQuery(input),
					),
					input,
				);
			},
		},
		webhooks: {
			create(input: BillingCreateWebhookInput): Promise<BillingWebhook> {
				return call(
					"POST",
					appendQuery("/billing/v1/webhooks", connectionQuery(input)),
					input,
				);
			},
			delete(input: BillingDeleteWebhookInput): Promise<void> {
				return call(
					"DELETE",
					appendQuery(
						withPathParam("/billing/v1/webhooks/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			get(input: BillingGetWebhookInput): Promise<BillingWebhook> {
				return call(
					"GET",
					appendQuery(
						withPathParam("/billing/v1/webhooks/{id}", "id", input.id),
						connectionQuery(input),
					),
				);
			},
			async list(
				input: BillingListWebhooksInput,
			): Promise<BillingPage<BillingWebhook>> {
				return asPage(
					await call(
						"GET",
						appendQuery("/billing/v1/webhooks", connectionQuery(input)),
					),
				);
			},
			test(input: BillingTestWebhookInput): Promise<BillingWebhook> {
				return call(
					"POST",
					appendQuery(
						withPathParam("/billing/v1/webhooks/{id}/test", "id", input.id),
						connectionQuery(input),
					),
					{},
				);
			},
			update(input: BillingUpdateWebhookInput): Promise<BillingWebhook> {
				return call(
					"PATCH",
					appendQuery(
						withPathParam("/billing/v1/webhooks/{id}", "id", input.id),
						connectionQuery(input),
					),
					input,
				);
			},
		},
		async getCapabilities(
			input: BillingExecutionTarget,
		): Promise<BillingCapabilities> {
			rejectMissingRemoteConnectionId(input, "getCapabilities");
			const query = connectionQuery(input);
			if (input.profileId) {
				query.profileId = input.profileId;
			}
			const data = await call(
				"GET",
				appendQuery("/billing/v1/capabilities", query),
			);
			return projectRemoteBillingCapabilities(
				data,
				input.connectionId ?? "",
			);
		},
	};
}
