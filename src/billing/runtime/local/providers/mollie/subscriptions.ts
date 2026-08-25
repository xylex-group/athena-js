import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingSubscription } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
	BillingProviderCreateSubscriptionInput,
	BillingProviderExecutionContext,
	BillingProviderGetSubscriptionInput,
	BillingProviderListSubscriptionsInput,
	BillingProviderUpdateSubscriptionInput,
	BillingSubscriptionsPort,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import {
	mapCreateSubscriptionToMollieSdk,
	mapGetSubscriptionToMollieSdk,
	mapUpdateSubscriptionToMollieSdk,
} from "./dialect/subscriptions.ts";
import {
	rejectUnenforcedMollieProfileTarget,
	resolveMollieRequestProfileId,
} from "./profile-target.ts";
import { projectMollieSubscription } from "./projection/subscription.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";

export class MollieBillingSubscriptionsPort implements BillingSubscriptionsPort {
	readonly kind = "subscriptions" as const;

	constructor(
		private readonly config: NormalizedMollieBillingProviderConfig,
		private readonly pool: MollieSdkClientPool,
	) {}

	private profileId(
		context: BillingProviderExecutionContext,
	): string | undefined {
		return resolveMollieRequestProfileId({
			configuredProfileId:
				this.config.profileId ?? this.config.defaultProfileId,
			credentialKind: this.config.credentialKind,
			requestedProfileId: context.target.profileId,
		});
	}

	async create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateSubscriptionInput,
	): Promise<BillingSubscription> {
		rejectUnenforcedMollieProfileTarget({
			operation: "subscriptions.create",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "create",
			operation: "subscriptions.create",
			request: mapCreateSubscriptionToMollieSdk({
				idempotencyKey: context.idempotencyKey ?? input.idempotencyKey,
				input,
			}),
			resource: "subscriptions",
		});
		return projectMollieSubscription(raw);
	}

	async get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetSubscriptionInput,
	): Promise<BillingSubscription> {
		rejectUnenforcedMollieProfileTarget({
			operation: "subscriptions.get",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "get",
			operation: "subscriptions.get",
			request: mapGetSubscriptionToMollieSdk(input),
			resource: "subscriptions",
		});
		return projectMollieSubscription(raw);
	}

	async list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListSubscriptionsInput,
	): Promise<BillingPage<BillingSubscription>> {
		const from =
			input.cursor != null && input.cursor.length > 0
				? decodeMollieListCursor(input.cursor, "subscriptions")
				: undefined;
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "list",
			operation: "subscriptions.list",
			unwrap: false,
			request: {
				customerId: input.customerId,
				from,
				limit: input.limit,
				profileId: this.profileId(context),
			},
			resource: "subscriptions",
		});
		const page = await readOneMollieSdkPage(raw, "subscriptions");
		return {
			items: page.items.map(projectMollieSubscription),
			nextCursor: page.nextCursor,
		};
	}

	async update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdateSubscriptionInput,
	): Promise<BillingSubscription> {
		rejectUnenforcedMollieProfileTarget({
			operation: "subscriptions.update",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "update",
			operation: "subscriptions.update",
			request: mapUpdateSubscriptionToMollieSdk(input),
			resource: "subscriptions",
		});
		return projectMollieSubscription(raw);
	}

	async cancel(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetSubscriptionInput,
	): Promise<BillingSubscription> {
		rejectUnenforcedMollieProfileTarget({
			operation: "subscriptions.cancel",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "cancel",
			operation: "subscriptions.cancel",
			request: mapGetSubscriptionToMollieSdk(input),
			resource: "subscriptions",
		});
		return projectMollieSubscription(raw);
	}
}

export function createMollieBillingSubscriptionsPort(
	config: NormalizedMollieBillingProviderConfig,
	pool: MollieSdkClientPool,
): BillingSubscriptionsPort {
	return new MollieBillingSubscriptionsPort(config, pool);
}
