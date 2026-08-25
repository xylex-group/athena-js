import type {
	BillingCapabilities,
	BillingOperation,
	BillingOperationCapability,
	BillingOperationCapabilityReason,
	BillingPortName,
} from "../capabilities.ts";

const PORTS: readonly BillingPortName[] = [
	"payments",
	"customers",
	"refunds",
	"paymentLinks",
	"subscriptions",
	"invoices",
	"webhooks",
];

const SNAKE_TO_OPERATION: Record<string, BillingOperation> = {
	cancel_payment: "payments.cancel",
	cancel_refund: "refunds.cancel",
	cancel_subscription: "subscriptions.cancel",
	create_customer: "customers.create",
	create_payment: "payments.create",
	create_payment_link: "paymentLinks.create",
	create_refund: "refunds.create",
	create_subscription: "subscriptions.create",
	create_webhook: "webhooks.create",
	delete_customer: "customers.delete",
	delete_payment_link: "paymentLinks.delete",
	delete_webhook: "webhooks.delete",
	get_customer: "customers.get",
	get_invoice: "invoices.get",
	get_payment: "payments.get",
	get_payment_link: "paymentLinks.get",
	get_refund: "refunds.get",
	get_subscription: "subscriptions.get",
	get_webhook: "webhooks.get",
	list_customers: "customers.list",
	list_invoices: "invoices.list",
	list_payment_links: "paymentLinks.list",
	list_payments: "payments.list",
	list_refunds: "refunds.list",
	list_subscriptions: "subscriptions.list",
	list_webhooks: "webhooks.list",
	test_webhook: "webhooks.test",
	update_customer: "customers.update",
	update_payment_link: "paymentLinks.update",
	update_subscription: "subscriptions.update",
	update_webhook: "webhooks.update",
};

const KEY_TO_OPERATION: Record<string, BillingOperation> = {
	"billing.customers.create": "customers.create",
	"billing.customers.delete": "customers.delete",
	"billing.customers.get": "customers.get",
	"billing.customers.list": "customers.list",
	"billing.customers.update": "customers.update",
	"billing.invoices.get": "invoices.get",
	"billing.invoices.list": "invoices.list",
	"billing.payment_links.create": "paymentLinks.create",
	"billing.payment_links.delete": "paymentLinks.delete",
	"billing.payment_links.get": "paymentLinks.get",
	"billing.payment_links.list": "paymentLinks.list",
	"billing.payment_links.update": "paymentLinks.update",
	"billing.payments.cancel": "payments.cancel",
	"billing.payments.create": "payments.create",
	"billing.payments.get": "payments.get",
	"billing.payments.list": "payments.list",
	"billing.refunds.cancel": "refunds.cancel",
	"billing.refunds.create": "refunds.create",
	"billing.refunds.get": "refunds.get",
	"billing.refunds.list": "refunds.list",
	"billing.subscriptions.cancel": "subscriptions.cancel",
	"billing.subscriptions.create": "subscriptions.create",
	"billing.subscriptions.get": "subscriptions.get",
	"billing.subscriptions.list": "subscriptions.list",
	"billing.subscriptions.update": "subscriptions.update",
	"billing.webhooks.create": "webhooks.create",
	"billing.webhooks.delete": "webhooks.delete",
	"billing.webhooks.get": "webhooks.get",
	"billing.webhooks.list": "webhooks.list",
	"billing.webhooks.test": "webhooks.test",
	"billing.webhooks.update": "webhooks.update",
};

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((entry): entry is string => typeof entry === "string");
}

function resolveOperation(entry: Record<string, unknown>): BillingOperation | undefined {
	const operation = asString(entry.operation);
	if (operation && operation in SNAKE_TO_OPERATION) {
		return SNAKE_TO_OPERATION[operation];
	}
	if (operation && operation in KEY_TO_OPERATION) {
		return KEY_TO_OPERATION[operation];
	}
	if (
		operation &&
		(operation.startsWith("payments.") ||
			operation.startsWith("customers.") ||
			operation.startsWith("refunds.") ||
			operation.startsWith("paymentLinks.") ||
			operation.startsWith("subscriptions.") ||
			operation.startsWith("invoices.") ||
			operation.startsWith("webhooks."))
	) {
		return operation as BillingOperation;
	}
	const key = asString(entry.key);
	if (key && key in KEY_TO_OPERATION) {
		return KEY_TO_OPERATION[key];
	}
	return undefined;
}

function denialReason(entry: Record<string, unknown>): BillingOperationCapabilityReason {
	if (asStringList(entry.missingAthenaRights).length > 0) {
		return "missing_permission";
	}
	if (asStringList(entry.missingProviderRequirements).length > 0) {
		return "missing_provider_scope";
	}
	if (entry.portAvailable === false) {
		return "unsupported_operation";
	}
	return "unsupported_operation";
}

function projectPorts(raw: unknown): BillingCapabilities["ports"] {
	const record = asRecord(raw);
	const ports = {} as BillingCapabilities["ports"];
	for (const name of PORTS) {
		ports[name] = record[name] === true;
	}
	return ports;
}

/**
 * Project GET /billing/v1/capabilities onto BillingCapabilities.
 * Never synthesize all-available; missing operations stay fail-closed.
 */
export function projectRemoteBillingCapabilities(
	data: unknown,
	connectionId: string,
): BillingCapabilities {
	const envelope = asRecord(data);
	const nested = asRecord(envelope.capabilities);
	const status = asString(nested.status);
	const connected =
		nested.connected === true || status === "active";
	const operations: Partial<
		Record<BillingOperation, BillingOperationCapability>
	> = {};
	const actions = Array.isArray(envelope.actionCapabilities)
		? envelope.actionCapabilities
		: [];
	for (const raw of actions) {
		const entry = asRecord(raw);
		const operation = resolveOperation(entry);
		if (!operation) {
			continue;
		}
		if (entry.available === true) {
			operations[operation] = { available: true };
			continue;
		}
		operations[operation] = {
			available: false,
			reason: denialReason(entry),
		};
	}
	const provider =
		asString(nested.provider) ?? asString(envelope.provider) ?? "remote";
	return {
		connected,
		connectionId,
		operations,
		ports: projectPorts(envelope.ports),
		provider,
		runtime: "remote",
		target: {
			connectionId,
			kind: "connection",
			provider,
		},
	};
}
