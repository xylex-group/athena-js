import type { AthenaNotificationEvent, NotificationTopicId } from "./types.ts";

export type AthenaNotificationEventStore = {
	list: (input: {
		unread?: boolean;
		userId: string;
	}) => Promise<AthenaNotificationEvent[]>;
	markAllRead: (input: { userId: string }) => Promise<void>;
	markRead: (input: { id: string; userId: string }) => Promise<boolean>;
};

type StoredEvent = AthenaNotificationEvent & { userId: string };

export function createMemoryNotificationEventStore(): AthenaNotificationEventStore {
	const events = new Map<string, StoredEvent>();

	return {
		async list(input: {
			unread?: boolean;
			userId: string;
		}): Promise<AthenaNotificationEvent[]> {
			const items: AthenaNotificationEvent[] = [];
			for (const event of events.values()) {
				if (event.userId !== input.userId) {
					continue;
				}
				if (input.unread === true && event.readAt !== null) {
					continue;
				}
				items.push({
					body: event.body,
					createdAt: event.createdAt,
					id: event.id,
					readAt: event.readAt,
					title: event.title,
					topic: event.topic,
				});
			}
			items.sort((left, right) =>
				left.createdAt < right.createdAt ? 1 : -1,
			);
			return items;
		},
		async markAllRead(input: { userId: string }): Promise<void> {
			const stamp = new Date().toISOString();
			for (const event of events.values()) {
				if (event.userId === input.userId && event.readAt === null) {
					event.readAt = stamp;
				}
			}
		},
		async markRead(input: { id: string; userId: string }): Promise<boolean> {
			const event = events.get(input.id);
			if (!event || event.userId !== input.userId) {
				return false;
			}
			event.readAt = event.readAt ?? new Date().toISOString();
			return true;
		},
	};
}

export function seedMemoryNotificationEvent(
	store: AthenaNotificationEventStore,
	event: StoredEvent,
): void {
	const memory = store as unknown as {
		events?: Map<string, StoredEvent>;
	};
	void memory;
	if (store instanceof Object) {
		const bag = store as unknown as { __seed?: (row: StoredEvent) => void };
		if (typeof bag.__seed === "function") {
			bag.__seed(event);
		}
	}
}

/** Test helper: Memory inbox seed. */
export function createMemoryNotificationEventStoreWithSeed(
	seed: readonly StoredEvent[] = [],
): AthenaNotificationEventStore {
	const events = new Map<string, StoredEvent>();
	for (const row of seed) {
		events.set(row.id, { ...row });
	}
	return {
		async list(input: {
			unread?: boolean;
			userId: string;
		}): Promise<AthenaNotificationEvent[]> {
			const items: AthenaNotificationEvent[] = [];
			for (const event of events.values()) {
				if (event.userId !== input.userId) {
					continue;
				}
				if (input.unread === true && event.readAt !== null) {
					continue;
				}
				items.push({
					body: event.body,
					createdAt: event.createdAt,
					id: event.id,
					readAt: event.readAt,
					title: event.title,
					topic: event.topic as NotificationTopicId,
				});
			}
			return items;
		},
		async markAllRead(input: { userId: string }): Promise<void> {
			const stamp = new Date().toISOString();
			for (const event of events.values()) {
				if (event.userId === input.userId && event.readAt === null) {
					event.readAt = stamp;
				}
			}
		},
		async markRead(input: { id: string; userId: string }): Promise<boolean> {
			const event = events.get(input.id);
			if (!event || event.userId !== input.userId) {
				return false;
			}
			event.readAt = event.readAt ?? new Date().toISOString();
			return true;
		},
	};
}
