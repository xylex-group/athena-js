import type {
  AthenaAuthActor,
  AthenaAuthOperationContext,
  AthenaAuthRequestContext,
} from "../domain/context.ts";
import type {
  AthenaAuthImplementedDomainEvent,
  AthenaAuthReservedDomainEvent,
} from "./events.ts";
import type {
  AthenaAuthHookAccount,
  AthenaAuthHookInvitation,
  AthenaAuthHookMember,
  AthenaAuthHookOrganization,
  AthenaAuthHookPasskey,
  AthenaAuthHookUser,
} from "./sanitize.ts";

export type AthenaAuthHookActor = AthenaAuthActor;
export type AthenaAuthHookRequest = AthenaAuthRequestContext;
export type AthenaAuthHookContext = AthenaAuthOperationContext;

export interface AthenaAuthHookErrorInput {
  error: unknown;
  event: AthenaAuthImplementedDomainEvent;
  eventId: string;
  phase: "after" | "before" | "onError";
  traceId: string;
}

interface UserRef {
  user: AthenaAuthHookUser;
}
interface OrganizationRef {
  organization: AthenaAuthHookOrganization;
}
interface MemberRef {
  member: AthenaAuthHookMember;
}
interface InvitationRef {
  invitation: AthenaAuthHookInvitation;
}
interface SessionRef {
  session: {
    activeOrganizationId: string | null;
    expiresAt: string;
    id: string;
    impersonatedBy: string | null;
    userId: string;
  };
}
interface ApiKeyRef {
  apiKey: {
    id: string;
    name: string | null;
    prefix: string | null;
    userId: string;
  };
}
interface PasskeyRef {
  passkey: AthenaAuthHookPasskey;
}

interface IdentityConnectionSnapshot {
  authenticationRequired: boolean;
  clientId: string;
  connectionType: "oidc";
  domains: readonly string[];
  enabled: boolean;
  id: string;
  issuer: string;
  jitDefaultRoleId: string | null;
  jitEnabled: boolean;
  name: string;
  organizationId: string;
  resource: string | null;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
}

interface DeleteTombstone {
  deleted: true;
  id: string;
  organizationId?: string;
  userId?: string;
}

interface SessionRevokeReceipt {
  id: string;
  revoked: true;
  userId: string;
}

export interface AthenaAuthHookEventPayloads {
  "identity.connection.create": {
    input: { connectionId: string; organizationId: string };
    previous: undefined;
    result: { connection: IdentityConnectionSnapshot };
  };
  "identity.connection.update": {
    input: { connectionId: string; organizationId: string };
    previous: { connection: IdentityConnectionSnapshot };
    result: { connection: IdentityConnectionSnapshot };
  };
  "identity.connection.disable": {
    input: { connectionId: string; organizationId: string };
    previous: { connection: IdentityConnectionSnapshot };
    result: { connectionId: string; disabled: true };
  };
  "account.link": {
    input: { provider: string; userId: string };
    previous?: undefined;
    result: { account: AthenaAuthHookAccount; user: AthenaAuthHookUser };
  };
  "account.unlink": {
    input: { accountId: string; provider: string; userId: string };
    previous: { account: AthenaAuthHookAccount };
    result: {
      accountId: string;
      deleted: true;
      id: string;
      provider: string;
      userId: string;
    };
  };
  "apiKey.create": {
    input: { name?: string; userId: string };
    previous: undefined;
    result: ApiKeyRef;
  };
  "apiKey.delete": {
    input: { id: string };
    previous: {
      apiKey: {
        id: string;
        name: string | null;
        prefix: string | null;
        userId: string;
      };
    };
    result: { deleted: true; id: string; userId: string };
  };
  "apiKey.update": {
    input: { id: string; name?: string | null };
    previous: { name: string | null };
    result: ApiKeyRef;
  };
  "authorization.member.roles.replace": {
    input: {
      changes: readonly { memberId: string; roleIds: readonly string[] }[];
      organizationId: string;
    };
    previous: {
      changes: readonly { memberId: string; roleIds: readonly string[] }[];
    };
    result: {
      changes: readonly {
        member: AthenaAuthHookMember;
        previousRoleIds: readonly string[];
        roleIds: readonly string[];
      }[];
    };
  };
  "authorization.role.delete": {
    input: {
      organizationId: string;
      reassignmentRoleId?: string;
      roleId: string;
    };
    previous: { roleId: string };
    result: {
      changes: readonly {
        member: AthenaAuthHookMember;
        roleIds: readonly string[];
        previousRoleIds: readonly string[];
      }[];
      deleted: true;
      id: string;
    };
  };
  "organization.create": {
    input: { name: string; slug: string };
    previous: undefined;
    result: OrganizationRef & { member: AthenaAuthHookMember };
  };
  "organization.delete": {
    input: { organizationId: string };
    previous: OrganizationRef;
    result: DeleteTombstone;
  };
  "organization.invitation.accept": {
    input: { invitationId: string };
    previous: InvitationRef;
    result: InvitationRef;
  };
  "organization.invitation.cancel": {
    input: { invitationId: string };
    previous: InvitationRef;
    result: InvitationRef;
  };
  "organization.invitation.create": {
    input: { email: string; organizationId: string; role: string };
    previous: undefined;
    result: InvitationRef;
  };
  "organization.invitation.reject": {
    input: { invitationId: string };
    previous: InvitationRef;
    result: InvitationRef;
  };
  "organization.member.add": {
    input: { organizationId: string; role: string; userId: string };
    previous: undefined;
    result: MemberRef;
  };
  "organization.member.invite.reminder": {
    input: { invitationId: string };
    previous: InvitationRef;
    result: InvitationRef;
  };
  "organization.member.remove": {
    input: { organizationId: string; userId: string };
    previous: MemberRef;
    result: {
      deleted: true;
      id: string;
      organizationId: string;
      userId: string;
    };
  };
  "organization.member.role.update": {
    input: { memberId: string; organizationId: string; role: string };
    previous: { role: string };
    result: MemberRef;
  };
  "organization.update": {
    input: {
      logo?: string | null;
      name?: string;
      organizationId: string;
      slug?: string;
    };
    previous: OrganizationRef;
    result: OrganizationRef;
  };
  "oauth.authorization.denied": {
    input: {
      clientId: string;
      requestId: string;
      userId: string;
    };
    previous: undefined;
    result: { requestId: string; userId: string };
  };
  "oauth.client.disabled": {
    input: { clientId: string };
    previous: undefined;
    result: { clientId: string };
  };
  "oauth.grant.authorized": {
    input: {
      clientId: string;
      grantId: string;
      resource: string;
      scopes: readonly string[];
      userId: string;
    };
    previous: undefined;
    result: { grantId: string; userId: string };
  };
  "oauth.grant.revoked": {
    input: { grantId: string; userId: string };
    previous: undefined;
    result: { deleted: true; id: string; userId: string };
  };
  "oauth.refresh.reuse_detected": {
    input: { clientId: string; familyId: string; grantId: string };
    previous: undefined;
    result: { familyId: string };
  };
  "oauth.refresh.rotated": {
    input: { clientId: string; familyId: string; grantId: string };
    previous: undefined;
    result: { familyId: string };
  };
  "passkey.delete": {
    input: { id: string };
    previous: { passkey: AthenaAuthHookPasskey };
    result: { deleted: true; id: string; userId: string };
  };
  "passkey.register": {
    input: { userId: string };
    previous: undefined;
    result: PasskeyRef;
  };
  "passkey.update": {
    input: { id: string; name: string };
    previous: { passkey: AthenaAuthHookPasskey };
    result: { passkey: AthenaAuthHookPasskey };
  };
  "session.activeOrganization.update": {
    input: { organizationId: string | null };
    previous: { organizationId: string | null };
    result: { organizationId: string | null };
  };
  "session.impersonation.end": {
    input: { sessionId: string };
    previous: SessionRef;
    result: SessionRevokeReceipt;
  };
  "session.impersonation.start": {
    input: { userId: string };
    previous: undefined;
    result: SessionRef;
  };
  "session.issue": {
    input: { userId: string };
    previous: undefined;
    result: SessionRef;
  };
  "session.revoke": {
    input: { scope?: "all" | "others" | "one"; userId: string };
    previous: SessionRef;
    result: { id: string; revoked: true; userId: string };
  };
  "twoFactor.disable": {
    input: { userId: string };
    previous: undefined;
    result: { userId: string };
  };
  "twoFactor.enable": {
    input: { userId: string };
    previous: undefined;
    result: { userId: string };
  };
  "user.ban": {
    input: { userId: string };
    previous: { banned: boolean };
    result: UserRef;
  };
  "user.create": {
    input: { email: string; name?: string; username?: string };
    previous: undefined;
    result: UserRef;
  };
  "user.delete": {
    input: { userId: string };
    previous: UserRef;
    result: { deleted: true; id: string; userId: string };
  };
  "user.email.update": {
    input: { email: string; userId: string };
    previous: { email: string | null };
    result: UserRef;
  };
  "user.email.verify": {
    input: { userId: string };
    previous: { emailVerified: boolean };
    result: UserRef;
  };
  "user.password.change": {
    input: { userId: string };
    previous: undefined;
    result: { userId: string };
  };
  "user.password.reset": {
    input: { userId: string };
    previous: undefined;
    result: { userId: string };
  };
  "user.role.update": {
    input: { role: string; userId: string };
    previous: { role: string | null };
    result: UserRef;
  };
  "user.security.alert": {
    input: { alertDetails: string; alertTitle: string; email: string };
    previous: undefined;
    result: { email: string };
  };
  "user.sign-in.email": {
    input: { email: string };
    previous: undefined;
    result: { email: string };
  };
  "user.sign-in.social": {
    input: { provider: string };
    previous?: undefined;
    result: {
      account: AthenaAuthHookAccount;
      session: SessionRef["session"];
      user: AthenaAuthHookUser;
    };
  };
  "user.unban": {
    input: { userId: string };
    previous: { banned: boolean };
    result: UserRef;
  };
  "user.update": {
    input: { image?: string | null; name?: string | null; userId: string };
    previous: UserRef;
    result: UserRef;
  };
}

export type AthenaAuthBeforeHookPayload<
  E extends AthenaAuthImplementedDomainEvent,
> = AthenaAuthHookContext & {
  event: E;
  input: Readonly<AthenaAuthHookEventPayloads[E]["input"]>;
  previous: AthenaAuthHookEventPayloads[E]["previous"];
};

export type AthenaAuthAfterHookPayload<
  E extends AthenaAuthImplementedDomainEvent,
> = AthenaAuthBeforeHookPayload<E> & {
  result: AthenaAuthHookEventPayloads[E]["result"];
};

export type AthenaAuthHookHandler<
  E extends AthenaAuthImplementedDomainEvent,
  Phase extends "after" | "before",
> = (
  payload: Phase extends "before"
    ? AthenaAuthBeforeHookPayload<E>
    : AthenaAuthAfterHookPayload<E>
) => void;

export type AthenaAuthHookHandlerList<
  E extends AthenaAuthImplementedDomainEvent,
  Phase extends "after" | "before",
> = AthenaAuthHookHandler<E, Phase> | AthenaAuthHookHandler<E, Phase>[];

export interface AthenaAuthHooks {
  after?: {
    [K in AthenaAuthImplementedDomainEvent]?: AthenaAuthHookHandlerList<
      K,
      "after"
    >;
  };
  before?: {
    [K in AthenaAuthImplementedDomainEvent]?: AthenaAuthHookHandlerList<
      K,
      "before"
    >;
  };
  onError?: (input: AthenaAuthHookErrorInput) => void;
}

/** Reserved event names exist for docs and wiring tests; they are not hook keys. */
export type AthenaAuthReservedHookEvent = AthenaAuthReservedDomainEvent;
