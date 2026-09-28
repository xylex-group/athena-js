import type { BillingPage } from "../../../types.ts";
import type {
  BillingProviderBinding,
  BillingProviderCreateWebhookInput,
  BillingProviderExecutionContext,
  BillingProviderListInput,
  BillingProviderUpdateWebhookInput,
  BillingProviderWebhook,
  BillingWebhookManagementCapability,
  BillingWebhooksPort,
} from "../types.ts";
import { decodeMollieListCursor } from "./cursor.ts";
import {
  decodeMollieWebhookEventTypes,
  mapCreateWebhookToMollieSdk,
  mapUpdateWebhookToMollieSdk,
  readMollieWebhookSigningSecret,
} from "./dialect/webhooks.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";
import { sendMollieJson } from "./sdk/json.ts";
import { readOneMollieSdkPage } from "./sdk/page.ts";
import { resolveMollieWebhookManagementCapability } from "./webhook-capability.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function projectMollieWebhook(
  raw: unknown,
  environment: "test" | "live"
): BillingProviderWebhook {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    throw new Error("Mollie webhook projection requires an id.");
  }
  const eventTypes = decodeMollieWebhookEventTypes(
    raw.eventTypes ?? raw.event_types
  );
  const status =
    raw.status === "disabled" || raw.enabled === false ? "disabled" : "active";
  const signingSecret = readMollieWebhookSigningSecret(raw);
  return {
    environment,
    eventTypes,
    id: raw.id,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    provider: "mollie",
    status,
    url: typeof raw.url === "string" ? raw.url : "",
    ...(signingSecret ? { signingSecret } : {}),
  };
}

export class MollieBillingWebhooksPort implements BillingWebhooksPort {
  readonly kind = "webhooks" as const;

  constructor(private readonly pool: MollieSdkClientPool) {}

  async getCapability(
    binding: BillingProviderBinding
  ): Promise<BillingWebhookManagementCapability> {
    return resolveMollieWebhookManagementCapability(binding);
  }

  async list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingProviderWebhook>> {
    const capability = resolveMollieWebhookManagementCapability(
      context.binding
    );
    if (capability.nextGen.list !== true) {
      return { items: [], nextCursor: null };
    }
    const from =
      input.cursor != null && input.cursor.length > 0
        ? decodeMollieListCursor(input.cursor, "webhooks")
        : undefined;
    const raw = await callMollieSdk({
      client: clientFromPool(this.pool, context),
      method: "list",
      operation: "webhooks.list",
      request: {
        from,
        limit: input.limit,
        testmode: context.environment.testMode,
      },
      resource: "webhooks",
      unwrap: false,
    });
    const page = await readOneMollieSdkPage(
      raw,
      "webhooks",
      this.pool.apiBaseUrl()
    );
    const environment = context.environment.testMode ? "test" : "live";
    return {
      items: page.items.map((item) => projectMollieWebhook(item, environment)),
      nextCursor: page.nextCursor,
    };
  }

  async create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreateWebhookInput
  ): Promise<BillingProviderWebhook> {
    const mapped = mapCreateWebhookToMollieSdk({
      input,
      testMode: context.environment.testMode,
    });
    const requestBody = mapped.requestBody;
    if (!isRecord(requestBody)) {
      throw new Error("Mollie webhook create requires a JSON request body.");
    }
    const raw = await sendMollieJson({
      apiBaseUrl: this.pool.apiBaseUrl(),
      body: requestBody,
      credential: context.credential,
      ...(typeof mapped.idempotencyKey === "string"
        ? { idempotencyKey: mapped.idempotencyKey }
        : {}),
      method: "POST",
      operation: "webhooks.create",
      path: "/v2/webhooks",
      signal: context.signal,
    });
    return projectMollieWebhook(
      raw,
      context.environment.testMode ? "test" : "live"
    );
  }

  async update(
    context: BillingProviderExecutionContext,
    input: BillingProviderUpdateWebhookInput
  ): Promise<BillingProviderWebhook> {
    const mapped = mapUpdateWebhookToMollieSdk({
      input,
      testMode: context.environment.testMode,
    });
    const requestBody = mapped.requestBody;
    const webhookId = mapped.webhookId;
    if (!isRecord(requestBody) || typeof webhookId !== "string") {
      throw new Error("Mollie webhook update requires an id and JSON body.");
    }
    const raw = await sendMollieJson({
      apiBaseUrl: this.pool.apiBaseUrl(),
      body: requestBody,
      credential: context.credential,
      method: "PATCH",
      operation: "webhooks.update",
      path: `/v2/webhooks/${encodeURIComponent(webhookId)}`,
      signal: context.signal,
    });
    return projectMollieWebhook(
      raw,
      context.environment.testMode ? "test" : "live"
    );
  }

  async delete(
    context: BillingProviderExecutionContext,
    input: { id: string }
  ): Promise<void> {
    await callMollieSdk({
      client: clientFromPool(this.pool, context),
      method: "delete",
      operation: "webhooks.delete",
      request: {
        requestBody: { testmode: context.environment.testMode },
        webhookId: input.id,
      },
      resource: "webhooks",
    });
  }
}

export function createMollieBillingWebhooksPort(
  pool: MollieSdkClientPool
): BillingWebhooksPort {
  return new MollieBillingWebhooksPort(pool);
}
