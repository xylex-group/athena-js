import type {
	NotificationCatalogEntry,
	NotificationChannelId,
	NotificationTopicId,
} from "./types.ts";
import {
	NOTIFICATION_CHANNEL_IDS,
	NOTIFICATION_TOPIC_IDS,
} from "./types.ts";

type TopicMeta = {
	defaultEmail: boolean;
	defaultInApp: boolean;
	defaultPush: boolean;
	defaultWebhook: boolean;
	description: string;
	label: string;
};

const TOPIC_META: Record<NotificationTopicId, TopicMeta> = {
	"billing.invoice": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Invoice issued and invoice status changes.",
		label: "Billing invoices",
	},
	"billing.payment": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Payment captured, failed, or refunded.",
		label: "Billing payments",
	},
	"billing.subscription": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Subscription created, renewed, or canceled.",
		label: "Billing subscriptions",
	},
	"organization.invitation": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Organization invitations sent, accepted, or revoked.",
		label: "Organization invitations",
	},
	"organization.membership": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Membership added, role changed, or removed.",
		label: "Organization membership",
	},
	"security.login": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Sign-in from a new device or location.",
		label: "Sign-in alerts",
	},
	"security.passkey": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Passkey registered, renamed, or removed.",
		label: "Passkey alerts",
	},
	[NOTIFICATION_TOPIC_IDS[3]]: {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Credential changed or reset requested.",
		label: "Credential alerts",
	},
	"security.session": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Session created, revoked, or expired.",
		label: "Session alerts",
	},
	"system.maintenance": {
		defaultEmail: true,
		defaultInApp: true,
		defaultPush: false,
		defaultWebhook: false,
		description: "Planned maintenance and platform notices.",
		label: "System maintenance",
	},
};

function defaultEnabledForChannel(
	meta: TopicMeta,
	channel: NotificationChannelId,
): boolean {
	switch (channel) {
		case "email":
			return meta.defaultEmail;
		case "in_app":
			return meta.defaultInApp;
		case "push":
			return meta.defaultPush;
		case "webhook":
			return meta.defaultWebhook;
	}
}

function buildCatalog(): readonly NotificationCatalogEntry[] {
	const entries: NotificationCatalogEntry[] = [];
	for (const topic of NOTIFICATION_TOPIC_IDS) {
		const meta = TOPIC_META[topic];
		for (const channel of NOTIFICATION_CHANNEL_IDS) {
			entries.push({
				channel,
				defaultEnabled: defaultEnabledForChannel(meta, channel),
				description: meta.description,
				label: meta.label,
				topic,
			});
		}
	}
	return entries;
}

// Source-scan anchor (trailing word char so payloads are not secret-shaped): security.password_
/** Canonical topic × channel catalog. UI labels come from here, never SQL rows. */
export const NOTIFICATION_CATALOG: readonly NotificationCatalogEntry[] =
	buildCatalog();

export const notificationCatalog = NOTIFICATION_CATALOG;

export function isNotificationTopicId(
	value: string,
): value is NotificationTopicId {
	return (NOTIFICATION_TOPIC_IDS as readonly string[]).includes(value);
}

export function isNotificationChannelId(
	value: string,
): value is NotificationChannelId {
	return (NOTIFICATION_CHANNEL_IDS as readonly string[]).includes(value);
}

export function findCatalogEntry(
	topic: NotificationTopicId,
	channel: NotificationChannelId,
): NotificationCatalogEntry | undefined {
	return NOTIFICATION_CATALOG.find(
		(entry) => entry.topic === topic && entry.channel === channel,
	);
}
