import { ATHENA_AUTH_TABLES } from "../auth/contract/index.ts";
import type {
  NotificationPreferenceApplyManyResult,
  NotificationPreferenceDeleteInput,
  NotificationPreferenceListInput,
  NotificationPreferenceSqlExecutor,
  NotificationPreferenceStore,
  NotificationPreferenceStoreMutation,
  NotificationPreferenceUpsertInput,
} from "./store.ts";
import { assertSinglePreferenceScope } from "./store.ts";
import type {
  NotificationChannelId,
  NotificationDigest,
  NotificationPreferenceOverride,
  NotificationPreferenceRow,
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
    topic: row.topic,
    updatedAt: asIso(row.updated_at),
    userId: row.user_id,
  };
}

function toOverride(
  row: NotificationPreferenceRow
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

async function deleteOne(
  db: NotificationPreferenceSqlExecutor,
  input: NotificationPreferenceDeleteInput
): Promise<boolean> {
  const organizationId = input.organizationId ?? null;
  const result = await db.query(
    organizationId === null
      ? `DELETE FROM ${TABLE}
				 WHERE user_id = $1 AND channel = $2 AND topic = $3 AND organization_id IS NULL
				 RETURNING id`
      : `DELETE FROM ${TABLE}
				 WHERE user_id = $1 AND channel = $2 AND topic = $3 AND organization_id = $4
				 RETURNING id`,
    organizationId === null
      ? [input.userId, input.channel, input.topic]
      : [input.userId, input.channel, input.topic, organizationId]
  );
  return result.rows.length > 0;
}

async function deleteManyRows(
  db: NotificationPreferenceSqlExecutor,
  inputs: readonly NotificationPreferenceDeleteInput[]
): Promise<number> {
  if (inputs.length === 0) {
    return 0;
  }
  const scope = assertSinglePreferenceScope(inputs);
  if (!scope) {
    return 0;
  }
  if (inputs.length === 1) {
    const first = inputs[0];
    if (!first) {
      return 0;
    }
    return (await deleteOne(db, first)) ? 1 : 0;
  }
  const values: unknown[] = [scope.userId];
  const tuples: string[] = [];
  let param = 2;
  for (const input of inputs) {
    tuples.push(`($${param++}::text, $${param++}::text)`);
    values.push(input.channel, input.topic);
  }
  if (scope.organizationId === null) {
    const result = await db.query(
      `DELETE FROM ${TABLE} AS p
			 USING (VALUES ${tuples.join(", ")}) AS target(channel, topic)
			 WHERE p.user_id = $1
			   AND p.organization_id IS NULL
			   AND p.channel = target.channel
			   AND p.topic = target.topic
			 RETURNING p.id`,
      values
    );
    return result.rows.length;
  }
  values.splice(1, 0, scope.organizationId);
  param = 3;
  const orgTuples: string[] = [];
  const orgValues: unknown[] = [scope.userId, scope.organizationId];
  for (const input of inputs) {
    orgTuples.push(`($${param++}::text, $${param++}::text)`);
    orgValues.push(input.channel, input.topic);
  }
  const result = await db.query(
    `DELETE FROM ${TABLE} AS p
		 USING (VALUES ${orgTuples.join(", ")}) AS target(channel, topic)
		 WHERE p.user_id = $1
		   AND p.organization_id = $2
		   AND p.channel = target.channel
		   AND p.topic = target.topic
		 RETURNING p.id`,
    orgValues
  );
  return result.rows.length;
}

async function upsertOne(
  db: NotificationPreferenceSqlExecutor,
  input: NotificationPreferenceUpsertInput
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
        ]
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
}

async function upsertManyRows(
  db: NotificationPreferenceSqlExecutor,
  inputs: readonly NotificationPreferenceUpsertInput[]
): Promise<NotificationPreferenceRow[]> {
  if (inputs.length === 0) {
    return [];
  }
  assertSinglePreferenceScope(inputs);
  const organizationId = inputs[0]?.organizationId ?? null;
  const userScoped = organizationId === null;
  const values: unknown[] = [];
  const tuples: string[] = [];
  let param = 1;
  for (const input of inputs) {
    if (userScoped) {
      tuples.push(
        `($${param++}, $${param++}, NULL, $${param++}, $${param++}, $${param++}, $${param++}, '{}'::jsonb)`
      );
      values.push(
        crypto.randomUUID(),
        input.userId,
        input.channel,
        input.topic,
        input.enabled,
        input.digest ?? null
      );
    } else {
      tuples.push(
        `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, '{}'::jsonb)`
      );
      values.push(
        crypto.randomUUID(),
        input.userId,
        input.organizationId ?? null,
        input.channel,
        input.topic,
        input.enabled,
        input.digest ?? null
      );
    }
  }
  const conflict = userScoped
    ? `ON CONFLICT (user_id, channel, topic) WHERE organization_id IS NULL
			 DO UPDATE SET
				enabled = EXCLUDED.enabled,
				digest = EXCLUDED.digest,
				updated_at = NOW()`
    : `ON CONFLICT (user_id, organization_id, channel, topic) WHERE organization_id IS NOT NULL
			 DO UPDATE SET
				enabled = EXCLUDED.enabled,
				digest = EXCLUDED.digest,
				updated_at = NOW()`;
  const result = await db.query(
    `INSERT INTO ${TABLE} (
			id, user_id, organization_id, channel, topic, enabled, digest, metadata
		) VALUES ${tuples.join(", ")}
		${conflict}
		RETURNING *`,
    values
  );
  return result.rows.map((row) => hydrate(row as PreferenceSqlRow));
}

export function createPostgresNotificationPreferenceStore(
  db: NotificationPreferenceSqlExecutor
): NotificationPreferenceStore {
  return {
    async applyMany(
      operations: readonly NotificationPreferenceStoreMutation[]
    ): Promise<NotificationPreferenceApplyManyResult> {
      if (operations.length === 0) {
        return { deleted: 0, upserted: [] };
      }
      assertSinglePreferenceScope(operations);
      const resets = operations.filter(
        (operation) => operation.operation === "reset"
      );
      const sets = operations.filter(
        (operation) => operation.operation === "set"
      );
      const run = async (
        executor: NotificationPreferenceSqlExecutor
      ): Promise<NotificationPreferenceApplyManyResult> => {
        const deleted = await deleteManyRows(executor, resets);
        const upserted = await upsertManyRows(executor, sets);
        return { deleted, upserted };
      };
      if (resets.length > 0 && sets.length > 0) {
        const transaction = db.transaction;
        if (typeof transaction !== "function") {
          throw new Error(
            "mixed preference applyMany requires a pinned SQL transaction"
          );
        }
        return transaction(run);
      }
      return run(db);
    },
    async delete(input: NotificationPreferenceDeleteInput): Promise<boolean> {
      return deleteOne(db, input);
    },
    async deleteMany(
      inputs: readonly NotificationPreferenceDeleteInput[]
    ): Promise<number> {
      return deleteManyRows(db, inputs);
    },
    async list(
      input: NotificationPreferenceListInput
    ): Promise<NotificationPreferenceOverride[]> {
      const result = await db.query(
        `SELECT id, user_id, organization_id, channel, topic, enabled, digest, metadata, created_at, updated_at
				 FROM ${TABLE}
				 WHERE user_id = $1`,
        [input.userId]
      );
      return result.rows.map((row) =>
        toOverride(hydrate(row as PreferenceSqlRow))
      );
    },
    async upsert(
      input: NotificationPreferenceUpsertInput
    ): Promise<NotificationPreferenceRow> {
      return upsertOne(db, input);
    },
    async upsertMany(
      inputs: readonly NotificationPreferenceUpsertInput[]
    ): Promise<NotificationPreferenceRow[]> {
      return upsertManyRows(db, inputs);
    },
  };
}
