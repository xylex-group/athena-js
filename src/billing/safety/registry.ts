import type { BillingOperation } from "../runtime/capabilities.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";

function row(
	operation: BillingOperation,
	mutationClass: BillingOperationSafetyProfile["mutationClass"],
	idempotency: BillingOperationSafetyProfile["idempotency"],
	replayGuarantee: BillingOperationSafetyProfile["replayGuarantee"],
	money: BillingOperationSafetyProfile["money"],
	authorityMode: BillingOperationSafetyProfile["authorityMode"],
): BillingOperationSafetyProfile {
	return {
		authorityMode,
		idempotency,
		money,
		mutationClass,
		operation,
		preflightIsConcurrencyGuarantee: false,
		replayGuarantee,
	};
}

const readTrust = (
	operation: BillingOperation,
): BillingOperationSafetyProfile =>
	row(operation, "read", "not_applicable", "none", "not_applicable", "provider-trust");

const financialCreate = (
	operation: BillingOperation,
	money: BillingOperationSafetyProfile["money"],
): BillingOperationSafetyProfile =>
	row(
		operation,
		"financial_create",
		"required_caller_owned",
		"provider_same_key",
		money,
		"declared-required",
	);

const financialCancel = (
	operation: BillingOperation,
): BillingOperationSafetyProfile =>
	row(
		operation,
		"financial_cancel",
		"not_applicable",
		"none",
		"not_applicable",
		"declared-required",
	);

const nonFinancialWrite = (
	operation: BillingOperation,
): BillingOperationSafetyProfile =>
	row(
		operation,
		"non_financial_write",
		"not_applicable",
		"none",
		"not_applicable",
		"declared-required",
	);

export const BILLING_OPERATION_SAFETY = {
	"customers.create": financialCreate("customers.create", "not_applicable"),
	"customers.delete": nonFinancialWrite("customers.delete"),
	"customers.get": readTrust("customers.get"),
	"customers.list": readTrust("customers.list"),
	"customers.update": nonFinancialWrite("customers.update"),
	"invoices.get": readTrust("invoices.get"),
	"invoices.list": readTrust("invoices.list"),
	"paymentLinks.create": financialCreate("paymentLinks.create", "required"),
	"paymentLinks.delete": nonFinancialWrite("paymentLinks.delete"),
	"paymentLinks.get": readTrust("paymentLinks.get"),
	"paymentLinks.list": readTrust("paymentLinks.list"),
	"paymentLinks.update": nonFinancialWrite("paymentLinks.update"),
	"payments.cancel": financialCancel("payments.cancel"),
	"payments.create": financialCreate("payments.create", "required"),
	"payments.get": readTrust("payments.get"),
	"payments.list": readTrust("payments.list"),
	"refunds.cancel": financialCancel("refunds.cancel"),
	"refunds.create": financialCreate("refunds.create", "required"),
	"refunds.get": readTrust("refunds.get"),
	"refunds.list": readTrust("refunds.list"),
	"subscriptions.cancel": financialCancel("subscriptions.cancel"),
	"subscriptions.create": financialCreate("subscriptions.create", "required"),
	"subscriptions.get": readTrust("subscriptions.get"),
	"subscriptions.list": readTrust("subscriptions.list"),
	"subscriptions.update": nonFinancialWrite("subscriptions.update"),
	"webhooks.create": nonFinancialWrite("webhooks.create"),
	"webhooks.delete": nonFinancialWrite("webhooks.delete"),
	"webhooks.get": readTrust("webhooks.get"),
	"webhooks.list": readTrust("webhooks.list"),
	"webhooks.test": nonFinancialWrite("webhooks.test"),
	"webhooks.update": nonFinancialWrite("webhooks.update"),
} as const satisfies Record<BillingOperation, BillingOperationSafetyProfile>;
