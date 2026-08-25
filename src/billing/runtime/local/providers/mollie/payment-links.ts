import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingPaymentLink } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
	BillingPaymentLinksPort,
	BillingProviderCreatePaymentLinkInput,
	BillingProviderExecutionContext,
	BillingProviderGetResourceInput,
	BillingProviderListInput,
	BillingProviderUpdatePaymentLinkInput,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import {
	mapCreatePaymentLinkToMollieSdk,
	mapGetPaymentLinkToMollieSdk,
	mapUpdatePaymentLinkToMollieSdk,
} from "./dialect/payment-links.ts";
import { rejectUnenforcedMollieProfileTarget } from "./profile-target.ts";
import { projectMolliePaymentLink } from "./projection/payment-link.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";

export class MollieBillingPaymentLinksPort implements BillingPaymentLinksPort {
	readonly kind = "payment-links" as const;

	constructor(
		config: NormalizedMollieBillingProviderConfig,
		private readonly pool: MollieSdkClientPool,
	) {
		void config;
	}

	async create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreatePaymentLinkInput,
	): Promise<BillingPaymentLink> {
		rejectUnenforcedMollieProfileTarget({
			operation: "paymentLinks.create",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "create",
			operation: "paymentLinks.create",
			request: mapCreatePaymentLinkToMollieSdk({
				idempotencyKey: context.idempotencyKey ?? input.idempotencyKey,
				input,
			}),
			resource: "paymentLinks",
		});
		return projectMolliePaymentLink(raw);
	}

	async delete(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<void> {
		rejectUnenforcedMollieProfileTarget({
			operation: "paymentLinks.delete",
			requestedProfileId: context.target.profileId,
		});
		await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "delete",
			operation: "paymentLinks.delete",
			request: mapGetPaymentLinkToMollieSdk(input),
			resource: "paymentLinks",
		});
	}

	async get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingPaymentLink> {
		rejectUnenforcedMollieProfileTarget({
			operation: "paymentLinks.get",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "get",
			operation: "paymentLinks.get",
			request: mapGetPaymentLinkToMollieSdk(input),
			resource: "paymentLinks",
		});
		return projectMolliePaymentLink(raw);
	}

	async list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingPaymentLink>> {
		rejectUnenforcedMollieProfileTarget({
			operation: "paymentLinks.list",
			requestedProfileId: context.target.profileId,
		});
		const from =
			input.cursor != null && input.cursor.length > 0
				? decodeMollieListCursor(input.cursor, "payment-links")
				: undefined;
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "list",
			operation: "paymentLinks.list",
			unwrap: false,
			request: { from, limit: input.limit },
			resource: "paymentLinks",
		});
		const page = await readOneMollieSdkPage(raw, "payment-links");
		return {
			items: page.items.map(projectMolliePaymentLink),
			nextCursor: page.nextCursor,
		};
	}

	async update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdatePaymentLinkInput,
	): Promise<BillingPaymentLink> {
		rejectUnenforcedMollieProfileTarget({
			operation: "paymentLinks.update",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "update",
			operation: "paymentLinks.update",
			request: mapUpdatePaymentLinkToMollieSdk(input),
			resource: "paymentLinks",
		});
		return projectMolliePaymentLink(raw);
	}
}

export function createMollieBillingPaymentLinksPort(
	config: NormalizedMollieBillingProviderConfig,
	pool: MollieSdkClientPool,
): BillingPaymentLinksPort {
	return new MollieBillingPaymentLinksPort(config, pool);
}
