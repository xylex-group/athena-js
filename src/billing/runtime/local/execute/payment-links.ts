import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { prepareBillingCommand } from "../../../safety/prepare.ts";
import type {
	BillingCreatePaymentLinkInput,
	BillingDeletePaymentLinkInput,
	BillingGetPaymentLinkInput,
	BillingListPaymentLinksInput,
	BillingPaymentLink,
	BillingUpdatePaymentLinkInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import {
	rejectUnsupportedListOffset,
	requireProviderPort,
	resolveLocalBillingProviderExecution,
} from "./shared.ts";

export async function executeLocalBillingPaymentLinkCreate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCreatePaymentLinkInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPaymentLink> {
	const prepared = prepareBillingCommand({
		idempotency: "defer",
		operation: "paymentLinks.create",
		payload: input.payload,
		testMode: input.testMode,
	});
	const payload = prepared.payload as unknown as BillingCreatePaymentLinkInput;
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		idempotencyKey: payload.idempotencyKey,
		operation: "paymentLinks.create",
		principal: input.principal,
		registry: input.registry,
		target: payload,
		testMode: input.testMode,
	});
	prepareBillingCommand({
		operation: "paymentLinks.create",
		payload,
		testMode: input.testMode,
	});
	const paymentLinks = requireProviderPort(
		runtime.paymentLinks,
		"paymentLinks.create",
	);
	return paymentLinks.create(context, {
		amount: payload.amount,
		description: payload.description,
		idempotencyKey: payload.idempotencyKey,
		redirectUrl: payload.redirectUrl,
	});
}

export async function executeLocalBillingPaymentLinkGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetPaymentLinkInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPaymentLink> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "paymentLinks.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const paymentLinks = requireProviderPort(
		runtime.paymentLinks,
		"paymentLinks.get",
	);
	return paymentLinks.get(context, { id: input.payload.id });
}

export async function executeLocalBillingPaymentLinkList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListPaymentLinksInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingPaymentLink>> {
	rejectUnsupportedListOffset("paymentLinks.list", input.payload.offset);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "paymentLinks.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const paymentLinks = requireProviderPort(
		runtime.paymentLinks,
		"paymentLinks.list",
	);
	return paymentLinks.list(context, {
		cursor: input.payload.cursor,
		limit: input.payload.limit,
	});
}

export async function executeLocalBillingPaymentLinkUpdate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingUpdatePaymentLinkInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPaymentLink> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "paymentLinks.update",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const paymentLinks = requireProviderPort(
		runtime.paymentLinks,
		"paymentLinks.update",
	);
	return paymentLinks.update(context, {
		description: input.payload.description,
		id: input.payload.id,
	});
}

export async function executeLocalBillingPaymentLinkDelete(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingDeletePaymentLinkInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<void> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "paymentLinks.delete",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const paymentLinks = requireProviderPort(
		runtime.paymentLinks,
		"paymentLinks.delete",
	);
	await paymentLinks.delete(context, { id: input.payload.id });
}
