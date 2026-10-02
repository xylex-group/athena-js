import type { AthenaAuthImplementedDomainEvent } from "../hooks/events.ts";
import type { AthenaAuthHookEventPayloads } from "../hooks/types.ts";
import type {
  AthenaAuthMutationKind,
  AthenaAuthPreviousPolicy,
  AthenaAuthResultPolicy,
} from "../observability/contract.ts";
import type { AthenaAuthActor } from "./context.ts";

export interface AthenaAuthEventSubject {
  id: string;
  type: string;
}

export interface AthenaAuthAuditResolveContext<
  E extends AthenaAuthImplementedDomainEvent = AthenaAuthImplementedDomainEvent,
> {
  actor: AthenaAuthActor;
  input: AthenaAuthHookEventPayloads[E]["input"];
  previous: AthenaAuthHookEventPayloads[E]["previous"];
  result: AthenaAuthHookEventPayloads[E]["result"];
}

/**
 * Audit Event IR. Generic over AthenaAuthHookEventPayloads[E].
 * previous: "none" | "optional" | "required"
 * result: "resource" | "receipt"
 */
export interface AthenaAuthEventDefinition<
  E extends AthenaAuthImplementedDomainEvent = AthenaAuthImplementedDomainEvent,
> {
  audit: boolean;
  mutationKind: AthenaAuthMutationKind;
  previous: AthenaAuthPreviousPolicy;
  resolveOrganizationId?: (
    context: AthenaAuthAuditResolveContext<E>
  ) => string | undefined;
  resolveSubject: (
    context: AthenaAuthAuditResolveContext<E>
  ) => AthenaAuthEventSubject | undefined;
  result: AthenaAuthResultPolicy;
  subjectType: string;
}

function subject(
  type: string,
  id: string | null | undefined
): AthenaAuthEventSubject | undefined {
  if (typeof id !== "string" || id.length === 0) {
    return;
  }
  return { id, type };
}

function definedId(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Explicit event → audit Event IR. Implemented mutations default to audited
 * security history. Reads never appear here.
 */
export const ATHENA_AUTH_EVENT_DEFINITIONS = {
  "authorization.member.roles.replace": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ input }) => input.organizationId,
    resolveSubject: ({ result }) =>
      subject("organization.member", result.changes[0]?.member.id),
    result: "resource",
    subjectType: "organization.member",
  },
  "authorization.role.delete": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveOrganizationId: ({ input }) => input.organizationId,
    resolveSubject: ({ input }) => subject("authorization.role", input.roleId),
    result: "receipt",
    subjectType: "authorization.role",
  },
  "identity.connection.create": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveOrganizationId: ({ input }) => input.organizationId,
    resolveSubject: ({ result }) => subject("identity.connection", result.connection.id),
    result: "resource",
    subjectType: "identity.connection",
  },
  "identity.connection.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ input }) => input.organizationId,
    resolveSubject: ({ input }) => subject("identity.connection", input.connectionId),
    result: "resource",
    subjectType: "identity.connection",
  },
  "identity.connection.disable": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ input }) => input.organizationId,
    resolveSubject: ({ input }) => subject("identity.connection", input.connectionId),
    result: "receipt",
    subjectType: "identity.connection",
  },
  "account.link": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("account", result.account.id),
    result: "resource",
    subjectType: "account",
  },
  "account.unlink": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveSubject: ({ result }) => subject("account", result.accountId),
    result: "receipt",
    subjectType: "account",
  },
  "apiKey.create": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("api_key", result.apiKey.id),
    result: "resource",
    subjectType: "api_key",
  },
  "apiKey.delete": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveSubject: ({ previous, result }) =>
      subject("api_key", result.id ?? previous?.apiKey.id),
    result: "receipt",
    subjectType: "api_key",
  },
  "apiKey.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("api_key", result.apiKey.id),
    result: "resource",
    subjectType: "api_key",
  },
  "organization.create": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveOrganizationId: ({ result }) => result.organization.id,
    resolveSubject: ({ result }) =>
      subject("organization", result.organization.id),
    result: "resource",
    subjectType: "organization",
  },
  "organization.delete": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.id) ?? previous?.organization.id,
    resolveSubject: ({ previous, result }) =>
      subject("organization", result.id ?? previous?.organization.id),
    result: "receipt",
    subjectType: "organization",
  },
  "organization.invitation.accept": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.invitation.organizationId) ??
      previous?.invitation.organizationId,
    resolveSubject: ({ previous, result }) =>
      subject(
        "organization.invitation",
        result.invitation.id ?? previous?.invitation.id
      ),
    result: "receipt",
    subjectType: "organization.invitation",
  },
  "organization.invitation.cancel": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.invitation.organizationId) ??
      previous?.invitation.organizationId,
    resolveSubject: ({ previous, result }) =>
      subject(
        "organization.invitation",
        result.invitation.id ?? previous?.invitation.id
      ),
    result: "receipt",
    subjectType: "organization.invitation",
  },
  "organization.invitation.create": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveOrganizationId: ({ result }) => result.invitation.organizationId,
    resolveSubject: ({ result }) =>
      subject("organization.invitation", result.invitation.id),
    result: "resource",
    subjectType: "organization.invitation",
  },
  "organization.invitation.reject": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.invitation.organizationId) ??
      previous?.invitation.organizationId,
    resolveSubject: ({ previous, result }) =>
      subject(
        "organization.invitation",
        result.invitation.id ?? previous?.invitation.id
      ),
    result: "receipt",
    subjectType: "organization.invitation",
  },
  "organization.member.add": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveOrganizationId: ({ result }) => result.member.organizationId,
    resolveSubject: ({ result }) =>
      subject("organization.member", result.member.id),
    result: "resource",
    subjectType: "organization.member",
  },
  "organization.member.invite.reminder": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.invitation.organizationId) ??
      previous?.invitation.organizationId,
    resolveSubject: ({ previous, result }) =>
      subject(
        "organization.invitation",
        result.invitation.id ?? previous?.invitation.id
      ),
    result: "receipt",
    subjectType: "organization.invitation",
  },
  "organization.member.remove": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.organizationId) ?? previous?.member.organizationId,
    resolveSubject: ({ previous, result }) =>
      subject("organization.member", result.id ?? previous?.member.id),
    result: "receipt",
    subjectType: "organization.member",
  },
  "organization.member.role.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ result }) => result.member.organizationId,
    resolveSubject: ({ result }) =>
      subject("organization.member", result.member.id),
    result: "resource",
    subjectType: "organization.member",
  },
  "organization.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ result }) => definedId(result.organization.id),
    resolveSubject: ({ previous, result }) =>
      subject(
        "organization",
        definedId(result.organization.id) ?? previous?.organization.id
      ),
    result: "resource",
    subjectType: "organization",
  },
  "oauth.authorization.denied": {
    audit: true,
    mutationKind: "update",
    previous: "none",
    resolveSubject: ({ result }) =>
      subject("oauth.authorization_request", result.requestId),
    result: "receipt",
    subjectType: "oauth.authorization_request",
  },
  "oauth.client.disabled": {
    audit: true,
    mutationKind: "update",
    previous: "none",
    resolveSubject: ({ result }) => subject("oauth.client", result.clientId),
    result: "receipt",
    subjectType: "oauth.client",
  },
  "oauth.grant.authorized": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("oauth.grant", result.grantId),
    result: "receipt",
    subjectType: "oauth.grant",
  },
  "oauth.grant.revoked": {
    audit: true,
    mutationKind: "delete",
    previous: "none",
    resolveSubject: ({ result }) => subject("oauth.grant", result.id),
    result: "receipt",
    subjectType: "oauth.grant",
  },
  "oauth.refresh.reuse_detected": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ result }) =>
      subject("oauth.refresh_family", result.familyId),
    result: "receipt",
    subjectType: "oauth.refresh_family",
  },
  "oauth.refresh.rotated": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ result }) =>
      subject("oauth.refresh_family", result.familyId),
    result: "receipt",
    subjectType: "oauth.refresh_family",
  },
  "passkey.delete": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveSubject: ({ previous, result }) =>
      subject("passkey", result.id ?? previous?.passkey.id),
    result: "receipt",
    subjectType: "passkey",
  },
  "passkey.register": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("passkey", result.passkey.id),
    result: "resource",
    subjectType: "passkey",
  },
  "passkey.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("passkey", result.passkey.id),
    result: "resource",
    subjectType: "passkey",
  },
  "session.activeOrganization.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveOrganizationId: ({ previous, result }) =>
      definedId(result.organizationId) ?? definedId(previous?.organizationId),
    resolveSubject: ({ actor }) => subject("session", actor?.sessionId),
    result: "resource",
    subjectType: "session",
  },
  "session.impersonation.end": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveSubject: ({ input, previous, result }) =>
      subject("session", result.id ?? previous?.session.id ?? input.sessionId),
    result: "receipt",
    subjectType: "session",
  },
  "session.impersonation.start": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("session", result.session.id),
    result: "resource",
    subjectType: "session",
  },
  "session.issue": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("session", result.session.id),
    result: "resource",
    subjectType: "session",
  },
  "session.revoke": {
    audit: true,
    mutationKind: "action",
    previous: "required",
    resolveSubject: ({ previous, result }) =>
      subject("session", result.id ?? previous?.session.id),
    result: "receipt",
    subjectType: "session",
  },
  "twoFactor.disable": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor, result }) =>
      subject("user", result.userId ?? actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "twoFactor.enable": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor, result }) =>
      subject("user", result.userId ?? actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "user.ban": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.create": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.delete": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveSubject: ({ previous, result }) =>
      subject("user", result.id ?? previous?.user.id),
    result: "receipt",
    subjectType: "user",
  },
  "user.email.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.email.verify": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.password.change": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor, result }) =>
      subject("user", result.userId ?? actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "user.password.reset": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor, result }) =>
      subject("user", result.userId ?? actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "user.role.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.security.alert": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor }) => subject("user", actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "user.sign-in.email": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ actor }) => subject("user", actor?.userId),
    result: "receipt",
    subjectType: "user",
  },
  "user.sign-in.social": {
    audit: true,
    mutationKind: "action",
    previous: "none",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.unban": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
  "user.update": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveSubject: ({ result }) => subject("user", result.user.id),
    result: "resource",
    subjectType: "user",
  },
} as const satisfies {
  [K in AthenaAuthImplementedDomainEvent]: AthenaAuthEventDefinition<K>;
};

export function isAuditedAuthEvent(
  event: AthenaAuthImplementedDomainEvent
): boolean {
  return ATHENA_AUTH_EVENT_DEFINITIONS[event].audit;
}

export function resolveAuthEventSubject<
  E extends AthenaAuthImplementedDomainEvent,
>(
  event: E,
  context: AthenaAuthAuditResolveContext<E>
): AthenaAuthEventSubject | undefined {
  const ir = ATHENA_AUTH_EVENT_DEFINITIONS[event] as {
    resolveSubject: (
      ctx: AthenaAuthAuditResolveContext<E>
    ) => AthenaAuthEventSubject | undefined;
  };
  return ir.resolveSubject(context);
}
