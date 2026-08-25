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

type UserRef = { user: AthenaAuthHookUser };
type OrganizationRef = { organization: AthenaAuthHookOrganization };
type MemberRef = { member: AthenaAuthHookMember };
type InvitationRef = { invitation: AthenaAuthHookInvitation };
type SessionRef = {
	session: {
		activeOrganizationId: string | null;
		expiresAt: string;
		id: string;
		impersonatedBy: string | null;
		userId: string;
	};
};
type ApiKeyRef = {
	apiKey: {
		id: string;
		name: string | null;
		prefix: string | null;
		userId: string;
	};
};
type PasskeyRef = {
	passkey: AthenaAuthHookPasskey;
};

type DeleteTombstone = {
	deleted: true;
	id: string;
	organizationId?: string;
	userId?: string;
};

type SessionRevokeReceipt = {
	id: string;
	revoked: true;
	userId: string;
};

export interface AthenaAuthHookEventPayloads {
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
	},
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
	"passkey.delete": {
		input: { id: string };
		previous: { passkey: AthenaAuthHookPasskey };
		result: { deleted: true; id: string; userId: string };
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
	"user.security.alert": {
		input: { alertDetails: string; alertTitle: string; email: string };
		previous: undefined;
		result: { email: string };
	},
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
		: AthenaAuthAfterHookPayload<E>,
) => void;

export type AthenaAuthHookHandlerList<
	E extends AthenaAuthImplementedDomainEvent,
	Phase extends "after" | "before",
> = AthenaAuthHookHandler<E, Phase> | AthenaAuthHookHandler<E, Phase>[];

export type AthenaAuthHooks = {
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
};

/** Reserved event names exist for docs and wiring tests; they are not hook keys. */
export type AthenaAuthReservedHookEvent = AthenaAuthReservedDomainEvent;
