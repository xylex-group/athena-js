import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { prepareBillingCommand } from "../../../safety/prepare.ts";
import type {
	BillingCancelSubscriptionInput,
	BillingCreateSubscriptionInput,
	BillingGetSubscriptionInput,
	BillingListSubscriptionsInput,
	BillingSubscription,
	BillingUpdateSubscriptionInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import {
	rejectUnsupportedListOffset,
	requireProviderPort,
	resolveLocalBillingProviderExecution,
} from "./shared.ts";

export async function executeLocalBillingSubscriptionCreate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCreateSubscriptionInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingSubscription> {
	const prepared = prepareBillingCommand({
		idempotency: "defer",
		operation: "subscriptions.create",
		payload: input.payload,
		testMode: input.testMode,
	});
	const payload =
		prepared.payload as unknown as BillingCreateSubscriptionInput;
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		idempotencyKey: payload.idempotencyKey,
		operation: "subscriptions.create",
		principal: input.principal,
		registry: input.registry,
		target: payload,
		testMode: input.testMode,
	});
	prepareBillingCommand({
		operation: "subscriptions.create",
		payload,
		testMode: input.testMode,
	});
	const subscriptions = requireProviderPort(
		runtime.subscriptions,
		"subscriptions.create",
	);
	return subscriptions.create(context, {
		amount: payload.amount,
		customerId: payload.customerId,
		description: payload.description,
		idempotencyKey: payload.idempotencyKey,
		interval: payload.interval,
		metadata: payload.metadata,
	});
}

export async function executeLocalBillingSubscriptionGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetSubscriptionInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingSubscription> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "subscriptions.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const subscriptions = requireProviderPort(
		runtime.subscriptions,
		"subscriptions.get",
	);
	return subscriptions.get(context, {
		customerId: input.payload.customerId,
		subscriptionId: input.payload.subscriptionId,
	});
}

export async function executeLocalBillingSubscriptionList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListSubscriptionsInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingSubscription>> {
	rejectUnsupportedListOffset("subscriptions.list", input.payload.offset);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "subscriptions.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const subscriptions = requireProviderPort(
		runtime.subscriptions,
		"subscriptions.list",
	);
	return subscriptions.list(context, {
		cursor: input.payload.cursor,
		customerId: input.payload.customerId,
		limit: input.payload.limit,
	});
}

export async function executeLocalBillingSubscriptionUpdate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingUpdateSubscriptionInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingSubscription> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "subscriptions.update",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const subscriptions = requireProviderPort(
		runtime.subscriptions,
		"subscriptions.update",
	);
	return subscriptions.update(context, {
		customerId: input.payload.customerId,
		description: input.payload.description,
		subscriptionId: input.payload.subscriptionId,
	});
}

export async function executeLocalBillingSubscriptionCancel(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCancelSubscriptionInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingSubscription> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "subscriptions.cancel",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const subscriptions = requireProviderPort(
		runtime.subscriptions,
		"subscriptions.cancel",
	);
	return subscriptions.cancel(context, {
		customerId: input.payload.customerId,
		subscriptionId: input.payload.subscriptionId,
	});
}
