import {
	AthenaBillingCapabilityError,
	isAthenaBillingCredentialError,
} from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type {
	BillingCancelPaymentInput,
	BillingCreateCustomerInput,
	BillingCreatePaymentInput,
	BillingCancelRefundInput,
	BillingCancelSubscriptionInput,
	BillingCreatePaymentLinkInput,
	BillingCreateRefundInput,
	BillingCreateSubscriptionInput,
	BillingDeleteCustomerInput,
	BillingDeletePaymentLinkInput,
	BillingExecutionTarget,
	BillingGetCustomerInput,
	BillingGetInvoiceInput,
	BillingGetPaymentInput,
	BillingGetPaymentLinkInput,
	BillingGetRefundInput,
	BillingGetSubscriptionInput,
	BillingListCustomersInput,
	BillingListInvoicesInput,
	BillingListPaymentLinksInput,
	BillingListPaymentsInput,
	BillingListRefundsInput,
	BillingListSubscriptionsInput,
	BillingPayment,
	BillingUpdateCustomerInput,
	BillingUpdatePaymentLinkInput,
	BillingUpdateSubscriptionInput,
} from "../../types.ts";
import type { BillingCredentialAuthority } from "../authority.ts";
import {
	decideLocalBillingOperationCapability,
	selectedModeAllowedForCapability,
} from "./capability-decision.ts";
import {
	availableBillingCredentialEnvironments,
	type BillingCredentialKind,
	resolveBillingCredential,
} from "../credentials.ts";
import { resolveBillingEnvironment } from "../environment.ts";
import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type {
	BillingCapabilities,
	BillingOperation,
	BillingOperationCapability,
	BillingPortName,
} from "../capabilities.ts";
import {
	invokeBillingRuntimePort,
	type AthenaBillingRuntimeDispatch,
} from "../dispatch.ts";
import {
	PROCESS_OWNED_BILLING_PRINCIPAL,
	authorizeBillingOperation,
} from "../rights.ts";
import type {
	BillingCustomerPort,
	BillingInvoicePort,
	BillingPage,
	BillingPaymentLinkPort,
	BillingPaymentPort,
	BillingRefundPort,
	BillingSubscriptionPort,
	BillingWebhookPort,
} from "../types.ts";
import { createConfiguredProviderBinding } from "./providers/binding.ts";
import type { BillingProviderRegistry } from "./providers/registry.ts";
import { resolveBillingExecutionTarget } from "./providers/resolve-target.ts";
import {
	executeLocalBillingCustomerCreate,
	executeLocalBillingCustomerDelete,
	executeLocalBillingCustomerGet,
	executeLocalBillingCustomerList,
	executeLocalBillingCustomerUpdate,
	executeLocalBillingInvoiceGet,
	executeLocalBillingInvoiceList,
	executeLocalBillingPaymentCancel,
	executeLocalBillingPaymentCreate,
	executeLocalBillingPaymentGet,
	executeLocalBillingPaymentList,
	executeLocalBillingPaymentLinkCreate,
	executeLocalBillingPaymentLinkDelete,
	executeLocalBillingPaymentLinkGet,
	executeLocalBillingPaymentLinkList,
	executeLocalBillingPaymentLinkUpdate,
	executeLocalBillingRefundCancel,
	executeLocalBillingRefundCreate,
	executeLocalBillingRefundGet,
	executeLocalBillingRefundList,
	executeLocalBillingSubscriptionCancel,
	executeLocalBillingSubscriptionCreate,
	executeLocalBillingSubscriptionGet,
	executeLocalBillingSubscriptionList,
	executeLocalBillingSubscriptionUpdate,
} from "./execute/index.ts";
import type { BillingProviderCapabilities } from "./providers/types.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts"; // src/billing/safety

export { prepareBillingCommand };

const BILLING_OPERATIONS: BillingOperation[] = [
	"payments.list",
	"payments.create",
	"payments.get",
	"payments.cancel",
	"customers.list",
	"customers.create",
	"customers.get",
	"customers.update",
	"customers.delete",
	"refunds.list",
	"refunds.create",
	"refunds.get",
	"refunds.cancel",
	"paymentLinks.list",
	"paymentLinks.create",
	"paymentLinks.get",
	"paymentLinks.update",
	"paymentLinks.delete",
	"subscriptions.list",
	"subscriptions.create",
	"subscriptions.get",
	"subscriptions.update",
	"subscriptions.cancel",
	"invoices.list",
	"invoices.get",
	"webhooks.list",
	"webhooks.create",
	"webhooks.get",
	"webhooks.update",
	"webhooks.delete",
	"webhooks.test",
];

function unavailable(
	operation: BillingOperation,
	reason: BillingOperationCapability["reason"] = "unsupported_operation",
): never {
	throw new AthenaBillingCapabilityError({
		operation,
		reason: reason ?? "unsupported_operation",
	});
}

function createUnsupportedPort<T extends object>(
	methods: Record<keyof T, BillingOperation>,
	principal: AthenaPrincipal,
): T {
	const port = {} as T;
	for (const [method, operation] of Object.entries(methods) as Array<
		[keyof T, BillingOperation]
	>) {
		port[method] = ((..._args: unknown[]) => {
			const denied = authorizeBillingOperation(principal, operation);
			if (denied) {
				throw denied;
			}
			return unavailable(operation);
		}) as T[keyof T];
	}
	return port;
}

function readBindingAuthority(
	binding: { providerConfig?: Readonly<Record<string, unknown>> },
): BillingCredentialAuthority | undefined {
	const raw = binding.providerConfig?.authority;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Partial<BillingCredentialAuthority>;
	if (record.source == null || record.modes == null || record.scope == null) {
		return undefined;
	}
	return {
		modes: {
			live: record.modes.live === true,
			test: record.modes.test === true,
		},
		permissions: record.permissions ?? {},
		scope: record.scope,
		source: record.source,
	};
}

function operationsFromProviderCapabilities(input: {
	anyCredentialConfigured: boolean;
	authority?: BillingCredentialAuthority;
	configuredProfileId?: string | null;
	credentialKind?: string;
	missingReason?: BillingOperationCapability["reason"];
	ports: BillingCapabilities["ports"];
	provider: string;
	providerOperations?: BillingProviderCapabilities["operations"];
	requestedProfileId?: string | null;
	selectedCredentialConfigured?: boolean;
	selectedEnvironment: "test" | "live";
}): BillingCapabilities["operations"] {
	const operations: BillingCapabilities["operations"] = {};
	const selectedModeAllowed = selectedModeAllowedForCapability({
		authority: input.authority,
		selectedCredentialConfigured:
			input.selectedCredentialConfigured ?? input.anyCredentialConfigured,
		selectedEnvironment: input.selectedEnvironment,
	});
	const providerConfig = {
		credentialKind: input.credentialKind,
		profileId: input.configuredProfileId,
	};
	for (const operation of BILLING_OPERATIONS) {
		const portName = operation.split(".")[0] as BillingPortName;
		if (input.missingReason != null) {
			operations[operation] = {
				available: false,
				reason: input.missingReason,
			};
			continue;
		}
		operations[operation] = decideLocalBillingOperationCapability({
			anyCredentialConfigured: input.anyCredentialConfigured,
			authority: input.authority,
			operation,
			portAvailable: input.ports[portName] === true,
			provider: input.provider,
			providerConfig,
			providerOperationEnabled:
				input.providerOperations?.[operation] === true,
			requestedProfileId: input.requestedProfileId,
			selectedModeAllowed,
		});
	}
	return operations;
}

export interface CreateLocalBillingRuntimeInput {
	configuredProviders?: BillingProviderConfigMap;
	principal?: AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}

export function createLocalBillingRuntime(
	input: CreateLocalBillingRuntimeInput,
): AthenaBillingRuntimeDispatch {
	const principal = input.principal ?? PROCESS_OWNED_BILLING_PRINCIPAL;
	const payments: BillingPaymentPort = {
		cancel: (payload: BillingCancelPaymentInput): Promise<BillingPayment> =>
			executeLocalBillingPaymentCancel({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		create: (payload: BillingCreatePaymentInput): Promise<BillingPayment> =>
			executeLocalBillingPaymentCreate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		get: (payload: BillingGetPaymentInput): Promise<BillingPayment> =>
			executeLocalBillingPaymentGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (
			payload: BillingListPaymentsInput,
		): Promise<BillingPage<BillingPayment>> =>
			executeLocalBillingPaymentList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};

	const customers: BillingCustomerPort = {
		create: (payload: BillingCreateCustomerInput) =>
			executeLocalBillingCustomerCreate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		delete: (payload: BillingDeleteCustomerInput) =>
			executeLocalBillingCustomerDelete({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		get: (payload: BillingGetCustomerInput) =>
			executeLocalBillingCustomerGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (payload: BillingListCustomersInput) =>
			executeLocalBillingCustomerList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		update: (payload: BillingUpdateCustomerInput) =>
			executeLocalBillingCustomerUpdate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};
	const refunds: BillingRefundPort = {
		cancel: (payload: BillingCancelRefundInput) =>
			executeLocalBillingRefundCancel({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		create: (payload: BillingCreateRefundInput) =>
			executeLocalBillingRefundCreate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		get: (payload: BillingGetRefundInput) =>
			executeLocalBillingRefundGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (payload: BillingListRefundsInput) =>
			executeLocalBillingRefundList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};
	const paymentLinks: BillingPaymentLinkPort = {
		create: (payload: BillingCreatePaymentLinkInput) =>
			executeLocalBillingPaymentLinkCreate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		delete: (payload: BillingDeletePaymentLinkInput) =>
			executeLocalBillingPaymentLinkDelete({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		get: (payload: BillingGetPaymentLinkInput) =>
			executeLocalBillingPaymentLinkGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (payload: BillingListPaymentLinksInput) =>
			executeLocalBillingPaymentLinkList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		update: (payload: BillingUpdatePaymentLinkInput) =>
			executeLocalBillingPaymentLinkUpdate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};
	const subscriptions: BillingSubscriptionPort = {
		cancel: (payload: BillingCancelSubscriptionInput) =>
			executeLocalBillingSubscriptionCancel({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		create: (payload: BillingCreateSubscriptionInput) =>
			executeLocalBillingSubscriptionCreate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		get: (payload: BillingGetSubscriptionInput) =>
			executeLocalBillingSubscriptionGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (payload: BillingListSubscriptionsInput) =>
			executeLocalBillingSubscriptionList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		update: (payload: BillingUpdateSubscriptionInput) =>
			executeLocalBillingSubscriptionUpdate({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};
	const invoices: BillingInvoicePort = {
		get: (payload: BillingGetInvoiceInput) =>
			executeLocalBillingInvoiceGet({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
		list: (payload: BillingListInvoicesInput) =>
			executeLocalBillingInvoiceList({
				configuredProviders: input.configuredProviders,
				payload,
				principal,
				registry: input.registry,
				testMode: input.testMode,
			}),
	};
	const webhooks = createUnsupportedPort<BillingWebhookPort>(
		{
			create: "webhooks.create",
			delete: "webhooks.delete",
			get: "webhooks.get",
			list: "webhooks.list",
			test: "webhooks.test",
			update: "webhooks.update",
		},
		principal,
	);

	return {
		// Shared src/billing/safety preflight is applied in execute/* create paths.
		customers,
		async execute(operation, payload, requestPrincipal) {
			const scoped = createLocalBillingRuntime({
				configuredProviders: input.configuredProviders,
				principal: requestPrincipal,
				registry: input.registry,
				testMode: input.testMode,
			});
			return invokeBillingRuntimePort(scoped, operation, payload);
		},
		invoices,
		mode: "local",
		paymentLinks,
		payments,
		refunds,
		subscriptions,
		webhooks,
		async getCapabilities(
			target: BillingExecutionTarget,
		): Promise<BillingCapabilities> {
			const resolved = resolveBillingExecutionTarget({
				configuredProviders: input.configuredProviders,
				registry: input.registry,
				target,
			});
			if (resolved.kind === "connection") {
				const emptyPorts = {
					customers: false,
					invoices: false,
					paymentLinks: false,
					payments: false,
					refunds: false,
					subscriptions: false,
					webhooks: false,
				};
				return {
					connected: false,
					connectionId: resolved.connectionId,
					operations: operationsFromProviderCapabilities({
						anyCredentialConfigured: false,
						missingReason: "missing_connection",
						ports: emptyPorts,
						provider: resolved.provider ?? "",
						selectedEnvironment: "test",
					}),
					ports: emptyPorts,
					provider: resolved.provider ?? "",
					runtime: "local",
					target: {
						connectionId: resolved.connectionId,
						kind: "connection",
						provider: resolved.provider ?? "",
					},
				};
			}
			const environment = resolveBillingEnvironment({
				testMode: input.testMode,
			});
			const binding = createConfiguredProviderBinding({
				configuredProviders: input.configuredProviders,
				provider: resolved.provider,
			});
			const providerCapabilities = await resolved.runtime.getCapabilities(
				binding,
			);
			const providerPorts = providerCapabilities.ports;
			const ports = {
				customers:
					resolved.runtime.customers != null && providerPorts.customers,
				invoices:
					resolved.runtime.invoices != null && providerPorts.invoices,
				paymentLinks:
					resolved.runtime.paymentLinks != null &&
					providerPorts.paymentLinks,
				payments:
					resolved.runtime.payments != null && providerPorts.payments,
				refunds: resolved.runtime.refunds != null && providerPorts.refunds,
				subscriptions:
					resolved.runtime.subscriptions != null &&
					providerPorts.subscriptions,
				webhooks:
					resolved.runtime.webhooks != null && providerPorts.webhooks,
			};
			const availableEnvironments =
				availableBillingCredentialEnvironments(binding.credentials);
			const authority = readBindingAuthority(binding);
			let credentialKind: BillingCredentialKind | undefined =
				typeof binding.providerConfig.credentialKind === "string"
					? (binding.providerConfig.credentialKind as BillingCredentialKind)
					: undefined;
			let credentialAvailable = false;
			try {
				const selection = resolveBillingCredential({
					provider: resolved.provider,
					testMode: environment.testMode,
					binding,
				});
				credentialKind = selection.credentialKind;
				credentialAvailable = true;
			} catch (error) {
				if (!isAthenaBillingCredentialError(error)) {
					throw error;
				}
				credentialAvailable = false;
			}
			const configuredProfileId = binding.providerConfig.profileId;
			const operations = operationsFromProviderCapabilities({
				anyCredentialConfigured: availableEnvironments.length > 0,
				authority,
				configuredProfileId:
					typeof configuredProfileId === "string" ||
					configuredProfileId === null
						? configuredProfileId
						: undefined,
				credentialKind,
				ports,
				provider: resolved.provider,
				providerOperations: providerCapabilities.operations,
				requestedProfileId: target.profileId,
				selectedCredentialConfigured:
					binding.credentials[environment.name] != null,
				selectedEnvironment: environment.name,
			});
			return {
				authority: authority == null
					? undefined
					: {
							modes: authority.modes,
							permissions: { ...authority.permissions },
							scope: authority.scope,
							source: authority.source,
						},
				connected: credentialAvailable,
				credentials: {
					availableEnvironments,
					configured: true,
					credentialKind,
					selectedEnvironment: environment.name,
				},
				environment: environment.name,
				operations,
				ports,
				provider: resolved.provider,
				runtime: "local",
				target: {
					kind: "configured",
					provider: resolved.provider,
				},
				testMode: environment.testMode,
			};
		},
	};
}
