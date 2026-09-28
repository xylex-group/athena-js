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
  description?: string;
  group?: string;
  groupOrder?: number;
  label: string;
  order?: number;
  topic: string;
};

export type AthenaNotificationsConfig = {
  catalog: readonly NotificationCatalogEntry[];
};

export type NotificationPreferenceOverride = {
  channel: NotificationChannelId;
  digest?: NotificationDigest | null;
  enabled: boolean;
  organizationId?: string | null;
  topic: string;
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
  topic: string;
  updatedAt: string;
  userId: string;
};

export type AthenaEffectiveNotificationPreference = {
  channel: NotificationChannelId;
  description: string;
  digest: NotificationDigest | null;
  enabled: boolean;
  group?: string;
  groupOrder?: number;
  label: string;
  order?: number;
  source: NotificationPreferenceSource;
  topic: string;
};

export type AthenaNotificationEvent = {
  body: string;
  createdAt: string;
  id: string;
  readAt: string | null;
  title: string;
  topic: string;
};

export type AthenaNotificationPreferenceWriteInput = {
  channel: NotificationChannelId;
  digest?: NotificationDigest | null;
  enabled: boolean;
  organizationId?: string | null;
  topic: string;
};

export type AthenaNotificationPreferenceResetInput = {
  channel: NotificationChannelId;
  organizationId?: string | null;
  topic: string;
};

export type AthenaNotificationPreferenceSetChannelInput = {
  channel: NotificationChannelId;
  enabled: boolean;
  organizationId?: string | null;
};

export type AthenaNotificationPreferenceUpdateManyInput = {
  items: readonly AthenaNotificationPreferenceWriteInput[];
};

export type AthenaNotificationPreferenceResetManyInput = {
  items: readonly AthenaNotificationPreferenceResetInput[];
};

export type AthenaNotificationPreferenceMutation =
  | ({
      operation: "set";
    } & AthenaNotificationPreferenceWriteInput)
  | ({
      operation: "reset";
    } & AthenaNotificationPreferenceResetInput);

export type AthenaNotificationPreferenceApplyManyInput = {
  mutations: readonly AthenaNotificationPreferenceMutation[];
};

export type AthenaNotificationsModule = {
  catalog: {
    list: () => Promise<{ items: readonly NotificationCatalogEntry[] }>;
  };
  list: (input?: { unread?: boolean }) => Promise<{
    items: AthenaNotificationEvent[];
  }>;
  markAllRead: () => Promise<{ ok: true }>;
  markRead: (input: { id: string }) => Promise<{ ok: true }>;
  preferences: {
    applyMany: (
      input: AthenaNotificationPreferenceApplyManyInput
    ) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
    list: (input?: {
      organizationId?: string | null;
    }) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
    reset: (
      input: AthenaNotificationPreferenceResetInput
    ) => Promise<{ item: AthenaEffectiveNotificationPreference }>;
    resetMany: (
      input: AthenaNotificationPreferenceResetManyInput
    ) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
    setChannel: (
      input: AthenaNotificationPreferenceSetChannelInput
    ) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
    update: (
      input: AthenaNotificationPreferenceWriteInput
    ) => Promise<{ item: AthenaEffectiveNotificationPreference }>;
    updateMany: (
      input: AthenaNotificationPreferenceUpdateManyInput
    ) => Promise<{ items: AthenaEffectiveNotificationPreference[] }>;
  };
};
