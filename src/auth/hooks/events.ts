export const ATHENA_AUTH_DOMAIN_EVENT_STATUS = {
  implemented: "implemented",
  reserved: "reserved",
} as const;

export type AthenaAuthDomainEventStatus =
  (typeof ATHENA_AUTH_DOMAIN_EVENT_STATUS)[keyof typeof ATHENA_AUTH_DOMAIN_EVENT_STATUS];

/**
 * Domain lifecycle events for embedded Auth. Status is mechanical: only
 * `implemented` keys are hookable. Flip status in the same change that
 * migrates the handler through `executeAuthMutation`.
 */
export const ATHENA_AUTH_DOMAIN_EVENTS = {
  "account.link": { status: "implemented" },
  "account.unlink": { status: "implemented" },
  "apiKey.create": { status: "implemented" },
  "apiKey.delete": { status: "implemented" },
  "apiKey.update": { status: "implemented" },
  "authorization.member.roles.replace": { status: "implemented" },
  "authorization.user.roles.replace": { status: "implemented" },
  "authorization.role.create": { status: "implemented" },
  "authorization.role.update": { status: "implemented" },
  "authorization.role.rights.replace": { status: "implemented" },
  "authorization.role.delete": { status: "implemented" },
  "organization.create": { status: "implemented" },
  "organization.delete": { status: "implemented" },
  "organization.invitation.accept": { status: "implemented" },
  "organization.invitation.cancel": { status: "implemented" },
  "organization.invitation.create": { status: "implemented" },
  "organization.invitation.reject": { status: "implemented" },
  "organization.member.add": { status: "implemented" },
  "organization.member.invite.reminder": { status: "implemented" },
  "organization.member.remove": { status: "implemented" },
  "organization.member.role.update": { status: "implemented" },
  "organization.update": { status: "implemented" },
  "oauth.authorization.denied": { status: "implemented" },
  "oauth.client.disabled": { status: "implemented" },
  "oauth.grant.authorized": { status: "implemented" },
  "oauth.grant.revoked": { status: "implemented" },
  "oauth.refresh.reuse_detected": { status: "implemented" },
  "oauth.refresh.rotated": { status: "implemented" },
  "passkey.delete": { status: "implemented" },
  "passkey.register": { status: "implemented" },
  "passkey.update": { status: "implemented" },
  "session.activeOrganization.update": { status: "implemented" },
  "session.impersonation.end": { status: "implemented" },
  "session.impersonation.start": { status: "implemented" },
  "session.issue": { status: "implemented" },
  "session.revoke": { status: "implemented" },
  "twoFactor.disable": { status: "implemented" },
  "twoFactor.enable": { status: "implemented" },
  "user.ban": { status: "implemented" },
  "user.create": { status: "implemented" },
  "user.delete": { status: "implemented" },
  "user.email.update": { status: "implemented" },
  "user.email.verify": { status: "implemented" },
  "user.password.change": { status: "implemented" },
  "user.password.reset": { status: "implemented" },
  "user.role.update": { status: "implemented" },
  "user.security.alert": { status: "implemented" },
  "user.sign-in.email": { status: "implemented" },
  "user.sign-in.social": { status: "implemented" },
  "user.unban": { status: "implemented" },
  "user.update": { status: "implemented" },
  "identity.connection.create": { status: "implemented" },
  "identity.connection.update": { status: "implemented" },
  "identity.connection.disable": { status: "implemented" },
} as const satisfies Record<
  string,
  { readonly status: AthenaAuthDomainEventStatus }
>;

export type AthenaAuthDomainEvent = keyof typeof ATHENA_AUTH_DOMAIN_EVENTS;

export type AthenaAuthImplementedDomainEvent = {
  [K in AthenaAuthDomainEvent]: (typeof ATHENA_AUTH_DOMAIN_EVENTS)[K]["status"] extends "implemented"
  ? K
  : never;
}[AthenaAuthDomainEvent];

export type AthenaAuthReservedDomainEvent = {
  [K in AthenaAuthDomainEvent]: (typeof ATHENA_AUTH_DOMAIN_EVENTS)[K]["status"] extends "reserved"
  ? K
  : never;
}[AthenaAuthDomainEvent];

function isImplementedEvent(
  event: AthenaAuthDomainEvent
): event is AthenaAuthImplementedDomainEvent {
  return (ATHENA_AUTH_DOMAIN_EVENTS[event].status as string) === "implemented";
}

export const ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS = (
  Object.keys(ATHENA_AUTH_DOMAIN_EVENTS) as AthenaAuthDomainEvent[]
).filter(isImplementedEvent);

export const ATHENA_AUTH_RESERVED_DOMAIN_EVENTS = (
  Object.keys(ATHENA_AUTH_DOMAIN_EVENTS) as AthenaAuthDomainEvent[]
).filter(
  (event): event is AthenaAuthReservedDomainEvent =>
    (ATHENA_AUTH_DOMAIN_EVENTS[event].status as string) === "reserved"
);
