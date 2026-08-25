import { AthenaBillingAuthorizationError } from "../errors.ts";
import { parseAthenaRightKey, type AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import type { BillingOperation } from "./capabilities.ts";

const PAYMENTS_READ = parseAthenaRightKey("billing.payments.read");
const PAYMENTS_WRITE = parseAthenaRightKey("billing.payments.write");
const CUSTOMERS_READ = parseAthenaRightKey("billing.customers.read");
const CUSTOMERS_WRITE = parseAthenaRightKey("billing.customers.write");
const REFUNDS_READ = parseAthenaRightKey("billing.refunds.read");
const REFUNDS_WRITE = parseAthenaRightKey("billing.refunds.write");
const SUBSCRIPTIONS_READ = parseAthenaRightKey("billing.subscriptions.read");
const SUBSCRIPTIONS_WRITE = parseAthenaRightKey("billing.subscriptions.write");
const PAYMENT_LINKS_READ = parseAthenaRightKey("billing.payment-links.read");
const PAYMENT_LINKS_WRITE = parseAthenaRightKey("billing.payment-links.write");
const SALES_INVOICES_READ = parseAthenaRightKey("billing.sales-invoices.read");
const WEBHOOKS_READ = parseAthenaRightKey("billing.webhooks.read");
const WEBHOOKS_WRITE = parseAthenaRightKey("billing.webhooks.write");

/** Process-owned overlay Rights — dialect execute keys, not grant-catalog. */
export const BILLING_DIALECT_RIGHTS: readonly AthenaRightKey[] = Object.freeze([
	PAYMENTS_READ,
	PAYMENTS_WRITE,
	CUSTOMERS_READ,
	CUSTOMERS_WRITE,
	REFUNDS_READ,
	REFUNDS_WRITE,
	SUBSCRIPTIONS_READ,
	SUBSCRIPTIONS_WRITE,
	PAYMENT_LINKS_READ,
	PAYMENT_LINKS_WRITE,
	SALES_INVOICES_READ,
	WEBHOOKS_READ,
	WEBHOOKS_WRITE,
]);

/** Process-owned local Billing caller — not an HTTP identity. */
export const PROCESS_OWNED_BILLING_PRINCIPAL: AthenaPrincipal = {
	authenticated: true,
	grants: [],
	rights: BILLING_DIALECT_RIGHTS,
	userId: "billing-overlay",
};

export const BILLING_OPERATION_RIGHTS: Record<
	BillingOperation,
	readonly AthenaRightKey[]
> = {
	"customers.create": [CUSTOMERS_WRITE],
	"customers.delete": [CUSTOMERS_WRITE],
	"customers.get": [CUSTOMERS_READ],
	"customers.list": [CUSTOMERS_READ],
	"customers.update": [CUSTOMERS_WRITE],
	"invoices.get": [SALES_INVOICES_READ],
	"invoices.list": [SALES_INVOICES_READ],
	"paymentLinks.create": [PAYMENT_LINKS_WRITE],
	"paymentLinks.delete": [PAYMENT_LINKS_WRITE],
	"paymentLinks.get": [PAYMENT_LINKS_READ],
	"paymentLinks.list": [PAYMENT_LINKS_READ],
	"paymentLinks.update": [PAYMENT_LINKS_WRITE],
	"payments.cancel": [PAYMENTS_WRITE],
	"payments.create": [PAYMENTS_WRITE],
	"payments.get": [PAYMENTS_READ],
	"payments.list": [PAYMENTS_READ],
	"refunds.cancel": [REFUNDS_WRITE],
	"refunds.create": [REFUNDS_WRITE],
	"refunds.get": [REFUNDS_READ],
	"refunds.list": [REFUNDS_READ],
	"subscriptions.cancel": [SUBSCRIPTIONS_WRITE],
	"subscriptions.create": [SUBSCRIPTIONS_WRITE],
	"subscriptions.get": [SUBSCRIPTIONS_READ],
	"subscriptions.list": [SUBSCRIPTIONS_READ],
	"subscriptions.update": [SUBSCRIPTIONS_WRITE],
	"webhooks.create": [WEBHOOKS_WRITE],
	"webhooks.delete": [WEBHOOKS_WRITE],
	"webhooks.get": [WEBHOOKS_READ],
	"webhooks.list": [WEBHOOKS_READ],
	"webhooks.test": [WEBHOOKS_WRITE],
	"webhooks.update": [WEBHOOKS_WRITE],
};

export function requiredBillingRights(
	operation: BillingOperation,
): readonly AthenaRightKey[] {
	return BILLING_OPERATION_RIGHTS[operation];
}

/**
 * Rights gate for local Billing. Grants are never consulted.
 * Returns a deny error, or undefined when the principal holds the Rights.
 */
export function authorizeBillingOperation(
	principal: AthenaPrincipal,
	operation: BillingOperation,
): AthenaBillingAuthorizationError | undefined {
	const required = requiredBillingRights(operation);
	const missing = missingRequiredRights(principal.rights, required);
	if (missing.length === 0) {
		return undefined;
	}
	return new AthenaBillingAuthorizationError({
		missing,
		operation,
	});
}
