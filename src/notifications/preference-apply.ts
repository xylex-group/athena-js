import {
  catalogHasChannel,
  findCatalogEntry,
  isNotificationChannelId,
} from "./catalog.ts";
import {
  ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN,
  ATHENA_NOTIFICATIONS_DIGEST_INVALID,
  ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN,
  throwNotificationsError,
} from "./errors.ts";
import {
  collapseNotificationPreferenceMutations,
  requireUniformPreferenceMutationScope,
} from "./preference-batch.ts";
import { resolveEffectiveNotificationPreferences } from "./resolve.ts";
import type {
  NotificationPreferenceStore,
  NotificationPreferenceStoreMutation,
} from "./store.ts";
import type {
  AthenaEffectiveNotificationPreference,
  AthenaNotificationPreferenceApplyManyInput,
  AthenaNotificationPreferenceMutation,
  NotificationCatalogEntry,
  NotificationChannelId,
  NotificationDigest,
} from "./types.ts";
import { NOTIFICATION_DIGEST_VALUES } from "./types.ts";

function requireTopic(
  catalog: readonly NotificationCatalogEntry[],
  topic: string
): string {
  if (!catalog.some((entry) => entry.topic === topic)) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN);
  }
  return topic;
}

function requireChannel(
  catalog: readonly NotificationCatalogEntry[],
  channel: string
): NotificationChannelId {
  if (
    !(isNotificationChannelId(channel) && catalogHasChannel(catalog, channel))
  ) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN);
  }
  return channel;
}

function requirePair(
  catalog: readonly NotificationCatalogEntry[],
  topic: string,
  channel: NotificationChannelId
): void {
  if (!findCatalogEntry(catalog, topic, channel)) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN);
  }
}

function normalizeDigest(
  digest: NotificationDigest | null | undefined
): NotificationDigest | null {
  if (digest === undefined || digest === null) {
    return null;
  }
  if (!(NOTIFICATION_DIGEST_VALUES as readonly string[]).includes(digest)) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_DIGEST_INVALID);
  }
  return digest;
}

function pairKey(topic: string, channel: string): string {
  return `${topic}\u0000${channel}`;
}

export async function applyNotificationPreferenceMutations(input: {
  catalog: readonly NotificationCatalogEntry[];
  mutations: readonly AthenaNotificationPreferenceMutation[];
  preferenceStore: NotificationPreferenceStore;
  userId: string;
}): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
  const collapsed = collapseNotificationPreferenceMutations(input.mutations);
  if (collapsed.length === 0) {
    return { items: [] };
  }
  const organizationId = requireUniformPreferenceMutationScope(collapsed);
  const storeMutations: NotificationPreferenceStoreMutation[] = [];
  const affected = new Set<string>();
  for (const mutation of collapsed) {
    const topic = requireTopic(input.catalog, mutation.topic);
    const channel = requireChannel(input.catalog, mutation.channel);
    requirePair(input.catalog, topic, channel);
    affected.add(pairKey(topic, channel));
    if (mutation.operation === "reset") {
      storeMutations.push({
        channel,
        operation: "reset",
        organizationId,
        topic,
        userId: input.userId,
      });
      continue;
    }
    storeMutations.push({
      channel,
      digest: normalizeDigest(mutation.digest),
      enabled: mutation.enabled,
      operation: "set",
      organizationId,
      topic,
      userId: input.userId,
    });
  }
  await input.preferenceStore.applyMany(storeMutations);
  const overrides = await input.preferenceStore.list({
    organizationId,
    userId: input.userId,
  });
  const items = resolveEffectiveNotificationPreferences({
    catalog: input.catalog,
    organizationId,
    overrides,
  }).filter((item) => affected.has(pairKey(item.topic, item.channel)));
  return { items };
}

export function asApplyManyInput(
  query: AthenaNotificationPreferenceApplyManyInput
): AthenaNotificationPreferenceMutation[] {
  return Array.isArray(query.mutations) ? [...query.mutations] : [];
}
