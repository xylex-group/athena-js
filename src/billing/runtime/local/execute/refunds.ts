import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { prepareBillingCommand } from "../../../safety/prepare.ts";
import type {
	BillingCancelRefundInput,
	BillingCreateRefundInput,
	BillingGetRefundInput,
	BillingListRefundsInput,
	BillingRefund,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import {
	rejectUnsupportedListOffset,
	requireProviderPort,
	resolveLocalBillingProviderExecution,
} from "./shared.ts";

export async function executeLocalBillingRefundCreate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCreateRefundInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingRefund> {
	const prepared = prepareBillingCommand({
		idempotency: "defer",
		operation: "refunds.create",
		payload: input.payload,
		testMode: input.testMode,
	});
	const payload = prepared.payload as unknown as BillingCreateRefundInput;
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		idempotencyKey: payload.idempotencyKey,
		operation: "refunds.create",
		principal: input.principal,
		registry: input.registry,
		target: payload,
		testMode: input.testMode,
	});
	prepareBillingCommand({
		operation: "refunds.create",
		payload,
		testMode: input.testMode,
	});
	const refunds = requireProviderPort(runtime.refunds, "refunds.create");
	return refunds.create(context, {
		amount: payload.amount,
		description: payload.description,
		idempotencyKey: payload.idempotencyKey,
		paymentId: payload.paymentId,
	});
}

export async function executeLocalBillingRefundGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetRefundInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingRefund> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "refunds.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const refunds = requireProviderPort(runtime.refunds, "refunds.get");
	return refunds.get(context, {
		paymentId: input.payload.paymentId,
		refundId: input.payload.refundId,
	});
}

export async function executeLocalBillingRefundCancel(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCancelRefundInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingRefund> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "refunds.cancel",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const refunds = requireProviderPort(runtime.refunds, "refunds.cancel");
	return refunds.cancel(context, {
		paymentId: input.payload.paymentId,
		refundId: input.payload.refundId,
	});
}

export async function executeLocalBillingRefundList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListRefundsInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingRefund>> {
	rejectUnsupportedListOffset("refunds.list", input.payload.offset);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "refunds.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const refunds = requireProviderPort(runtime.refunds, "refunds.list");
	return refunds.list(context, {
		cursor: input.payload.cursor,
		limit: input.payload.limit,
	});
}
