import type {
	NotificationChannelId,
	NotificationDigest,
	NotificationPreferenceOverride,
	NotificationPreferenceRow,
	NotificationTopicId,
} from "./types.ts";

export type NotificationPreferenceListInput = {
	organizationId?: string | null;
	userId: string;
};

export type NotificationPreferenceUpsertInput = {
	channel: NotificationChannelId;
	digest?: NotificationDigest | null;
	enabled: boolean;
	organizationId?: string | null;
	topic: NotificationTopicId;
	userId: string;
};

export type NotificationPreferenceStore = {
	list: (
		input: NotificationPreferenceListInput,
	) => Promise<NotificationPreferenceOverride[]>;
	upsert: (
		input: NotificationPreferenceUpsertInput,
	) => Promise<NotificationPreferenceRow>;
};

export type NotificationPreferenceSqlExecutor = {
	query: (
		text: string,
		values?: unknown[],
	) => Promise<{ rows: Record<string, unknown>[] }>;
};

export function preferenceScopeKey(
	userId: string,
	organizationId: string | null,
	channel: string,
	topic: string,
): string {
	const org = organizationId === null ? "" : organizationId;
	return `${userId}\u0000${org}\u0000${channel}\u0000${topic}`;
}
