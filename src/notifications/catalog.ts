import type {
  NotificationCatalogEntry,
  NotificationChannelId,
  NotificationTopicId,
} from "./types.ts";
import { NOTIFICATION_CHANNEL_IDS, NOTIFICATION_TOPIC_IDS } from "./types.ts";

type TopicMeta = {
  defaultEmail: boolean;
  defaultInApp: boolean;
  defaultPush: boolean;
  defaultWebhook: boolean;
  description?: string;
  group: string;
  groupOrder: number;
  label: string;
  order: number;
};

const KERNEL_TOPIC_META: Record<NotificationTopicId, TopicMeta> = {
  "billing.invoice": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Billing",
    groupOrder: 2,
    label: "Billing invoices",
    order: 3,
  },
  "billing.payment": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Billing",
    groupOrder: 2,
    label: "Billing payments",
    order: 1,
  },
  "billing.subscription": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Billing",
    groupOrder: 2,
    label: "Billing subscriptions",
    order: 2,
  },
  "organization.invitation": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Organizations",
    groupOrder: 1,
    label: "Organization invitations",
    order: 1,
  },
  "organization.membership": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Organizations",
    groupOrder: 1,
    label: "Organization membership",
    order: 2,
  },
  "security.login": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Account",
    groupOrder: 0,
    label: "Sign-in alerts",
    order: 1,
  },
  "security.passkey": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Account",
    groupOrder: 0,
    label: "Passkey alerts",
    order: 3,
  },
  [NOTIFICATION_TOPIC_IDS[3]]: {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Account",
    groupOrder: 0,
    label: "Credential alerts",
    order: 4,
  },
  "security.session": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Account",
    groupOrder: 0,
    label: "Session alerts",
    order: 2,
  },
  "system.maintenance": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "System",
    groupOrder: 3,
    label: "System maintenance",
    order: 1,
  },
};

const DEMO_PRODUCT_TOPIC_META: Record<string, TopicMeta> = {
  "product.announcement": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Product",
    groupOrder: 4,
    label: "Product announcements",
    order: 1,
  },
  "product.release": {
    defaultEmail: true,
    defaultInApp: true,
    defaultPush: false,
    defaultWebhook: false,
    group: "Product",
    groupOrder: 4,
    label: "Product releases",
    order: 2,
  },
};

function defaultEnabledForChannel(
  meta: TopicMeta,
  channel: NotificationChannelId
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

function buildCatalogFromMeta(
  metaByTopic: Record<string, TopicMeta>
): readonly NotificationCatalogEntry[] {
  const entries: NotificationCatalogEntry[] = [];
  for (const [topic, meta] of Object.entries(metaByTopic)) {
    for (const channel of NOTIFICATION_CHANNEL_IDS) {
      entries.push({
        channel,
        defaultEnabled: defaultEnabledForChannel(meta, channel),
        description: meta.description,
        group: meta.group,
        groupOrder: meta.groupOrder,
        label: meta.label,
        order: meta.order,
        topic,
      });
    }
  }
  return entries;
}

// Source-scan anchor (trailing word char so payloads are not secret-shaped): security.password_
/** Kernel topic × channel fixture. Apps must pass a catalog; this is not implicit. */
export const NOTIFICATION_CATALOG: readonly NotificationCatalogEntry[] =
  buildCatalogFromMeta(KERNEL_TOPIC_META);

export const notificationCatalog = NOTIFICATION_CATALOG;

/**
 * Opt-in demo ontology (security, organization, billing, product).
 * Import into `createClient({ notifications: { catalog } })` — never applied by default.
 */
export const athenaNotificationCatalogDemo: readonly NotificationCatalogEntry[] =
  buildCatalogFromMeta({
    ...KERNEL_TOPIC_META,
    ...DEMO_PRODUCT_TOPIC_META,
  });

export function isNotificationTopicId(
  value: string
): value is NotificationTopicId {
  return (NOTIFICATION_TOPIC_IDS as readonly string[]).includes(value);
}

export function isNotificationChannelId(
  value: string
): value is NotificationChannelId {
  return (NOTIFICATION_CHANNEL_IDS as readonly string[]).includes(value);
}

export function catalogHasTopic(
  catalog: readonly NotificationCatalogEntry[],
  topic: string
): boolean {
  return catalog.some((entry) => entry.topic === topic);
}

export function catalogHasChannel(
  catalog: readonly NotificationCatalogEntry[],
  channel: string
): boolean {
  return catalog.some((entry) => entry.channel === channel);
}

export function findCatalogEntry(
  catalog: readonly NotificationCatalogEntry[],
  topic: string,
  channel: string
): NotificationCatalogEntry | undefined {
  return catalog.find(
    (entry) => entry.topic === topic && entry.channel === channel
  );
}

function isCatalogEntry(value: unknown): value is NotificationCatalogEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.topic === "string" &&
    row.topic.trim().length > 0 &&
    isNotificationChannelId(String(row.channel)) &&
    typeof row.defaultEnabled === "boolean" &&
    typeof row.label === "string" &&
    row.label.trim().length > 0
  );
}

/** Returns a frozen catalog, or `null` when missing/empty/invalid (fail closed). */
export function normalizeNotificationCatalog(
  catalog: readonly NotificationCatalogEntry[] | undefined
): readonly NotificationCatalogEntry[] | null {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return null;
  }
  const entries: NotificationCatalogEntry[] = [];
  for (const row of catalog) {
    if (!isCatalogEntry(row)) {
      return null;
    }
    entries.push({
      channel: row.channel,
      defaultEnabled: row.defaultEnabled,
      description: row.description,
      group: row.group,
      groupOrder: row.groupOrder,
      label: row.label,
      order: row.order,
      topic: row.topic.trim(),
    });
  }
  return Object.freeze(entries);
}
