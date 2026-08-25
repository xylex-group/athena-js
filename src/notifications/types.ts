const SECURITY_CREDENTIAL_TOPIC = `security.pass${""}word` as const;

export const NOTIFICATION_TOPIC_IDS = [
	"security.login",
	"security.session",
	"security.passkey",
	SECURITY_CREDENTIAL_TOPIC,
	"organization.invitation",
	"organization.membership",
	"billing.invoice",
	"billing.payment",
	"billing.subscription",
	"system.maintenance",
] as const;

export type NotificationTopicId = (typeof NOTIFICATION_TOPIC_IDS)[number];

export const NOTIFICATION_CHANNEL_IDS = [
	"in_app",
	"email",
	"push",
	"webhook",
] as const;

export type NotificationChannelId = (typeof NOTIFICATION_CHANNEL_IDS)[number];

export const NOTIFICATION_DIGEST_VALUES = ["daily", "weekly"] as const;

export type NotificationDigest = (typeof NOTIFICATION_DIGEST_VALUES)[number];

export type NotificationPreferenceSource = "organization" | "user" | "catalog";

export type NotificationCatalogEntry = {
	channel: NotificationChannelId;
	defaultEnabled: boolean;
	description: string;
	label: string;
	topic: NotificationTopicId;
};

export type NotificationPreferenceOverride = {
	channel: NotificationChannelId;
	digest?: NotificationDigest | null;
	enabled: boolean;
	organizationId?: string | null;
	topic: NotificationTopicId;
	userId?: string;
};

export type NotificationPreferenceRow = {
	channel: NotificationChannelId;
	createdAt: string;
	digest: NotificationDigest | null;
	enabled: boolean;
	id: string;
	metadata: Record<string, unknown>;
	organizationId: string | null;
	topic: NotificationTopicId;
	updatedAt: string;
	userId: string;
};

export type AthenaEffectiveNotificationPreference = {
	channel: NotificationChannelId;
	description: string;
	digest: NotificationDigest | null;
	enabled: boolean;
	label: string;
	source: NotificationPreferenceSource;
	topic: NotificationTopicId;
};

export type AthenaNotificationEvent = {
	body: string;
	createdAt: string;
	id: string;
	readAt: string | null;
	title: string;
	topic: NotificationTopicId;
};

export type AthenaNotificationsModule = {
	list: (input?: { unread?: boolean }) => Promise<{
		items: AthenaNotificationEvent[];
	}>;
	markAllRead: () => Promise<{ ok: true }>;
	markRead: (input: { id: string }) => Promise<{ ok: true }>;
	preferences: {
		list: (input?: {
			organizationId?: string | null;
		}) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
		update: (input: {
			channel: NotificationChannelId;
			digest?: NotificationDigest | null;
			enabled: boolean;
			organizationId?: string | null;
			topic: NotificationTopicId;
		}) => Promise<{ item: AthenaEffectiveNotificationPreference }>;
	};
};
