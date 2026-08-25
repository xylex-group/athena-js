import { AthenaBillingCapabilityError } from "../../../errors.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingExecutionTarget } from "../../../types.ts";
import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingCredentialAuthority } from "../../authority.ts";
import type { BillingOperation, BillingPortName } from "../../capabilities.ts";
import {
	PROCESS_OWNED_BILLING_PRINCIPAL,
	authorizeBillingOperation,
} from "../../rights.ts";
import { availableBillingCredentialEnvironments } from "../../credentials.ts";
import { resolveBillingEnvironment } from "../../environment.ts";
import {
	decideLocalBillingOperationCapability,
	selectedModeAllowedForCapability,
} from "../capability-decision.ts";
import { createBillingProviderExecutionContext } from "../providers/execution-context.ts";
import { createConfiguredProviderBinding } from "../providers/binding.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { resolveBillingExecutionTarget } from "../providers/resolve-target.ts";
import type {
	BillingProviderExecutionContext,
	BillingProviderRuntime,
} from "../providers/types.ts";

export interface ResolvedLocalBillingProviderExecution {
	context: BillingProviderExecutionContext;
	runtime: BillingProviderRuntime;
}

export function rejectUnsupportedListOffset(
	operation: BillingOperation,
	offset?: number,
): void {
	if (offset == null) {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation,
		reason: "unsupported_operation",
	});
}

export function rejectUnsupportedLocalPaymentListSource(source?: string): void {
	if (source == null || source === "provider") {
		return;
	}
	throw new AthenaBillingCapabilityError({
		operation: "payments.list",
		reason: "unsupported_operation",
	});
}

export function requireProviderPort<T>(
	port: T | undefined,
	operation: BillingOperation,
): T {
	if (port == null) {
		throw new AthenaBillingCapabilityError({
			operation,
			reason: "unsupported_operation",
		});
	}
	return port;
}

export async function resolveLocalBillingProviderExecution(input: {
	configuredProviders?: BillingProviderConfigMap;
	idempotencyKey?: string;
	operation: BillingOperation;
	principal?: AthenaPrincipal;
	registry: BillingProviderRegistry;
	target: BillingExecutionTarget;
	testMode?: boolean;
}): Promise<ResolvedLocalBillingProviderExecution> {
	const target = resolveBillingExecutionTarget({
		configuredProviders: input.configuredProviders,
		registry: input.registry,
		target: input.target,
	});
	if (target.kind === "connection") {
		throw new AthenaBillingCapabilityError({
			operation: input.operation,
			reason: "missing_connection",
		});
	}
	const binding = createConfiguredProviderBinding({
		configuredProviders: input.configuredProviders,
		provider: target.provider,
	});
	const providerCapabilities = await target.runtime.getCapabilities(binding);
	const authority = readBindingAuthority(binding.providerConfig);
	const environment = resolveBillingEnvironment({
		testMode: input.testMode,
	});
	const portName = input.operation.split(".")[0] as BillingPortName;
	const capability = decideLocalBillingOperationCapability({
		anyCredentialConfigured:
			availableBillingCredentialEnvironments(binding.credentials).length > 0,
		authority,
		operation: input.operation,
		portAvailable:
			target.runtime[portName] != null &&
			providerCapabilities.ports[portName] === true,
		provider: target.provider,
		providerConfig: binding.providerConfig,
		providerOperationEnabled:
			providerCapabilities.operations[input.operation] === true,
		requestedProfileId: input.target.profileId,
		selectedModeAllowed: selectedModeAllowedForCapability({
			authority,
			selectedCredentialConfigured:
				binding.credentials[environment.name] != null,
			selectedEnvironment: environment.name,
		}),
	});
	if (capability.available !== true) {
		throw new AthenaBillingCapabilityError({
			operation: input.operation,
			reason: capability.reason ?? "unsupported_operation",
		});
	}
	const denied = authorizeBillingOperation(
		input.principal ?? PROCESS_OWNED_BILLING_PRINCIPAL,
		input.operation,
	);
	if (denied) {
		throw denied;
	}
	const context = createBillingProviderExecutionContext({
		binding,
		idempotencyKey: input.idempotencyKey,
		target: {
			profileId: input.target.profileId,
		},
		testMode: input.testMode,
	});
	return {
		context,
		runtime: target.runtime,
	};
}

function readBindingAuthority(
	providerConfig: Readonly<Record<string, unknown>>,
): BillingCredentialAuthority | undefined {
	const raw = providerConfig.authority;
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
