import type {
  NotificationChannelId,
  NotificationDigest,
  NotificationPreferenceOverride,
  NotificationPreferenceRow,
} from "./types.ts";

export type NotificationPreferenceListInput = {
  organizationId?: string | null;
  userId: string;
};

export type NotificationPreferenceUpsertInput = {
  channel: NotificationChannelId;
  digest?: NotificationDigest | null;
  enabled: boolean;
  organizationId?: string | null;
  topic: string;
  userId: string;
};

export type NotificationPreferenceDeleteInput = {
  channel: NotificationChannelId;
  organizationId?: string | null;
  topic: string;
  userId: string;
};

export type NotificationPreferenceStoreMutation =
  | ({
      operation: "set";
    } & NotificationPreferenceUpsertInput)
  | ({
      operation: "reset";
    } & NotificationPreferenceDeleteInput);

export type NotificationPreferenceApplyManyResult = {
  deleted: number;
  upserted: NotificationPreferenceRow[];
};

export type NotificationPreferenceSqlQuery = (
  text: string,
  values?: unknown[]
) => Promise<{ rows: Record<string, unknown>[] }>;

export type NotificationPreferenceSqlExecutor = {
  query: NotificationPreferenceSqlQuery;
  transaction?: <T>(
    fn: (executor: NotificationPreferenceSqlExecutor) => Promise<T>
  ) => Promise<T>;
};

export type NotificationPreferenceStore = {
  applyMany: (
    operations: readonly NotificationPreferenceStoreMutation[]
  ) => Promise<NotificationPreferenceApplyManyResult>;
  delete: (input: NotificationPreferenceDeleteInput) => Promise<boolean>;
  deleteMany: (
    inputs: readonly NotificationPreferenceDeleteInput[]
  ) => Promise<number>;
  list: (
    input: NotificationPreferenceListInput
  ) => Promise<NotificationPreferenceOverride[]>;
  upsert: (
    input: NotificationPreferenceUpsertInput
  ) => Promise<NotificationPreferenceRow>;
  upsertMany: (
    inputs: readonly NotificationPreferenceUpsertInput[]
  ) => Promise<NotificationPreferenceRow[]>;
};

export function preferenceScopeKey(
  userId: string,
  organizationId: string | null,
  channel: string,
  topic: string
): string {
  const org = organizationId === null ? "" : organizationId;
  return `${userId}\u0000${org}\u0000${channel}\u0000${topic}`;
}

export function assertSinglePreferenceScope(
  inputs: readonly { organizationId?: string | null; userId: string }[]
): { organizationId: string | null; userId: string } | null {
  if (inputs.length === 0) {
    return null;
  }
  const userId = inputs[0]?.userId;
  const organizationId = inputs[0]?.organizationId ?? null;
  if (!userId) {
    throw new Error("preference batch is missing userId");
  }
  for (const input of inputs) {
    if (input.userId !== userId) {
      throw new Error("preference batch mixes user identities");
    }
    if ((input.organizationId ?? null) !== organizationId) {
      throw new Error("preference batch mixes organization scopes");
    }
  }
  return { organizationId, userId };
}
