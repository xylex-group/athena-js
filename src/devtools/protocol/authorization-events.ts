export const ATHENA_DEVTOOLS_AUTHORIZATION_EVENT_NAMES = [
  "authorization.principal.resolved",
  "authorization.role.created",
  "authorization.role.updated",
  "authorization.role.deleted",
  "authorization.role.assigned",
  "authorization.role.unassigned",
  "authorization.rights.replaced",
  "authorization.grant.created",
  "authorization.grant.revoked",
  "authorization.decision.allowed",
  "authorization.decision.denied",
  "authorization.scope.mismatch",
] as const;

export type AthenaDevtoolsAuthorizationEventName =
  (typeof ATHENA_DEVTOOLS_AUTHORIZATION_EVENT_NAMES)[number];

export type AthenaDevtoolsAuthorizationEvent = {
  event: AthenaDevtoolsAuthorizationEventName;
  occurredAt: string;
  organizationId: string | null;
  roleId: string | null;
  roleKey: string | null;
  targetId: string | null;
  userId: string | null;
};
