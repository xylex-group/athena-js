import {
  catalogHasChannel,
  findCatalogEntry,
  isNotificationChannelId,
  normalizeNotificationCatalog,
} from "./catalog.ts";
import {
  NOTIFICATION_OPERATIONS,
  type NotificationOperation,
} from "./contract/operations.ts";
import {
  ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN,
  ATHENA_NOTIFICATIONS_DIGEST_INVALID,
  ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND,
  ATHENA_NOTIFICATIONS_SCOPE_INVALID,
  ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN,
  ATHENA_NOTIFICATIONS_UNAUTHENTICATED,
  ATHENA_NOTIFICATIONS_UNAVAILABLE,
  throwNotificationsError,
} from "./errors.ts";
import type { AthenaNotificationEventStore } from "./events-store.ts";
import { createMemoryNotificationEventStore } from "./events-store.ts";
import { createMemoryNotificationPreferenceStore } from "./memory-store.ts";
import { applyNotificationPreferenceMutations } from "./preference-apply.ts";
import {
  resolveEffectiveNotificationPreferences,
  resolveOneEffectivePreference,
} from "./resolve.ts";
import type {
  NotificationPreferenceStore,
  NotificationPreferenceUpsertInput,
} from "./store.ts";
import type {
  AthenaEffectiveNotificationPreference,
  AthenaNotificationEvent,
  AthenaNotificationPreferenceApplyManyInput,
  AthenaNotificationPreferenceMutation,
  AthenaNotificationPreferenceWriteInput,
  AthenaNotificationsModule,
  NotificationCatalogEntry,
  NotificationChannelId,
  NotificationDigest,
} from "./types.ts";
import { NOTIFICATION_DIGEST_VALUES } from "./types.ts";

export type NotificationsTransportKind = "embedded" | "remote";

export type NotificationsRemoteDialect = "gateway-v1" | "embedded-http";

/** Public contract: preferences.list, preferences.applyMany, preferences.update, preferences.updateMany, preferences.reset, preferences.resetMany, preferences.setChannel, catalog.list, list, markRead, markAllRead. */

export type NotificationsGatewayQuery = {
  [key: string]: string | number | boolean | null | undefined;
};

export type NotificationsGatewayRequest = (input: {
  body?: Record<string, unknown>;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: NotificationsGatewayQuery;
}) => Promise<unknown>;

export type CreateNotificationsModuleInput = {
  catalog?: readonly NotificationCatalogEntry[];
  eventStore?: AthenaNotificationEventStore;
  getUserId?: () => string | null | undefined;
  preferenceStore?: NotificationPreferenceStore;
  /** Remote gateway HTTP adapter for contract parity with embedded. */
  remoteRequest?: NotificationsGatewayRequest;
  remoteDialect?: NotificationsRemoteDialect;
  transport?: NotificationsTransportKind;
};

function normalizeScope(
  organizationId: string | null | undefined
): string | null {
  if (organizationId === undefined || organizationId === null) {
    return null;
  }
  if (organizationId.length === 0) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_SCOPE_INVALID);
  }
  return organizationId;
}

function requireCatalog(
  catalog: readonly NotificationCatalogEntry[] | null
): readonly NotificationCatalogEntry[] {
  if (!catalog) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
  }
  return catalog;
}

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

function requireUserId(getUserId?: () => string | null | undefined): string {
  const userId = getUserId?.()?.trim();
  if (!userId) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAUTHENTICATED);
  }
  return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function unwrapNotificationsGatewayResult(result: {
  data: unknown;
  ok: boolean;
  status: number;
}): unknown {
  if (!result.ok) {
    if (result.status === 401) {
      throwNotificationsError(ATHENA_NOTIFICATIONS_UNAUTHENTICATED);
    }
    if (result.status === 404) {
      throwNotificationsError(ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND);
    }
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
  }
  return result.data;
}

async function remoteJson(
  request: NotificationsGatewayRequest,
  method: "GET" | "POST" | "DELETE",
  path: string,
  options?: {
    body?: Record<string, unknown>;
    query?: NotificationsGatewayQuery;
  }
): Promise<unknown> {
  if (method === "GET" || method === "DELETE") {
    return request({
      method,
      path,
      query: options?.query,
    });
  }
  return request({
    body: options?.body,
    method,
    path,
    query: options?.query,
  });
}

function asItems<T>(value: unknown): T[] {
  if (!isRecord(value)) {
    return [];
  }
  return Array.isArray(value.items) ? (value.items as T[]) : [];
}

export function createRemoteNotificationsModule(input: {
  catalog?: readonly NotificationCatalogEntry[];
  getUserId?: () => string | null | undefined;
  remoteDialect?: NotificationsRemoteDialect;
  request: NotificationsGatewayRequest;
}): AthenaNotificationsModule {
  const catalog = normalizeNotificationCatalog(input.catalog);
  const request = input.request;
  const dialect = input.remoteDialect ?? "gateway-v1";

  async function invokeOperation(
    operation: NotificationOperation,
    payload?: Record<string, unknown>
  ): Promise<unknown> {
    return remoteJson(request, "POST", "/api/athena/notifications", {
      body: {
        operation,
        payload: payload ?? {},
      },
    });
  }

  return {
    catalog: {
      async list(): Promise<{
        items: readonly NotificationCatalogEntry[];
      }> {
        const resolved = requireCatalog(catalog);
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.catalogList
          );
          const items = asItems<NotificationCatalogEntry>(payload);
          return { items: items.length > 0 ? items : resolved };
        }
        const payload = await remoteJson(
          request,
          "GET",
          "/notifications/v1/catalog"
        );
        const items = asItems<NotificationCatalogEntry>(payload);
        return { items: items.length > 0 ? items : resolved };
      },
    },
    async list(query?: { unread?: boolean }): Promise<{
      items: AthenaNotificationEvent[];
    }> {
      if (dialect !== "embedded-http") {
        requireUserId(input.getUserId);
      }
      if (dialect === "embedded-http") {
        const payload = await invokeOperation(
          NOTIFICATION_OPERATIONS.eventsList,
          query?.unread === undefined ? {} : { unread: query.unread }
        );
        return { items: asItems<AthenaNotificationEvent>(payload) };
      }
      const payload = await remoteJson(
        request,
        "GET",
        "/notifications/v1/events",
        query?.unread === undefined
          ? undefined
          : { query: { unread: query.unread } }
      );
      return { items: asItems<AthenaNotificationEvent>(payload) };
    },
    async markAllRead(): Promise<{ ok: true }> {
      if (dialect !== "embedded-http") {
        requireUserId(input.getUserId);
      }
      if (dialect === "embedded-http") {
        await invokeOperation(NOTIFICATION_OPERATIONS.eventsMarkAllRead);
        return { ok: true };
      }
      await remoteJson(request, "POST", "/notifications/v1/events/read-all");
      return { ok: true };
    },
    async markRead(query: { id: string }): Promise<{ ok: true }> {
      if (dialect !== "embedded-http") {
        requireUserId(input.getUserId);
      }
      if (dialect === "embedded-http") {
        await invokeOperation(NOTIFICATION_OPERATIONS.eventsMarkRead, {
          id: query.id,
        });
        return { ok: true };
      }
      await remoteJson(request, "POST", "/notifications/v1/events/read", {
        body: {
          id: query.id,
        },
      });
      return { ok: true };
    },
    preferences: {
      async applyMany(
        query: AthenaNotificationPreferenceApplyManyInput
      ): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        requireCatalog(catalog);
        if (dialect !== "embedded-http") {
          requireUserId(input.getUserId);
        }
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesApplyMany,
            { mutations: [...query.mutations] }
          );
          return {
            items: asItems<AthenaEffectiveNotificationPreference>(payload),
          };
        }
        throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
      },
      async list(query?: { organizationId?: string | null }): Promise<{
        items: AthenaEffectiveNotificationPreference[];
      }> {
        requireCatalog(catalog);
        const organizationId = normalizeScope(query?.organizationId);
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesList,
            organizationId === null ? {} : { organizationId }
          );
          return {
            items: asItems<AthenaEffectiveNotificationPreference>(payload),
          };
        }
        const payload = await remoteJson(
          request,
          "GET",
          "/notifications/v1/preferences",
          organizationId === null ? undefined : { query: { organizationId } }
        );
        return {
          items: asItems<AthenaEffectiveNotificationPreference>(payload),
        };
      },
      async reset(query: {
        channel: NotificationChannelId;
        organizationId?: string | null;
        topic: string;
      }): Promise<{ item: AthenaEffectiveNotificationPreference }> {
        const resolved = requireCatalog(catalog);
        const topic = requireTopic(resolved, query.topic);
        const channel = requireChannel(resolved, query.channel);
        requirePair(resolved, topic, channel);
        normalizeScope(query.organizationId);
        if (dialect !== "embedded-http") {
          requireUserId(input.getUserId);
        }
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesReset,
            {
              channel,
              organizationId: query.organizationId ?? null,
              topic,
            }
          );
          if (isRecord(payload) && isRecord(payload.item)) {
            return {
              item: payload.item as unknown as AthenaEffectiveNotificationPreference,
            };
          }
          throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
        }
        const payload = await remoteJson(
          request,
          "DELETE",
          "/notifications/v1/preferences",
          {
            query: {
              channel,
              organizationId: query.organizationId ?? null,
              topic,
            },
          }
        );
        if (isRecord(payload) && isRecord(payload.item)) {
          return {
            item: payload.item as unknown as AthenaEffectiveNotificationPreference,
          };
        }
        throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
      },
      async resetMany(query: {
        items: readonly {
          channel: NotificationChannelId;
          organizationId?: string | null;
          topic: string;
        }[];
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        requireCatalog(catalog);
        if (dialect !== "embedded-http") {
          requireUserId(input.getUserId);
        }
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesResetMany,
            { items: [...query.items] }
          );
          return {
            items: asItems<AthenaEffectiveNotificationPreference>(payload),
          };
        }
        throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
      },
      async setChannel(query: {
        channel: NotificationChannelId;
        enabled: boolean;
        organizationId?: string | null;
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        const resolved = requireCatalog(catalog);
        const channel = requireChannel(resolved, query.channel);
        normalizeScope(query.organizationId);
        if (dialect !== "embedded-http") {
          requireUserId(input.getUserId);
        }
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesSetChannel,
            {
              channel,
              enabled: query.enabled,
              organizationId: query.organizationId ?? null,
            }
          );
          return {
            items: asItems<AthenaEffectiveNotificationPreference>(payload),
          };
        }
        throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
      },
      async update(query: {
        channel: NotificationChannelId;
        digest?: NotificationDigest | null;
        enabled: boolean;
        organizationId?: string | null;
        topic: string;
      }): Promise<{ item: AthenaEffectiveNotificationPreference }> {
        const resolved = requireCatalog(catalog);
        const topic = requireTopic(resolved, query.topic);
        const channel = requireChannel(resolved, query.channel);
        requirePair(resolved, topic, channel);
        normalizeDigest(query.digest);
        normalizeScope(query.organizationId);
        if (dialect !== "embedded-http") {
          requireUserId(input.getUserId);
        }
        if (dialect === "embedded-http") {
          const payload = await invokeOperation(
            NOTIFICATION_OPERATIONS.preferencesUpdate,
            {
              channel,
              digest: query.digest ?? null,
              enabled: query.enabled,
              organizationId: query.organizationId ?? null,
              topic,
            }
          );
          if (isRecord(payload) && isRecord(payload.item)) {
            return {
              item: payload.item as unknown as AthenaEffectiveNotificationPreference,
            };
          }
          throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
        }
        const payload = await remoteJson(
          request,
          "POST",
          "/notifications/v1/preferences",
          {
            body: {
              channel,
              digest: query.digest ?? null,
              enabled: query.enabled,
              organizationId: query.organizationId ?? null,
              topic,
            },
          }
        );
        if (isRecord(payload) && isRecord(payload.item)) {
          return {
            item: payload.item as unknown as AthenaEffectiveNotificationPreference,
          };
        }
        throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
      },
      async updateMany(query: {
        items: readonly AthenaNotificationPreferenceWriteInput[];
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        return this.applyMany({
          mutations: query.items.map((item) => ({
            ...item,
            operation: "set" as const,
          })),
        });
      },
    },
  };
}

export function createEmbeddedNotificationsModule(input: {
  catalog?: readonly NotificationCatalogEntry[];
  eventStore?: AthenaNotificationEventStore;
  getUserId?: () => string | null | undefined;
  preferenceStore?: NotificationPreferenceStore;
}): AthenaNotificationsModule {
  const catalog = normalizeNotificationCatalog(input.catalog);
  const preferenceStore =
    input.preferenceStore ?? createMemoryNotificationPreferenceStore();
  const eventStore = input.eventStore ?? createMemoryNotificationEventStore();

  return {
    catalog: {
      async list(): Promise<{
        items: readonly NotificationCatalogEntry[];
      }> {
        return { items: requireCatalog(catalog) };
      },
    },
    async list(query?: { unread?: boolean }): Promise<{
      items: AthenaNotificationEvent[];
    }> {
      const userId = input.getUserId?.()?.trim();
      if (!userId) {
        return { items: [] };
      }
      const items = await eventStore.list({
        unread: query?.unread,
        userId,
      });
      return { items };
    },
    async markAllRead(): Promise<{ ok: true }> {
      const userId = requireUserId(input.getUserId);
      await eventStore.markAllRead({ userId });
      return { ok: true };
    },
    async markRead(query: { id: string }): Promise<{ ok: true }> {
      const userId = requireUserId(input.getUserId);
      const ok = await eventStore.markRead({ id: query.id, userId });
      if (!ok) {
        throwNotificationsError(ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND);
      }
      return { ok: true };
    },
    preferences: {
      async applyMany(
        query: AthenaNotificationPreferenceApplyManyInput
      ): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        const resolved = requireCatalog(catalog);
        const userId = requireUserId(input.getUserId);
        return applyNotificationPreferenceMutations({
          catalog: resolved,
          mutations: query.mutations,
          preferenceStore,
          userId,
        });
      },
      async list(query?: { organizationId?: string | null }): Promise<{
        items: AthenaEffectiveNotificationPreference[];
      }> {
        const resolved = requireCatalog(catalog);
        const organizationId = normalizeScope(query?.organizationId);
        const userId = input.getUserId?.()?.trim();
        const overrides = userId
          ? await preferenceStore.list({ organizationId, userId })
          : [];
        return {
          items: resolveEffectiveNotificationPreferences({
            catalog: resolved,
            organizationId,
            overrides,
          }),
        };
      },
      async reset(query: {
        channel: NotificationChannelId;
        organizationId?: string | null;
        topic: string;
      }): Promise<{ item: AthenaEffectiveNotificationPreference }> {
        const resolved = requireCatalog(catalog);
        const topic = requireTopic(resolved, query.topic);
        const channel = requireChannel(resolved, query.channel);
        requirePair(resolved, topic, channel);
        const organizationId = normalizeScope(query.organizationId);
        const userId = requireUserId(input.getUserId);
        await preferenceStore.delete({
          channel,
          organizationId,
          topic,
          userId,
        });
        const overrides = await preferenceStore.list({
          organizationId,
          userId,
        });
        return {
          item: resolveOneEffectivePreference({
            catalog: resolved,
            channel,
            organizationId,
            overrides,
            topic,
          }),
        };
      },
      async resetMany(query: {
        items: readonly {
          channel: NotificationChannelId;
          organizationId?: string | null;
          topic: string;
        }[];
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        const mutations: AthenaNotificationPreferenceMutation[] =
          query.items.map((item) => ({
            channel: item.channel,
            operation: "reset",
            organizationId: item.organizationId,
            topic: item.topic,
          }));
        return this.applyMany({ mutations });
      },
      async setChannel(query: {
        channel: NotificationChannelId;
        enabled: boolean;
        organizationId?: string | null;
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        const resolved = requireCatalog(catalog);
        const channel = requireChannel(resolved, query.channel);
        const organizationId = normalizeScope(query.organizationId);
        const userId = requireUserId(input.getUserId);
        const overrides = await preferenceStore.list({
          organizationId,
          userId,
        });
        const writes: NotificationPreferenceUpsertInput[] = resolved
          .filter((entry) => entry.channel === channel)
          .map((entry) => {
            const existing = overrides.find(
              (row) => row.topic === entry.topic && row.channel === channel
            );
            return {
              channel,
              digest: existing?.digest ?? null,
              enabled: query.enabled,
              organizationId,
              topic: entry.topic,
              userId,
            };
          });
        await preferenceStore.upsertMany(writes);
        const nextOverrides = await preferenceStore.list({
          organizationId,
          userId,
        });
        const items = resolveEffectiveNotificationPreferences({
          catalog: resolved,
          organizationId,
          overrides: nextOverrides,
        }).filter((item) => item.channel === channel);
        return { items };
      },
      async update(query: {
        channel: NotificationChannelId;
        digest?: NotificationDigest | null;
        enabled: boolean;
        organizationId?: string | null;
        topic: string;
      }): Promise<{ item: AthenaEffectiveNotificationPreference }> {
        const resolved = requireCatalog(catalog);
        const topic = requireTopic(resolved, query.topic);
        const channel = requireChannel(resolved, query.channel);
        requirePair(resolved, topic, channel);
        const digest = normalizeDigest(query.digest);
        const organizationId = normalizeScope(query.organizationId);
        const userId = requireUserId(input.getUserId);
        await preferenceStore.upsert({
          channel,
          digest,
          enabled: query.enabled,
          organizationId,
          topic,
          userId,
        });
        const overrides = await preferenceStore.list({
          organizationId,
          userId,
        });
        return {
          item: resolveOneEffectivePreference({
            catalog: resolved,
            channel,
            organizationId,
            overrides,
            topic,
          }),
        };
      },
      async updateMany(query: {
        items: readonly AthenaNotificationPreferenceWriteInput[];
      }): Promise<{ items: AthenaEffectiveNotificationPreference[] }> {
        return this.applyMany({
          mutations: query.items.map((item) => ({
            ...item,
            operation: "set" as const,
          })),
        });
      },
    },
  };
}

export function createNotificationsModule(
  input: CreateNotificationsModuleInput = {}
): AthenaNotificationsModule {
  if (input.transport === "remote") {
    const remoteRequest = input.remoteRequest;
    if (!remoteRequest) {
      throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
    }
    if (!normalizeNotificationCatalog(input.catalog)) {
      return createUnavailableNotificationsModule();
    }
    return createRemoteNotificationsModule({
      catalog: input.catalog,
      getUserId: input.getUserId,
      remoteDialect: input.remoteDialect,
      request: remoteRequest,
    });
  }
  if (!normalizeNotificationCatalog(input.catalog)) {
    return createUnavailableNotificationsModule();
  }
  return createEmbeddedNotificationsModule({
    catalog: input.catalog,
    eventStore: input.eventStore,
    getUserId: input.getUserId,
    preferenceStore: input.preferenceStore,
  });
}

export function createUnavailableNotificationsModule(): AthenaNotificationsModule {
  const fail = async (): Promise<never> =>
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
  return {
    catalog: {
      list: fail,
    },
    list: fail,
    markAllRead: fail,
    markRead: fail,
    preferences: {
      applyMany: fail,
      list: fail,
      reset: fail,
      resetMany: fail,
      setChannel: fail,
      update: fail,
      updateMany: fail,
    },
  };
}
