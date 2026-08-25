import { ATHENA_AUTH_TABLES } from "../auth/contract/index.ts";
import type {
	NotificationPreferenceListInput,
	NotificationPreferenceSqlExecutor,
	NotificationPreferenceStore,
	NotificationPreferenceUpsertInput,
} from "./store.ts";
import type {
	NotificationChannelId,
	NotificationDigest,
	NotificationPreferenceOverride,
	NotificationPreferenceRow,
	NotificationTopicId,
} from "./types.ts";

const TABLE = ATHENA_AUTH_TABLES.notificationPreferences;

type PreferenceSqlRow = {
	channel: string;
	created_at: Date | string;
	digest: string | null;
	enabled: boolean;
	id: string;
	metadata: unknown;
	organization_id: string | null;
	topic: string;
	updated_at: Date | string;
	user_id: string;
};

function asIso(value: Date | string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return value;
}

function asMetadata(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function hydrate(row: PreferenceSqlRow): NotificationPreferenceRow {
	return {
		channel: row.channel as NotificationChannelId,
		createdAt: asIso(row.created_at),
		digest: row.digest as NotificationDigest | null,
		enabled: row.enabled,
		id: row.id,
		metadata: asMetadata(row.metadata),
		organizationId: row.organization_id,
		topic: row.topic as NotificationTopicId,
		updatedAt: asIso(row.updated_at),
		userId: row.user_id,
	};
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

export function createPostgresNotificationPreferenceStore(
	db: NotificationPreferenceSqlExecutor,
): NotificationPreferenceStore {
	return {
		async list(
			input: NotificationPreferenceListInput,
		): Promise<NotificationPreferenceOverride[]> {
			const result = await db.query(
				`SELECT id, user_id, organization_id, channel, topic, enabled, digest, metadata, created_at, updated_at
				 FROM ${TABLE}
				 WHERE user_id = $1`,
				[input.userId],
			);
			return result.rows.map((row) =>
				toOverride(hydrate(row as PreferenceSqlRow)),
			);
		},
		async upsert(
			input: NotificationPreferenceUpsertInput,
		): Promise<NotificationPreferenceRow> {
			const organizationId = input.organizationId ?? null;
			const digest = input.digest ?? null;
			const result = await db.query(
				organizationId === null
					? `INSERT INTO ${TABLE} (
							id, user_id, organization_id, channel, topic, enabled, digest, metadata
						) VALUES ($1, $2, NULL, $3, $4, $5, $6, '{}'::jsonb)
						ON CONFLICT (user_id, channel, topic) WHERE organization_id IS NULL
						DO UPDATE SET
							enabled = EXCLUDED.enabled,
							digest = EXCLUDED.digest,
							updated_at = NOW()
						RETURNING *`
					: `INSERT INTO ${TABLE} (
							id, user_id, organization_id, channel, topic, enabled, digest, metadata
						) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
						ON CONFLICT (user_id, organization_id, channel, topic) WHERE organization_id IS NOT NULL
						DO UPDATE SET
							enabled = EXCLUDED.enabled,
							digest = EXCLUDED.digest,
							updated_at = NOW()
						RETURNING *`,
				organizationId === null
					? [
							crypto.randomUUID(),
							input.userId,
							input.channel,
							input.topic,
							input.enabled,
							digest,
						]
					: [
							crypto.randomUUID(),
							input.userId,
							organizationId,
							input.channel,
							input.topic,
							input.enabled,
							digest,
						],
			);
			const row = result.rows[0];
			if (!row) {
				return {
					channel: input.channel,
					createdAt: new Date().toISOString(),
					digest,
					enabled: input.enabled,
					id: crypto.randomUUID(),
					metadata: {},
					organizationId,
					topic: input.topic,
					updatedAt: new Date().toISOString(),
					userId: input.userId,
				};
			}
			return hydrate(row as PreferenceSqlRow);
		},
	};
}
