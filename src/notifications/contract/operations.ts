export const NOTIFICATION_OPERATIONS = {
  catalogList: "notifications.catalog.list",
  eventsList: "notifications.events.list",
  eventsMarkAllRead: "notifications.events.markAllRead",
  eventsMarkRead: "notifications.events.markRead",
  preferencesApplyMany: "notifications.preferences.applyMany",
  preferencesList: "notifications.preferences.list",
  preferencesReset: "notifications.preferences.reset",
  preferencesResetMany: "notifications.preferences.resetMany",
  preferencesSetChannel: "notifications.preferences.setChannel",
  preferencesUpdate: "notifications.preferences.update",
  preferencesUpdateMany: "notifications.preferences.updateMany",
} as const;

export type NotificationOperation =
  (typeof NOTIFICATION_OPERATIONS)[keyof typeof NOTIFICATION_OPERATIONS];

const OPERATION_VALUES = new Set<string>(
  Object.values(NOTIFICATION_OPERATIONS)
);

export function isNotificationOperation(
  value: string
): value is NotificationOperation {
  return OPERATION_VALUES.has(value);
}
