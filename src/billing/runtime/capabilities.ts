import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingProviderName, BillingRuntimeMode } from "../types.ts";

export type BillingPortName =
	| "payments"
	| "customers"
	| "refunds"
	| "paymentLinks"
	| "subscriptions"
	| "invoices"
	| "webhooks";

export type BillingOperation =
	| "payments.list"
	| "payments.create"
	| "payments.get"
	| "payments.cancel"
	| "customers.list"
	| "customers.create"
	| "customers.get"
	| "customers.update"
	| "customers.delete"
	| "refunds.list"
	| "refunds.create"
	| "refunds.get"
	| "refunds.cancel"
	| "paymentLinks.list"
	| "paymentLinks.create"
	| "paymentLinks.get"
	| "paymentLinks.update"
	| "paymentLinks.delete"
	| "subscriptions.list"
	| "subscriptions.create"
	| "subscriptions.get"
	| "subscriptions.update"
	| "subscriptions.cancel"
	| "invoices.list"
	| "invoices.get"
	| "webhooks.list"
	| "webhooks.create"
	| "webhooks.get"
	| "webhooks.update"
	| "webhooks.delete"
	| "webhooks.test";

export type BillingOperationCapabilityReason =
	| "unsupported_provider"
	| "unsupported_operation"
	| "missing_connection"
	| "missing_permission"
	| "missing_provider_scope"
	| "runtime_unavailable"
	| "missing_credential";

export interface BillingOperationCapability {
	available: boolean;
	reason?: BillingOperationCapabilityReason;
}

export interface BillingCapabilityTarget {
	connectionId?: string;
	kind: "configured" | "connection";
	provider: BillingProviderName;
}

export interface BillingCapabilities {
	/**
	 * True when the selected credential can be resolved for this target.
	 * Configured providers do not perform a network handshake; this is not
	 * "Athena has an established provider connection."
	 */
	connected: boolean;
	connectionId?: string;
	target: BillingCapabilityTarget;
	testMode?: boolean;
	environment?: "test" | "live";
	credentials?: {
		configured: boolean;
		selectedEnvironment?: "test" | "live";
		availableEnvironments?: Array<"test" | "live">;
		credentialKind?: string;
	};
	authority?: {
		source: "derived" | "declared" | "provider";
		modes: {
			test: boolean;
			live: boolean;
		};
		scope?: {
			kind: "organization" | "profile";
			profileId?: string;
		};
		permissions?: Record<string, boolean>;
	};
	operations: Partial<Record<BillingOperation, BillingOperationCapability>>;
	ports: {
		customers: boolean;
		invoices: boolean;
		paymentLinks: boolean;
		payments: boolean;
		refunds: boolean;
		subscriptions: boolean;
		webhooks: boolean;
	};
	provider: string;
	runtime: BillingRuntimeMode;
}

/**
 * Fail-closed: a method existing on AthenaBillingModule does not mean the
 * resolved runtime/provider supports it. Never route an unsupported local
 * operation to remote HTTP.
 */
export function assertBillingOperationAvailable(
	capabilities: BillingCapabilities,
	operation: BillingOperation,
): void {
	const capability = capabilities.operations[operation];
	if (capability?.available === true) {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation,
		reason: capability?.reason ?? "unsupported_operation",
	});
}
