import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
	BillingGetInvoiceInput,
	BillingInvoice,
	BillingListInvoicesInput,
} from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import {
	rejectUnsupportedListOffset,
	requireProviderPort,
	resolveLocalBillingProviderExecution,
} from "./shared.ts";

export async function executeLocalBillingInvoiceGet(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingGetInvoiceInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingInvoice> {
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "invoices.get",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const invoices = requireProviderPort(runtime.invoices, "invoices.get");
	return invoices.get(context, { invoiceId: input.payload.invoiceId });
}

export async function executeLocalBillingInvoiceList(input: {
	configuredProviders?: BillingProviderConfigMap;
	payload: BillingListInvoicesInput;
	principal?: import("../../../../runtime/data/principal.ts").AthenaPrincipal;
	registry: BillingProviderRegistry;
	testMode?: boolean;
}): Promise<BillingPage<BillingInvoice>> {
	rejectUnsupportedListOffset("invoices.list", input.payload.offset);
	const { context, runtime } = await resolveLocalBillingProviderExecution({
		configuredProviders: input.configuredProviders,
		operation: "invoices.list",
		principal: input.principal,
		registry: input.registry,
		target: input.payload,
		testMode: input.testMode,
	});
	const invoices = requireProviderPort(runtime.invoices, "invoices.list");
	return invoices.list(context, {
		cursor: input.payload.cursor,
		limit: input.payload.limit,
	});
}
