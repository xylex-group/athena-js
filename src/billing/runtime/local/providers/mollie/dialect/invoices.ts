import type { BillingProviderGetInvoiceInput } from "../../types.ts";

export function mapGetInvoiceToMollieSdk(
	input: BillingProviderGetInvoiceInput,
): Record<string, unknown> {
	return { invoiceId: input.invoiceId };
}
