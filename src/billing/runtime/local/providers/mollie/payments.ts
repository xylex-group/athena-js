import { AthenaBillingCapabilityError } from "../../../../errors.ts";
import type { NormalizedMollieBillingProviderConfig } from "../../../../providers/types.ts";
import type { BillingPayment } from "../../../../types.ts";
import type { BillingPage } from "../../../types.ts";
import type {
  BillingProviderCreatePaymentInput,
  BillingProviderExecutionContext,
  BillingProviderGetResourceInput,
  BillingProviderListInput,
  BillingProviderPaymentPort,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import {
  mapCreatePaymentToMollieSdk,
  mapGetPaymentToMollieSdk,
  mapListPaymentsToMollieSdk,
  paymentCreateBody,
} from "./dialect/payments.ts";
import {
  assertMolliePaymentMatchesSelectedProfile,
  resolveMollieRequestProfileId,
} from "./profile-target.ts";
import { projectMolliePayment } from "./projection.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";

export class MollieBillingPaymentsPort implements BillingProviderPaymentPort {
  constructor(
    private readonly config: NormalizedMollieBillingProviderConfig,
    private readonly pool: MollieSdkClientPool
  ) {}

  private profileId(
    context: BillingProviderExecutionContext
  ): string | undefined {
    return resolveMollieRequestProfileId({
      configuredProfileId:
        this.config.profileId ?? this.config.defaultProfileId,
      credentialKind: this.config.credentialKind,
      requestedProfileId: context.target.profileId,
    });
  }

  async cancel(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingPayment> {
    const client = clientFromPool(this.pool, context);
    const profileId = this.profileId(context);
    if (profileId != null) {
      const existing = await callMollieSdk({
        client,
        method: "get",
        operation: "payments.cancel",
        request: mapGetPaymentToMollieSdk(input),
        resource: "payments",
      });
      assertMolliePaymentMatchesSelectedProfile({
        operation: "payments.cancel",
        payment: projectMolliePayment(existing),
        selectedProfileId: profileId,
      });
    }
    const raw = await callMollieSdk({
      client,
      method: "cancel",
      operation: "payments.cancel",
      request: mapGetPaymentToMollieSdk(input),
      resource: "payments",
    });
    return projectMolliePayment(raw);
  }

  async create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreatePaymentInput
  ): Promise<BillingPayment> {
    const profileId = this.profileId(context);
    if (this.config.credentialKind !== "api_key" && profileId == null) {
      throw new AthenaBillingCapabilityError({
        operation: "payments.create",
        reason: "missing_provider_scope",
      });
    }
    const raw = await callMollieSdk({
      client: clientFromPool(this.pool, context),
      method: "create",
      operation: "payments.create",
      request: mapCreatePaymentToMollieSdk({
        body: paymentCreateBody(input, profileId, context),
        idempotencyKey: context.idempotencyKey ?? input.idempotencyKey,
      }),
      resource: "payments",
    });
    return projectMolliePayment(raw);
  }

  async get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingPayment> {
    const raw = await callMollieSdk({
      client: clientFromPool(this.pool, context),
      method: "get",
      operation: "payments.get",
      request: mapGetPaymentToMollieSdk(input),
      resource: "payments",
    });
    const payment = projectMolliePayment(raw);
    assertMolliePaymentMatchesSelectedProfile({
      operation: "payments.get",
      payment,
      selectedProfileId: this.profileId(context),
    });
    return payment;
  }

  async list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingPayment>> {
    const from =
      input.cursor != null && input.cursor.length > 0
        ? decodeMollieListCursor(input.cursor, "payments")
        : undefined;
    const raw = await callMollieSdk({
      client: clientFromPool(this.pool, context),
      method: "list",
      operation: "payments.list",
      request: mapListPaymentsToMollieSdk({
        from,
        limit: input.limit,
        profileId: this.profileId(context),
      }),
      resource: "payments",
      unwrap: false,
    });
    const page = await readOneMollieSdkPage(raw, "payments", this.pool.apiBaseUrl());
    return {
      items: page.items.map(projectMolliePayment),
      nextCursor: page.nextCursor,
    };
  }
}

export function createMollieBillingPaymentsPort(
  config: NormalizedMollieBillingProviderConfig,
  pool: MollieSdkClientPool
): BillingProviderPaymentPort {
  return new MollieBillingPaymentsPort(config, pool);
}
