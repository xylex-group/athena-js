import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingCustomer } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
	BillingCustomersPort,
	BillingProviderCreateCustomerInput,
	BillingProviderExecutionContext,
	BillingProviderGetResourceInput,
	BillingProviderListInput,
	BillingProviderUpdateCustomerInput,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import {
	customerCreateBody,
	mapCreateCustomerToMollieSdk,
	mapGetCustomerToMollieSdk,
	mapUpdateCustomerToMollieSdk,
} from "./dialect/customers.ts";
import { rejectUnenforcedMollieProfileTarget } from "./profile-target.ts";
import { projectMollieCustomer } from "./projection/customer.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";

export class MollieBillingCustomersPort implements BillingCustomersPort {
	readonly kind = "customers" as const;

	constructor(
		config: NormalizedMollieBillingProviderConfig,
		private readonly pool: MollieSdkClientPool,
	) {
		void config;
	}

	async create(
		context: BillingProviderExecutionContext,
		input: BillingProviderCreateCustomerInput,
	): Promise<BillingCustomer> {
		rejectUnenforcedMollieProfileTarget({
			operation: "customers.create",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "create",
			operation: "customers.create",
			request: mapCreateCustomerToMollieSdk({
				body: customerCreateBody(input),
				idempotencyKey: context.idempotencyKey ?? input.idempotencyKey,
			}),
			resource: "customers",
		});
		return projectMollieCustomer(raw);
	}

	async delete(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<void> {
		rejectUnenforcedMollieProfileTarget({
			operation: "customers.delete",
			requestedProfileId: context.target.profileId,
		});
		await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "delete",
			operation: "customers.delete",
			request: mapGetCustomerToMollieSdk(input),
			resource: "customers",
		});
	}

	async get(
		context: BillingProviderExecutionContext,
		input: BillingProviderGetResourceInput,
	): Promise<BillingCustomer> {
		rejectUnenforcedMollieProfileTarget({
			operation: "customers.get",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "get",
			operation: "customers.get",
			request: mapGetCustomerToMollieSdk(input),
			resource: "customers",
		});
		return projectMollieCustomer(raw);
	}

	async list(
		context: BillingProviderExecutionContext,
		input: BillingProviderListInput,
	): Promise<BillingPage<BillingCustomer>> {
		rejectUnenforcedMollieProfileTarget({
			operation: "customers.list",
			requestedProfileId: context.target.profileId,
		});
		const from =
			input.cursor != null && input.cursor.length > 0
				? decodeMollieListCursor(input.cursor, "customers")
				: undefined;
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "list",
			operation: "customers.list",
			unwrap: false,
			request: { from, limit: input.limit },
			resource: "customers",
		});
		const page = await readOneMollieSdkPage(raw, "customers");
		return {
			items: page.items.map(projectMollieCustomer),
			nextCursor: page.nextCursor,
		};
	}

	async update(
		context: BillingProviderExecutionContext,
		input: BillingProviderUpdateCustomerInput,
	): Promise<BillingCustomer> {
		rejectUnenforcedMollieProfileTarget({
			operation: "customers.update",
			requestedProfileId: context.target.profileId,
		});
		const raw = await callMollieSdk({
			client: clientFromPool(this.pool, context),
			method: "update",
			operation: "customers.update",
			request: mapUpdateCustomerToMollieSdk(input),
			resource: "customers",
		});
		return projectMollieCustomer(raw);
	}
}

export function createMollieBillingCustomersPort(
	config: NormalizedMollieBillingProviderConfig,
	pool: MollieSdkClientPool,
): BillingCustomersPort {
	return new MollieBillingCustomersPort(config, pool);
}
