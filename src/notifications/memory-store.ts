import { preferenceScopeKey } from "./store.ts";
import type {
	NotificationPreferenceListInput,
	NotificationPreferenceStore,
	NotificationPreferenceUpsertInput,
} from "./store.ts";
import type {
	NotificationPreferenceOverride,
	NotificationPreferenceRow,
} from "./types.ts";

function nowIso(): string {
	return new Date().toISOString();
}

function newRowId(): string {
	return crypto.randomUUID();
}

function toOverride(
	row: NotificationPreferenceRow,
): NotificationPreferenceOverride {
	return {
		channel: row.channel,
		digest: row.digest,
		enabled: row.enabled,
		organizationId: row.organizationId,
		topic: row.topic,
		userId: row.userId,
	};
}

export function createMemoryNotificationPreferenceStore(): NotificationPreferenceStore {
	const rows = new Map<string, NotificationPreferenceRow>();

	return {
		async list(
			input: NotificationPreferenceListInput,
		): Promise<NotificationPreferenceOverride[]> {
			const out: NotificationPreferenceOverride[] = [];
			for (const row of rows.values()) {
				if (row.userId !== input.userId) {
					continue;
				}
				out.push(toOverride(row));
			}
			return out;
		},
		async upsert(
			input: NotificationPreferenceUpsertInput,
		): Promise<NotificationPreferenceRow> {
			const organizationId = input.organizationId ?? null;
			const key = preferenceScopeKey(
				input.userId,
				organizationId,
				input.channel,
				input.topic,
			);
			const existing = rows.get(key);
			const stamp = nowIso();
			const next: NotificationPreferenceRow = {
				channel: input.channel,
				createdAt: existing?.createdAt ?? stamp,
				digest: input.digest ?? null,
				enabled: input.enabled,
				id: existing?.id ?? newRowId(),
				metadata: existing?.metadata ?? {},
				organizationId,
				topic: input.topic,
				updatedAt: stamp,
				userId: input.userId,
			};
			rows.set(key, next);
			return next;
		},
	};
}
