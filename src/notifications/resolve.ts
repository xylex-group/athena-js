import { findCatalogEntry, NOTIFICATION_CATALOG } from "./catalog.ts";
import type {
	AthenaEffectiveNotificationPreference,
	NotificationCatalogEntry,
	NotificationChannelId,
	NotificationDigest,
	NotificationPreferenceOverride,
	NotificationPreferenceSource,
	NotificationTopicId,
} from "./types.ts";

function isCatalogArray(
	value: unknown,
): value is readonly NotificationCatalogEntry[] {
	return Array.isArray(value);
}

function isUserScope(organizationId: string | null | undefined): boolean {
	return organizationId === null || organizationId === undefined;
}

function overrideMatchesScope(
	override: NotificationPreferenceOverride,
	organizationId: string | null | undefined,
): NotificationPreferenceSource | null {
	const overrideOrg = override.organizationId ?? null;
	if (overrideOrg === null) {
		return "user";
	}
	if (!isUserScope(organizationId) && overrideOrg === organizationId) {
		return "organization";
	}
	return null;
}

function pickOverride(
	overrides: readonly NotificationPreferenceOverride[],
	topic: NotificationTopicId,
	channel: NotificationChannelId,
	organizationId: string | null | undefined,
): {
	digest: NotificationDigest | null;
	enabled: boolean;
	source: NotificationPreferenceSource;
} | null {
	let userMatch: NotificationPreferenceOverride | undefined;
	let orgMatch: NotificationPreferenceOverride | undefined;
	for (const override of overrides) {
		if (override.topic !== topic || override.channel !== channel) {
			continue;
		}
		const source = overrideMatchesScope(override, organizationId);
		if (source === "organization") {
			orgMatch = override;
		} else if (source === "user") {
			userMatch = override;
		}
	}
	if (!isUserScope(organizationId) && orgMatch) {
		return {
			digest: orgMatch.digest ?? null,
			enabled: orgMatch.enabled,
			source: "organization",
		};
	}
	if (userMatch) {
		return {
			digest: userMatch.digest ?? null,
			enabled: userMatch.enabled,
			source: "user",
		};
	}
	return null;
}

export function resolveEffectiveNotificationPreferences(input: {
	catalog?: unknown;
	organizationId?: string | null;
	overrides: readonly NotificationPreferenceOverride[];
}): AthenaEffectiveNotificationPreference[] {
	const catalog = isCatalogArray(input.catalog)
		? input.catalog
		: NOTIFICATION_CATALOG;
	const items: AthenaEffectiveNotificationPreference[] = [];
	for (const entry of catalog) {
		const matched = pickOverride(
			input.overrides,
			entry.topic,
			entry.channel,
			input.organizationId,
		);
		items.push({
			channel: entry.channel,
			description: entry.description,
			digest: matched?.digest ?? null,
			enabled: matched?.enabled ?? entry.defaultEnabled,
			label: entry.label,
			source: matched?.source ?? "catalog",
			topic: entry.topic,
		});
	}
	return items;
}

export function resolveOneEffectivePreference(input: {
	channel: NotificationChannelId;
	organizationId?: string | null;
	overrides: readonly NotificationPreferenceOverride[];
	topic: NotificationTopicId;
}): AthenaEffectiveNotificationPreference {
	const entry = findCatalogEntry(input.topic, input.channel);
	const fallback: NotificationCatalogEntry = entry ?? {
		channel: input.channel,
		defaultEnabled: true,
		description: input.topic,
		label: input.topic,
		topic: input.topic,
	};
	const matched = pickOverride(
		input.overrides,
		input.topic,
		input.channel,
		input.organizationId,
	);
	return {
		channel: fallback.channel,
		description: fallback.description,
		digest: matched?.digest ?? null,
		enabled: matched?.enabled ?? fallback.defaultEnabled,
		label: fallback.label,
		source: matched?.source ?? "catalog",
		topic: fallback.topic,
	};
}
