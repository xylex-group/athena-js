import { AthenaAuthRuntimeError } from "../local/errors.ts";

export type AthenaAuthOrganizationLifecycleEventName =
  | "organization.member.add"
  | "organization.member.remove"
  | "organization.member.role.update";

export type AthenaAuthOrganizationLifecycleEvent = {
  event: AthenaAuthOrganizationLifecycleEventName;
  eventId: string;
  occurredAt: string;
  subjectUserId: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

export function organizationLifecycleEventFromAuditRow(
  row: Record<string, unknown>,
  organizationId: string
): AthenaAuthOrganizationLifecycleEvent[] {
  const event = row.event;
  const subjectType = row.subject_type;
  if (event === "authorization.member.roles.replace") {
    const changes = record(row.result)?.changes;
    const item = Array.isArray(changes) ? record(changes[0]) : undefined;
    const member = record(item?.member);
    const previousRoleIds = item?.previousRoleIds;
    const roleIds = item?.roleIds;
    const occurredAt = new Date(String(row.created_at));
    if (
      subjectType !== "organization.member" ||
      row.organization_id !== organizationId ||
      typeof row.subject_id !== "string" ||
      typeof row.event_id !== "string" ||
      !Array.isArray(changes) ||
      changes.length !== 1 ||
      !Number.isFinite(occurredAt.getTime()) ||
      typeof member?.id !== "string" ||
      member.id.length === 0 ||
      member.organizationId !== organizationId ||
      member.id !== row.subject_id ||
      typeof member.userId !== "string" ||
      member.userId.length === 0 ||
      !Array.isArray(previousRoleIds) ||
      !Array.isArray(roleIds) ||
      !previousRoleIds.every((value) => typeof value === "string") ||
      !roleIds.every((value) => typeof value === "string")
    ) {
      throw AthenaAuthRuntimeError.internal(
        new Error("ATHENA_AUTH_AUDIT_LIFECYCLE_ROW_INVALID")
      );
    }
    return [
      {
        event: "organization.member.role.update",
        eventId: row.event_id,
        occurredAt: occurredAt.toISOString(),
        subjectUserId: member.userId,
      },
    ];
  }
  const userSnapshot = record(
    event === "organization.member.remove"
      ? record(row.previous)?.member
      : record(row.result)?.member
  );
  const occurredAt = new Date(String(row.created_at));
  if (
    (event !== "organization.member.add" &&
      event !== "organization.member.remove" &&
      event !== "organization.member.role.update") ||
    subjectType !== "organization.member" ||
    row.organization_id !== organizationId ||
    typeof row.subject_id !== "string" ||
    typeof row.event_id !== "string" ||
    userSnapshot?.id !== row.subject_id ||
    userSnapshot?.organizationId !== organizationId ||
    typeof userSnapshot?.userId !== "string" ||
    userSnapshot.userId.length === 0 ||
    !Number.isFinite(occurredAt.getTime())
  ) {
    throw AthenaAuthRuntimeError.internal(
      new Error("ATHENA_AUTH_AUDIT_LIFECYCLE_ROW_INVALID")
    );
  }
  return [{
    event,
    eventId: row.event_id,
    occurredAt: occurredAt.toISOString(),
    subjectUserId: userSnapshot.userId,
  }];
}
