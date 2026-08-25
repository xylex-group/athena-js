import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { prepareBillingCommand } from "../../../safety/prepare.ts";
import type {
	BillingCreateCustomerInput,
	BillingCustomer,
	BillingDeleteCustomerInput,
	BillingGetCustomerInput,
	BillingListCustomersInput,
	BillingUpdateCustomerInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import {
	rejectUnsupportedListOffset,
	requireProviderPort,
	resolveLocalBillingProviderExecution,
} from "./shared.ts";

export async function executeLocalBillingCustomerCreate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCreateCustomerInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingCustomer> {
	const prepared = prepareBillingCommand({
		idempotency: "defer",
		operation: "customers.create",
		payload: input.payload,
		testMode: input.testMode,
	});
	const payload = prepared.payload as unknown as BillingCreateCustomerInput;
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		idempotencyKey: payload.idempotencyKey,
		operation: "customers.create",
		principal: input.principal,
		registry: input.registry,
		target: payload,
		testMode: input.testMode,
	});
	prepareBillingCommand({
		operation: "customers.create",
		payload,
		testMode: input.testMode,
	});
	const customers = requireProviderPort(runtime.customers, "customers.create");
	return customers.create(context, {
		email: payload.email,
		idempotencyKey: payload.idempotencyKey,
		metadata: payload.metadata,
		name: payload.name,
	});
}

export async function executeLocalBillingCustomerGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetCustomerInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingCustomer> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "customers.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const customers = requireProviderPort(runtime.customers, "customers.get");
	return customers.get(context, { id: input.payload.id });
}

export async function executeLocalBillingCustomerList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListCustomersInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingCustomer>> {
	rejectUnsupportedListOffset("customers.list", input.payload.offset);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "customers.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const customers = requireProviderPort(runtime.customers, "customers.list");
	return customers.list(context, {
		cursor: input.payload.cursor,
		limit: input.payload.limit,
	});
}

export async function executeLocalBillingCustomerUpdate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingUpdateCustomerInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingCustomer> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "customers.update",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const customers = requireProviderPort(runtime.customers, "customers.update");
	return customers.update(context, {
		email: input.payload.email,
		id: input.payload.id,
		name: input.payload.name,
	});
}

export async function executeLocalBillingCustomerDelete(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingDeleteCustomerInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<void> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "customers.delete",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const customers = requireProviderPort(runtime.customers, "customers.delete");
	await customers.delete(context, { id: input.payload.id });
}
