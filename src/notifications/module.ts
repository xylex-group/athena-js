import {
	isNotificationChannelId,
	isNotificationTopicId,
	NOTIFICATION_CATALOG,
} from "./catalog.ts";
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
import { createMemoryNotificationEventStore } from "./events-store.ts";
import type { AthenaNotificationEventStore } from "./events-store.ts";
import { createMemoryNotificationPreferenceStore } from "./memory-store.ts";
import {
	resolveEffectiveNotificationPreferences,
	resolveOneEffectivePreference,
} from "./resolve.ts";
import type { NotificationPreferenceStore } from "./store.ts";
import { NOTIFICATION_DIGEST_VALUES } from "./types.ts";
import type {
	AthenaEffectiveNotificationPreference,
	AthenaNotificationEvent,
	AthenaNotificationsModule,
	NotificationChannelId,
	NotificationDigest,
	NotificationTopicId,
} from "./types.ts";

export type NotificationsTransportKind = "embedded" | "remote";

/** Public contract: preferences.list / preferences.update, list, markRead, markAllRead. */

export type NotificationsGatewayQuery = {
	[key: string]: string | number | boolean | null | undefined;
};

export type NotificationsGatewayRequest = (input: {
	body?: Record<string, unknown>;
	method: "GET" | "POST";
	path: string;
	query?: NotificationsGatewayQuery;
}) => Promise<unknown>;

export type CreateNotificationsModuleInput = {
	eventStore?: AthenaNotificationEventStore;
	getUserId?: () => string | null | undefined;
	preferenceStore?: NotificationPreferenceStore;
	/** Remote gateway HTTP adapter for contract parity with embedded. */
	remoteRequest?: NotificationsGatewayRequest;
	transport?: NotificationsTransportKind;
};

function normalizeScope(
	organizationId: string | null | undefined,
): string | null {
	if (organizationId === undefined || organizationId === null) {
		return null;
	}
	if (organizationId.length === 0) {
		throwNotificationsError(ATHENA_NOTIFICATIONS_SCOPE_INVALID);
	}
	return organizationId;
}

function requireTopic(topic: string): NotificationTopicId {
	if (!isNotificationTopicId(topic)) {
		throwNotificationsError(ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN);
	}
	return topic;
}

function requireChannel(channel: string): NotificationChannelId {
	if (!isNotificationChannelId(channel)) {
		throwNotificationsError(ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN);
	}
	return channel;
}

function normalizeDigest(
	digest: NotificationDigest | null | undefined,
): NotificationDigest | null {
	if (digest === undefined || digest === null) {
		return null;
	}
	if (
		!(NOTIFICATION_DIGEST_VALUES as readonly string[]).includes(digest)
	) {
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
	method: "GET" | "POST",
	path: string,
	options?: {
		body?: Record<string, unknown>;
		query?: NotificationsGatewayQuery;
	},
): Promise<unknown> {
	if (method === "GET") {
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
	getUserId?: () => string | null | undefined;
	request: NotificationsGatewayRequest;
}): AthenaNotificationsModule {
	const request = input.request;
	return {
		async list(query?: { unread?: boolean }): Promise<{
			items: AthenaNotificationEvent[];
		}> {
			requireUserId(input.getUserId);
			const payload = await remoteJson(
				request,
				"GET",
				"/notifications/v1/events",
				query?.unread === undefined
					? undefined
					: { query: { unread: query.unread } },
			);
			return { items: asItems<AthenaNotificationEvent>(payload) };
		},
		async markAllRead(): Promise<{ ok: true }> {
			requireUserId(input.getUserId);
			await remoteJson(request, "POST", "/notifications/v1/events/read-all");
			return { ok: true };
		},
		async markRead(query: { id: string }): Promise<{ ok: true }> {
			requireUserId(input.getUserId);
			await remoteJson(request, "POST", "/notifications/v1/events/read", {
				body: {
					id: query.id,
				},
			});
			return { ok: true };
		},
		preferences: {
			async list(query?: { organizationId?: string | null }): Promise<{
				items: AthenaEffectiveNotificationPreference[];
			}> {
				const organizationId = normalizeScope(query?.organizationId);
				const payload = await remoteJson(
					request,
					"GET",
					"/notifications/v1/preferences",
					organizationId === null
						? undefined
						: { query: { organizationId } },
				);
				return {
					items: asItems<AthenaEffectiveNotificationPreference>(payload),
				};
			},
			async update(query: {
				channel: NotificationChannelId;
				digest?: NotificationDigest | null;
				enabled: boolean;
				organizationId?: string | null;
				topic: NotificationTopicId;
			}): Promise<{ item: AthenaEffectiveNotificationPreference }> {
				requireTopic(query.topic);
				requireChannel(query.channel);
				normalizeDigest(query.digest);
				normalizeScope(query.organizationId);
				requireUserId(input.getUserId);
				const payload = await remoteJson(
					request,
					"POST",
					"/notifications/v1/preferences",
					{
						body: {
							channel: query.channel,
							digest: query.digest ?? null,
							enabled: query.enabled,
							organizationId: query.organizationId ?? null,
							topic: query.topic,
						},
					},
				);
				if (isRecord(payload) && isRecord(payload.item)) {
					return {
						item: payload.item as unknown as AthenaEffectiveNotificationPreference,
					};
				}
				throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
			},
		},
	};
}

export function createEmbeddedNotificationsModule(input: {
	eventStore?: AthenaNotificationEventStore;
	getUserId?: () => string | null | undefined;
	preferenceStore?: NotificationPreferenceStore;
}): AthenaNotificationsModule {
	const preferenceStore =
		input.preferenceStore ?? createMemoryNotificationPreferenceStore();
	const eventStore =
		input.eventStore ?? createMemoryNotificationEventStore();

	return {
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
			async list(query?: { organizationId?: string | null }): Promise<{
				items: AthenaEffectiveNotificationPreference[];
			}> {
				const organizationId = normalizeScope(query?.organizationId);
				const userId = input.getUserId?.()?.trim();
				const overrides = userId
					? await preferenceStore.list({ organizationId, userId })
					: [];
				return {
					items: resolveEffectiveNotificationPreferences({
						catalog: NOTIFICATION_CATALOG,
						organizationId,
						overrides,
					}),
				};
			},
			async update(query: {
				channel: NotificationChannelId;
				digest?: NotificationDigest | null;
				enabled: boolean;
				organizationId?: string | null;
				topic: NotificationTopicId;
			}): Promise<{ item: AthenaEffectiveNotificationPreference }> {
				const topic = requireTopic(query.topic);
				const channel = requireChannel(query.channel);
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
						channel,
						organizationId,
						overrides,
						topic,
					}),
				};
			},
		},
	};
}

export function createNotificationsModule(
	input: CreateNotificationsModuleInput = {},
): AthenaNotificationsModule {
	if (input.transport === "remote") {
		const remoteRequest = input.remoteRequest;
		if (!remoteRequest) {
			throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
		}
		return createRemoteNotificationsModule({
			getUserId: input.getUserId,
			request: remoteRequest,
		});
	}
	return createEmbeddedNotificationsModule({
		eventStore: input.eventStore,
		getUserId: input.getUserId,
		preferenceStore: input.preferenceStore,
	});
}

export function createUnavailableNotificationsModule(): AthenaNotificationsModule {
	const fail = (): never =>
		throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
	return {
		list: fail,
		markAllRead: fail,
		markRead: fail,
		preferences: {
			list: fail,
			update: fail,
		},
	};
}
