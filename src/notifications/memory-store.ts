import type {
  NotificationPreferenceApplyManyResult,
  NotificationPreferenceDeleteInput,
  NotificationPreferenceListInput,
  NotificationPreferenceStore,
  NotificationPreferenceStoreMutation,
  NotificationPreferenceUpsertInput,
} from "./store.ts";
import { assertSinglePreferenceScope, preferenceScopeKey } from "./store.ts";
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

export function createMemoryNotificationPreferenceStore(): NotificationPreferenceStore {
  const rows = new Map<string, NotificationPreferenceRow>();

  async function upsert(
    input: NotificationPreferenceUpsertInput
  ): Promise<NotificationPreferenceRow> {
    const organizationId = input.organizationId ?? null;
    const key = preferenceScopeKey(
      input.userId,
      organizationId,
      input.channel,
      input.topic
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
  }

  async function remove(
    input: NotificationPreferenceDeleteInput
  ): Promise<boolean> {
    const key = preferenceScopeKey(
      input.userId,
      input.organizationId ?? null,
      input.channel,
      input.topic
    );
    return rows.delete(key);
  }

  async function deleteMany(
    inputs: readonly NotificationPreferenceDeleteInput[]
  ): Promise<number> {
    assertSinglePreferenceScope(inputs);
    let deleted = 0;
    for (const input of inputs) {
      if (await remove(input)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async function upsertMany(
    inputs: readonly NotificationPreferenceUpsertInput[]
  ): Promise<NotificationPreferenceRow[]> {
    assertSinglePreferenceScope(inputs);
    const rowsOut: NotificationPreferenceRow[] = [];
    for (const input of inputs) {
      rowsOut.push(await upsert(input));
    }
    return rowsOut;
  }

  const store: NotificationPreferenceStore = {
    async applyMany(
      operations: readonly NotificationPreferenceStoreMutation[]
    ): Promise<NotificationPreferenceApplyManyResult> {
      assertSinglePreferenceScope(operations);
      const snapshot = new Map(rows);
      try {
        const resets = operations.filter(
          (operation) => operation.operation === "reset"
        );
        const sets = operations.filter(
          (operation) => operation.operation === "set"
        );
        const deleted = await this.deleteMany(resets);
        const upserted = await this.upsertMany(sets);
        return { deleted, upserted };
      } catch (error) {
        rows.clear();
        for (const [key, row] of snapshot) {
          rows.set(key, row);
        }
        throw error;
      }
    },
    delete: remove,
    deleteMany,
    async list(
      input: NotificationPreferenceListInput
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
    upsert,
    upsertMany,
  };
  return store;
}
