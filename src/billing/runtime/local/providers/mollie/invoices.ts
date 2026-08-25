import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingInvoice } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
	BillingInvoicesPort,
	BillingProviderExecutionContext,
	BillingProviderGetInvoiceInput,
	BillingProviderListInput,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import { mapGetInvoiceToMollieSdk } from "./dialect/invoices.ts";
import { rejectUnenforcedMollieProfileTarget } from "./profile-target.ts";
import { projectMollieInvoice } from "./projection/invoice.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";
import type { MollieSdkResourceClient } from "./sdk/types.ts";

function invoiceResourceName(client: object): keyof MollieSdkResourceClient {
	const record = client as MollieSdkResourceClient;
	return record.salesInvoices != null ? "salesInvoices" : "invoices";
}

export class MollieBillingInvoicesPort implements BillingInvoicesPort {
	readonly kind = "invoices" as const;

	constructor(
		config: NormalizedMollieBillingProviderConfig,
		private readonly pool: MollieSdkClientPool,
	) {
		void config;
	}

	async get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetInvoiceInput,
	): Promise<BillingInvoice> {
		rejectUnenforcedMollieProfileTarget({
			operation: "invoices.get",
			requestedProfileId: context.target.profileId,
		});
		const client = clientFromPool(this.pool, context);
		const raw = await callMollieSdk({
			client,
			method: "get",
			operation: "invoices.get",
			request: mapGetInvoiceToMollieSdk(input),
			resource: invoiceResourceName(client),
		});
		return projectMollieInvoice(raw);
	}

	async list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingInvoice>> {
		rejectUnenforcedMollieProfileTarget({
			operation: "invoices.list",
			requestedProfileId: context.target.profileId,
		});
		const from =
			input.cursor != null && input.cursor.length > 0
				? decodeMollieListCursor(input.cursor, "invoices")
				: undefined;
		const client = clientFromPool(this.pool, context);
		const raw = await callMollieSdk({
			client,
			method: "list",
			operation: "invoices.list",
			unwrap: false,
			request: { from, limit: input.limit },
			resource: invoiceResourceName(client),
		});
		const page = await readOneMollieSdkPage(raw, "invoices");
		return {
			items: page.items.map(projectMollieInvoice),
			nextCursor: page.nextCursor,
		};
	}
}

export function createMollieBillingInvoicesPort(
	config: NormalizedMollieBillingProviderConfig,
	pool: MollieSdkClientPool,
): BillingInvoicesPort {
	return new MollieBillingInvoicesPort(config, pool);
}
