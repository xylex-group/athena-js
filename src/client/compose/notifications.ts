import type { AthenaNotificationEventStore } from "../../notifications/events-store.ts";
import { createMemoryNotificationEventStore } from "../../notifications/events-store.ts";
import { createMemoryNotificationPreferenceStore } from "../../notifications/memory-store.ts";
import type { NotificationPreferenceStore } from "../../notifications/store.ts";

export interface AthenaClientNotificationStores {
  eventStore: AthenaNotificationEventStore;
  preferenceStore: NotificationPreferenceStore;
}

const clientNotificationStores = new WeakMap<
  object,
  AthenaClientNotificationStores
>();
const notificationStoreHoldersByClient = new WeakMap<
  object,
  AthenaClientNotificationStores
>();

export function getOrCreateNotificationStores(
  core: object,
): AthenaClientNotificationStores {
  const existing = clientNotificationStores.get(core);
  if (existing) {
    return existing;
  }
  const holder: AthenaClientNotificationStores = {
    eventStore: createMemoryNotificationEventStore(),
    preferenceStore: createMemoryNotificationPreferenceStore(),
  };
  clientNotificationStores.set(core, holder);
  return holder;
}

export function linkNotificationStores(
  client: object,
  stores: AthenaClientNotificationStores,
): void {
  notificationStoreHoldersByClient.set(client, stores);
}

export function replaceClientNotificationPreferenceStore(
  client: object,
  store: NotificationPreferenceStore,
): void {
  const holder = notificationStoreHoldersByClient.get(client);
  if (holder) {
    holder.preferenceStore = store;
  }
}
