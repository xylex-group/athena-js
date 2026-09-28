import {
  ATHENA_NOTIFICATIONS_SCOPE_INVALID,
  throwNotificationsError,
} from "./errors.ts";
import { preferenceScopeKey } from "./store.ts";
import type { AthenaNotificationPreferenceMutation } from "./types.ts";

export function collapseNotificationPreferenceMutations(
  mutations: readonly AthenaNotificationPreferenceMutation[]
): AthenaNotificationPreferenceMutation[] {
  const byKey = new Map<string, AthenaNotificationPreferenceMutation>();
  for (const mutation of mutations) {
    const organizationId = mutation.organizationId ?? null;
    const key = preferenceScopeKey(
      "",
      organizationId,
      mutation.channel,
      mutation.topic
    );
    byKey.set(key, mutation);
  }
  return [...byKey.values()];
}

export function requireUniformPreferenceMutationScope(
  mutations: readonly AthenaNotificationPreferenceMutation[]
): string | null {
  if (mutations.length === 0) {
    return null;
  }
  const organizationId = mutations[0]?.organizationId ?? null;
  for (const mutation of mutations) {
    if ((mutation.organizationId ?? null) !== organizationId) {
      throwNotificationsError(ATHENA_NOTIFICATIONS_SCOPE_INVALID);
    }
  }
  return organizationId;
}
