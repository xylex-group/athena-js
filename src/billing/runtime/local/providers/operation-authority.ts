import type { BillingOperation } from "../../capabilities.ts";

export interface MollieOperationAuthority {
	permissions: readonly string[];
}

export const MOLLIE_OPERATION_AUTHORITY = {
	"customers.create": { permissions: ["customers.write"] },
	"customers.delete": { permissions: ["customers.write"] },
	"customers.get": { permissions: ["customers.read"] },
	"customers.list": { permissions: ["customers.read"] },
	"customers.update": { permissions: ["customers.write"] },
	"invoices.get": { permissions: ["sales-invoices.read"] },
	"invoices.list": { permissions: ["sales-invoices.read"] },
	"paymentLinks.create": { permissions: ["payment-links.write"] },
	"paymentLinks.delete": { permissions: ["payment-links.write"] },
	"paymentLinks.get": { permissions: ["payment-links.read"] },
	"paymentLinks.list": { permissions: ["payment-links.read"] },
	"paymentLinks.update": { permissions: ["payment-links.write"] },
	"payments.cancel": { permissions: ["payments.write"] },
	"payments.create": { permissions: ["payments.write"] },
	"payments.get": { permissions: ["payments.read"] },
	"payments.list": { permissions: ["payments.read"] },
	"refunds.cancel": { permissions: ["refunds.write"] },
	"refunds.create": { permissions: ["refunds.write"] },
	"refunds.get": { permissions: ["refunds.read"] },
	"refunds.list": { permissions: ["refunds.read"] },
	"subscriptions.cancel": { permissions: ["subscriptions.write"] },
	"subscriptions.create": { permissions: ["subscriptions.write"] },
	"subscriptions.get": { permissions: ["subscriptions.read"] },
	"subscriptions.list": { permissions: ["subscriptions.read"] },
	"subscriptions.update": { permissions: ["subscriptions.write"] },
	"webhooks.create": { permissions: ["webhooks.write"] },
	"webhooks.delete": { permissions: ["webhooks.write"] },
	"webhooks.get": { permissions: ["webhooks.read"] },
	"webhooks.list": { permissions: ["webhooks.read"] },
	"webhooks.test": { permissions: ["webhooks.write"] },
	"webhooks.update": { permissions: ["webhooks.write"] },
} satisfies Record<BillingOperation, MollieOperationAuthority>;

export function requiredMolliePermissionsFor(
	operation: BillingOperation,
): readonly string[] {
	return MOLLIE_OPERATION_AUTHORITY[operation].permissions;
}
