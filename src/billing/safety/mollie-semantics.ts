import type { BillingOperation } from "../runtime/capabilities.ts";
import { BILLING_OPERATION_SAFETY } from "./registry.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";

export type MollieSdkResourceName =
	| "payments"
	| "customers"
	| "refunds"
	| "paymentLinks"
	| "subscriptions"
	| "invoices"
	| "webhooks";

export interface MollieOperationSemantics {
	readonly classification: "official-sdk";
	readonly method: string;
	readonly profile: BillingOperationSafetyProfile;
	readonly resource: MollieSdkResourceName;
}

const RESOURCE_METHOD: Record<
	BillingOperation,
	{ resource: MollieSdkResourceName; method: string }
> = {
	"customers.create": { method: "create", resource: "customers" },
	"customers.delete": { method: "delete", resource: "customers" },
	"customers.get": { method: "get", resource: "customers" },
	"customers.list": { method: "list", resource: "customers" },
	"customers.update": { method: "update", resource: "customers" },
	"invoices.get": { method: "get", resource: "invoices" },
	"invoices.list": { method: "list", resource: "invoices" },
	"paymentLinks.create": { method: "create", resource: "paymentLinks" },
	"paymentLinks.delete": { method: "delete", resource: "paymentLinks" },
	"paymentLinks.get": { method: "get", resource: "paymentLinks" },
	"paymentLinks.list": { method: "list", resource: "paymentLinks" },
	"paymentLinks.update": { method: "update", resource: "paymentLinks" },
	"payments.cancel": { method: "cancel", resource: "payments" },
	"payments.create": { method: "create", resource: "payments" },
	"payments.get": { method: "get", resource: "payments" },
	"payments.list": { method: "list", resource: "payments" },
	"refunds.cancel": { method: "cancel", resource: "refunds" },
	"refunds.create": { method: "create", resource: "refunds" },
	"refunds.get": { method: "get", resource: "refunds" },
	"refunds.list": { method: "list", resource: "refunds" },
	"subscriptions.cancel": { method: "cancel", resource: "subscriptions" },
	"subscriptions.create": { method: "create", resource: "subscriptions" },
	"subscriptions.get": { method: "get", resource: "subscriptions" },
	"subscriptions.list": { method: "list", resource: "subscriptions" },
	"subscriptions.update": { method: "update", resource: "subscriptions" },
	"webhooks.create": { method: "create", resource: "webhooks" },
	"webhooks.delete": { method: "delete", resource: "webhooks" },
	"webhooks.get": { method: "get", resource: "webhooks" },
	"webhooks.list": { method: "list", resource: "webhooks" },
	"webhooks.test": { method: "test", resource: "webhooks" },
	"webhooks.update": { method: "update", resource: "webhooks" },
};

function semanticsFor(operation: BillingOperation): MollieOperationSemantics {
	const mapping = RESOURCE_METHOD[operation];
	return {
		classification: "official-sdk",
		method: mapping.method,
		profile: BILLING_OPERATION_SAFETY[operation],
		resource: mapping.resource,
	};
}

export const MOLLIE_OPERATION_SEMANTICS = {
	"customers.create": semanticsFor("customers.create"),
	"customers.delete": semanticsFor("customers.delete"),
	"customers.get": semanticsFor("customers.get"),
	"customers.list": semanticsFor("customers.list"),
	"customers.update": semanticsFor("customers.update"),
	"invoices.get": semanticsFor("invoices.get"),
	"invoices.list": semanticsFor("invoices.list"),
	"paymentLinks.create": semanticsFor("paymentLinks.create"),
	"paymentLinks.delete": semanticsFor("paymentLinks.delete"),
	"paymentLinks.get": semanticsFor("paymentLinks.get"),
	"paymentLinks.list": semanticsFor("paymentLinks.list"),
	"paymentLinks.update": semanticsFor("paymentLinks.update"),
	"payments.cancel": semanticsFor("payments.cancel"),
	"payments.create": semanticsFor("payments.create"),
	"payments.get": semanticsFor("payments.get"),
	"payments.list": semanticsFor("payments.list"),
	"refunds.cancel": semanticsFor("refunds.cancel"),
	"refunds.create": semanticsFor("refunds.create"),
	"refunds.get": semanticsFor("refunds.get"),
	"refunds.list": semanticsFor("refunds.list"),
	"subscriptions.cancel": semanticsFor("subscriptions.cancel"),
	"subscriptions.create": semanticsFor("subscriptions.create"),
	"subscriptions.get": semanticsFor("subscriptions.get"),
	"subscriptions.list": semanticsFor("subscriptions.list"),
	"subscriptions.update": semanticsFor("subscriptions.update"),
	"webhooks.create": semanticsFor("webhooks.create"),
	"webhooks.delete": semanticsFor("webhooks.delete"),
	"webhooks.get": semanticsFor("webhooks.get"),
	"webhooks.list": semanticsFor("webhooks.list"),
	"webhooks.test": semanticsFor("webhooks.test"),
	"webhooks.update": semanticsFor("webhooks.update"),
} as const satisfies Record<BillingOperation, MollieOperationSemantics>;
