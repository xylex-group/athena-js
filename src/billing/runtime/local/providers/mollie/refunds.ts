import { isAthenaBillingProviderRequestError } from "../../../../errors.ts";
import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingRefund } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
	BillingProviderCreateRefundInput,
	BillingProviderExecutionContext,
	BillingProviderGetRefundInput,
	BillingProviderListInput,
	BillingRefundsPort,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import { mapGetPaymentToMollieSdk } from "./dialect/payments.ts";
import {
	mapCreateRefundToMollieSdk,
	mapGetRefundToMollieSdk,
} from "./dialect/refunds.ts";
import {
	assertMolliePaymentMatchesSelectedProfile,
	resolveMollieRequestProfileId,
} from "./profile-target.ts";
import { projectMolliePayment } from "./projection.ts";
import { projectMollieRefund } from "./projection/refund.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";

export class MollieBillingRefundsPort implements BillingRefundsPort {
	readonly kind = "refunds" as const;

	constructor(
		private readonly config: NormalizedMollieBillingProviderConfig,
		private readonly pool: MollieSdkClientPool,
	) {}

	private selectedProfileId(
		context: BillingProviderExecutionContext,
	): string | undefined {
		return resolveMollieRequestProfileId({
			configuredProfileId:
				this.config.profileId ?? this.config.defaultProfileId,
			credentialKind: this.config.credentialKind,
			requestedProfileId: context.target.profileId,
		});
	}

	private async assertParentPaymentProfile(
		context: BillingProviderExecutionContext,
		paymentId: string,
		operation: "refunds.cancel" | "refunds.create" | "refunds.get",
	): Promise<void> {
		const selectedProfileId = this.selectedProfileId(context);
		if (selectedProfileId == null) {
			return;
		}
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "get",
			operation,
			request: mapGetPaymentToMollieSdk({ id: paymentId }),
			resource: "payments",
		});
		assertMolliePaymentMatchesSelectedProfile({
			operation,
			payment: projectMolliePayment(raw),
			selectedProfileId,
		});
	}

	async create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateRefundInput,
	): Promise<BillingRefund> {
		await this.assertParentPaymentProfile(
			context,
			input.paymentId,
			"refunds.create",
		);
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "create",
			operation: "refunds.create",
			request: mapCreateRefundToMollieSdk({
				idempotencyKey: context.idempotencyKey ?? input.idempotencyKey,
				input,
			}),
			resource: "refunds",
		});
		return projectMollieRefund(raw);
	}

	async get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetRefundInput,
	): Promise<BillingRefund> {
		await this.assertParentPaymentProfile(
			context,
			input.paymentId,
			"refunds.get",
		);
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "get",
			operation: "refunds.get",
			request: mapGetRefundToMollieSdk(input),
			resource: "refunds",
		});
		return projectMollieRefund(raw);
	}

	async cancel(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetRefundInput,
	): Promise<BillingRefund> {
		await this.assertParentPaymentProfile(
			context,
			input.paymentId,
			"refunds.cancel",
		);
		await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "cancel",
			operation: "refunds.cancel",
			request: mapGetRefundToMollieSdk(input),
			resource: "refunds",
		});
		try {
			return await this.get(context, input);
		} catch (error) {
			if (
				isAthenaBillingProviderRequestError(error) &&
				error.kind === "not_found"
			) {
				return {
					amount: null,
					metadata: undefined,
					provider: "mollie",
					providerPaymentId: input.paymentId,
					providerRefundId: input.refundId,
					raw: {
						canceled: true,
						paymentId: input.paymentId,
						refundId: input.refundId,
					},
					status: "canceled",
				};
			}
			throw error;
		}
	}

	async list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingRefund>> {
		const from =
			input.cursor != null && input.cursor.length > 0
				? decodeMollieListCursor(input.cursor, "refunds")
				: undefined;
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "list",
			operation: "refunds.list",
			unwrap: false,
			request: {
				from,
				limit: input.limit,
				profileId: this.selectedProfileId(context),
			},
			resource: "refunds",
		});
		const page = await readOneMollieSdkPage(raw, "refunds");
		return {
			items: page.items.map(projectMollieRefund),
			nextCursor: page.nextCursor,
		};
	}
}

export function createMollieBillingRefundsPort(
	config: NormalizedMollieBillingProviderConfig,
	pool: MollieSdkClientPool,
): BillingRefundsPort {
	return new MollieBillingRefundsPort(config, pool);
}
