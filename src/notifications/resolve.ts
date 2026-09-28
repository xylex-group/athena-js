import { findCatalogEntry } from "./catalog.ts";
import {
  ATHENA_NOTIFICATIONS_UNAVAILABLE,
  throwNotificationsError,
} from "./errors.ts";
import type {
  AthenaEffectiveNotificationPreference,
  NotificationCatalogEntry,
  NotificationChannelId,
  NotificationDigest,
  NotificationPreferenceOverride,
  NotificationPreferenceSource,
} from "./types.ts";

function isCatalogArray(
  value: unknown
): value is readonly NotificationCatalogEntry[] {
  return Array.isArray(value) && value.length > 0;
}

function isUserScope(organizationId: string | null | undefined): boolean {
  return organizationId === null || organizationId === undefined;
}

function overrideMatchesScope(
  override: NotificationPreferenceOverride,
  organizationId: string | null | undefined
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
  topic: string,
  channel: NotificationChannelId,
  organizationId: string | null | undefined
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
  if (!isCatalogArray(input.catalog)) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
  }
  const catalog = input.catalog;
  const items: AthenaEffectiveNotificationPreference[] = [];
  for (const entry of catalog) {
    const matched = pickOverride(
      input.overrides,
      entry.topic,
      entry.channel,
      input.organizationId
    );
    items.push({
      channel: entry.channel,
      description: entry.description ?? entry.label,
      digest: matched?.digest ?? null,
      enabled: matched?.enabled ?? entry.defaultEnabled,
      group: entry.group,
      groupOrder: entry.groupOrder,
      label: entry.label,
      order: entry.order,
      source: matched?.source ?? "catalog",
      topic: entry.topic,
    });
  }
  return items;
}

export function resolveOneEffectivePreference(input: {
  catalog: readonly NotificationCatalogEntry[];
  channel: NotificationChannelId;
  organizationId?: string | null;
  overrides: readonly NotificationPreferenceOverride[];
  topic: string;
}): AthenaEffectiveNotificationPreference {
  const entry = findCatalogEntry(input.catalog, input.topic, input.channel);
  if (!entry) {
    throwNotificationsError(ATHENA_NOTIFICATIONS_UNAVAILABLE);
  }
  const matched = pickOverride(
    input.overrides,
    input.topic,
    input.channel,
    input.organizationId
  );
  return {
    channel: entry.channel,
    description: entry.description ?? entry.label,
    digest: matched?.digest ?? null,
    enabled: matched?.enabled ?? entry.defaultEnabled,
    group: entry.group,
    groupOrder: entry.groupOrder,
    label: entry.label,
    order: entry.order,
    source: matched?.source ?? "catalog",
    topic: entry.topic,
  };
}
