import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import { DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES } from "../../../ingestion/types.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type {
  BillingCreateWebhookInput,
  BillingDeleteWebhookInput,
  BillingListWebhooksInput,
  BillingUpdateWebhookInput,
  BillingWebhook,
} from "../../../types.ts";
import type { BillingInvocationAuthority } from "../../invocation-authority.ts";
import type { BillingPage } from "../../types.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { normalizeBillingProviderName } from "../providers/registry.ts";
import type { BillingProviderWebhook } from "../providers/types.ts";
import { executeLocalBillingOperation } from "./invoke.ts";
import { rejectUnsupportedListOffset, requireProviderPort } from "./shared.ts";

const DEFAULT_WEBHOOK_NAME = "athena-billing";

function defaultWebhookIdempotencyKey(input: {
  environment: "test" | "live";
  eventTypes: readonly string[];
  name: string;
  url: string;
}): string {
  const eventTypes = [
    ...new Set(input.eventTypes.map((eventType) => eventType.trim())),
  ].sort();
  return [
    "athena-webhook",
    input.environment,
    encodeURIComponent(input.url),
    encodeURIComponent(input.name),
    eventTypes.map(encodeURIComponent).join(","),
  ].join(":");
}

export function projectBillingWebhook(
  webhook: BillingProviderWebhook
): BillingWebhook {
  return {
    eventTypes: [...webhook.eventTypes],
    metadata: {},
    mode: webhook.environment,
    name: webhook.name ?? null,
    provider: normalizeBillingProviderName(webhook.provider),
    providerWebhookId: webhook.id,
    raw: webhook,
    status: webhook.status,
    url: webhook.url,
  };
}

export async function executeLocalBillingWebhookCreate(input: {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingCreateWebhookInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingWebhook> {
  const webhook = await executeLocalBillingOperation({
    invoke: (webhooks, context, payload) =>
      webhooks.create(context, {
        eventTypes: payload.eventTypes ?? DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES,
        idempotencyKey:
          payload.idempotencyKey ??
          defaultWebhookIdempotencyKey({
            environment: context.environment.testMode ? "test" : "live",
            eventTypes:
              payload.eventTypes ?? DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES,
            name: payload.name ?? DEFAULT_WEBHOOK_NAME,
            url: payload.url,
          }),
        name: payload.name ?? DEFAULT_WEBHOOK_NAME,
        url: payload.url,
      }),
    operation: "webhooks.create",
    port: "webhooks",
    request: input,
  });
  return projectBillingWebhook(webhook);
}

export async function executeLocalBillingWebhookList(input: {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingListWebhooksInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingPage<BillingWebhook>> {
  const page = await executeLocalBillingOperation({
    before: (payload) =>
      rejectUnsupportedListOffset("webhooks.list", payload.offset),
    invoke: (webhooks, context, payload) => webhooks.list(context, payload),
    operation: "webhooks.list",
    port: "webhooks",
    request: input,
  });
  return {
    items: page.items.map(projectBillingWebhook),
    nextCursor: page.nextCursor,
  };
}

export async function executeLocalBillingWebhookUpdate(input: {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingUpdateWebhookInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<BillingWebhook> {
  const webhook = await executeLocalBillingOperation({
    invoke: (webhooks, context, payload) =>
      requireProviderPort(webhooks.update, "webhooks.update")(context, {
        eventTypes: payload.eventTypes,
        id: payload.id,
        name: payload.name,
        url: payload.url,
      }),
    operation: "webhooks.update",
    port: "webhooks",
    request: input,
  });
  return projectBillingWebhook(webhook);
}

export async function executeLocalBillingWebhookDelete(input: {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: BillingDeleteWebhookInput;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}): Promise<void> {
  await executeLocalBillingOperation({
    invoke: async (webhooks, context, payload) => {
      await requireProviderPort(webhooks.delete, "webhooks.delete")(context, {
        id: payload.id,
      });
    },
    operation: "webhooks.delete",
    port: "webhooks",
    request: input,
  });
}
