import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { prepareBillingCommand } from "../../../safety/prepare.ts";
import type {
	BillingCancelPaymentInput,
	BillingCreatePaymentInput,
	BillingGetPaymentInput,
	BillingListPaymentsInput,
	BillingPayment,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import type { BillingProviderCreatePaymentInput } from "../providers/types.ts";
import {
	rejectUnsupportedListOffset,
	rejectUnsupportedLocalPaymentListSource,
	resolveLocalBillingProviderExecution,
	requireProviderPort,
} from "./shared.ts";

export async function executeLocalBillingPaymentCreate(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCreatePaymentInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPayment> {
	const prepared = prepareBillingCommand({
		idempotency: "defer",
		operation: "payments.create",
		payload: input.payload,
		testMode: input.testMode,
	});
	const payload = prepared.payload as unknown as BillingCreatePaymentInput;
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		idempotencyKey: payload.idempotencyKey,
		operation: "payments.create",
		principal: input.principal,
		registry: input.registry,
		target: payload,
		testMode: input.testMode,
	});
	prepareBillingCommand({
		operation: "payments.create",
		payload,
		testMode: input.testMode,
	});
	const payments = requireProviderPort(runtime.payments, "payments.create");
	const providerInput: BillingProviderCreatePaymentInput = {
		amount: payload.amount,
		customerId: payload.customerId,
		description: payload.description,
		idempotencyKey: payload.idempotencyKey,
		metadata: payload.metadata,
		redirectUrl: payload.redirectUrl,
	};
	return payments.create(context, providerInput);
}

export async function executeLocalBillingPaymentGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetPaymentInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPayment> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "payments.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const payments = requireProviderPort(runtime.payments, "payments.get");
	return payments.get(context, { id: input.payload.id });
}

export async function executeLocalBillingPaymentCancel(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingCancelPaymentInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPayment> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "payments.cancel",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const payments = requireProviderPort(runtime.payments, "payments.cancel");
	return payments.cancel(context, { id: input.payload.id });
}

export async function executeLocalBillingPaymentList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListPaymentsInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingPayment>> {
	rejectUnsupportedListOffset("payments.list", input.payload.offset);
	rejectUnsupportedLocalPaymentListSource(input.payload.source);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "payments.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const payments = requireProviderPort(runtime.payments, "payments.list");
	return payments.list(context, {
		cursor: input.payload.cursor,
		limit: input.payload.limit,
	});
}
