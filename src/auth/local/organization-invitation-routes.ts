import { ATHENA_AUTH_DEFAULT_BASE_PATH } from "../contract/index.ts";
import { authEmailEvents } from "../email/index.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import { toPublicInvitation } from "./models.ts";
import { timeAuthSpan } from "./request-timing.ts";
import { asStringField, readJsonBody, requireStringField } from "./security.ts";
import { sanitizeHookInvitation } from "../hooks/sanitize.ts";
import type { AuthRuntimeDependencies } from "./runtime-dependencies.ts";

export interface AuthProcedureContext {
	deps: AuthRuntimeDependencies;
	headers: Headers;
	stores: AthenaAuthStores;
	traceId: string;
}

export async function handleOrganizationInvitationRoutes(
	request: Request,
	path: string,
	method: string,
	ctx: AuthProcedureContext,
): Promise<Response | undefined> {
	const {
		config,
		emitIfRecipient,
		emitMail,
		hookRequest,
		identityOf,
		mutate,
		requireSession,
	} = ctx.deps;
	const currentStores = ctx.stores;
	const headers = ctx.headers;
	const traceId = ctx.traceId;
	if (path === "/organization/invite-member" && method === "POST") {
			const resolved = await requireSession(request, currentStores);
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const organizationId =
				asStringField(body, "organizationId") ??
				resolved.session.active_organization_id;
			if (!organizationId) {
				throw AthenaAuthRuntimeError.badRequest("organizationId is required");
			}
			const actor = await currentStores.getMember(
				organizationId,
				resolved.user.id,
			);
			if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			const email = requireStringField(body, "email");
			const role = asStringField(body, "role") ?? "member";
			const inviteEmail = email.trim().toLowerCase();
			const actorEmail =
				typeof resolved.user.email === "string"
					? resolved.user.email.trim().toLowerCase()
					: "";
			if (actorEmail.length > 0 && inviteEmail === actorEmail) {
				throw AthenaAuthRuntimeError.badRequest(
					"You cannot invite your own email as a member",
				);
			}
			const invitation = await mutate({
				context: {
					actor: {
						kind: "user",
						organizationId,
						sessionId: resolved.session.id,
						userId: resolved.user.id,
					},
					request: hookRequest(request, path),
					traceId,
				},
				event: "organization.invitation.create",
				execute: (scope) =>
					scope.stores.createInvitation({
						email,
						expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
						id: crypto.randomUUID(),
						inviterId: resolved.user.id,
						organizationId,
						role,
					}),
				input: { email, organizationId, role },
				resultOf: (row) => ({ invitation: sanitizeHookInvitation(row) }),
			});
			const organization = await currentStores.getOrganization(organizationId);
			const origin = new URL(request.url).origin;
			const basePath = config.basePath || ATHENA_AUTH_DEFAULT_BASE_PATH;
			await emitMail({
				data: {
					invitation_url: `${origin}${basePath}/organization/accept-invitation?invitationId=${encodeURIComponent(invitation.id)}`,
					inviter_identity:
						resolved.user.email ?? resolved.user.name ?? resolved.user.id,
					organization_name: organization?.name ?? "organization",
					role: invitation.role ?? "member",
				},
				eventType: authEmailEvents.organization.member.invite,
				recipient: invitation.email,
			});
			return jsonResponse(
				200,
				{ invitation: toPublicInvitation(invitation) },
				headers,
			);
		}

if (path === "/organization/accept-invitation" && method === "POST") {
			const resolved = await requireSession(request, currentStores);
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const invitationId = requireStringField(body, "invitationId");
			const invitation = await currentStores.getInvitation(invitationId);
			if (
				invitation?.status !== "pending" ||
				new Date(invitation.expires_at).getTime() <= Date.now()
			) {
				throw AthenaAuthRuntimeError.badRequest("Invitation is not valid");
			}
			if (
				invitation.email &&
				resolved.user.email &&
				invitation.email !== resolved.user.email
			) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			const existing = await currentStores.getMember(
				invitation.organization_id,
				resolved.user.id,
			);
			const accepted = await mutate({
				context: {
					actor: {
						kind: "user",
						organizationId: invitation.organization_id,
						sessionId: resolved.session.id,
						userId: resolved.user.id,
					},
					request: hookRequest(request, path),
					traceId,
				},
				event: "organization.invitation.accept",
				execute: async (scope) => {
					if (!existing) {
						await scope.stores.addMember({
							id: crypto.randomUUID(),
							organizationId: invitation.organization_id,
							role: invitation.role,
							userId: resolved.user.id,
						});
					}
					await scope.stores.updateInvitationStatus(invitation.id, "accepted");
					return invitation;
				},
				input: { invitationId },
				previous: async () => ({
					invitation: sanitizeHookInvitation(invitation),
				}),
				resultOf: (row) => ({
					invitation: sanitizeHookInvitation({ ...row, status: "accepted" }),
				}),
			});
			void accepted;
			return jsonResponse(200, { status: true }, headers);
		}

if (path === "/organization/cancel-invitation" && method === "POST") {
			const resolved = await requireSession(request, currentStores);
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const invitationId = requireStringField(body, "invitationId");
			const invitation = await currentStores.getInvitation(invitationId);
			if (!invitation) {
				throw AthenaAuthRuntimeError.notFound("Invitation not found");
			}
			const actor = await currentStores.getMember(
				invitation.organization_id,
				resolved.user.id,
			);
			if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			await mutate({
				context: {
					actor: {
						kind: "user",
						organizationId: invitation.organization_id,
						sessionId: resolved.session.id,
						userId: resolved.user.id,
					},
					request: hookRequest(request, path),
					traceId,
				},
				event: "organization.invitation.cancel",
				execute: async (scope) => {
					await scope.stores.updateInvitationStatus(invitation.id, "canceled");
				},
				input: { invitationId },
				previous: async () => ({
					invitation: sanitizeHookInvitation(invitation),
				}),
				resultOf: () => ({
					invitation: sanitizeHookInvitation({
						...invitation,
						status: "canceled",
					}),
				}),
			});
			const revokedOrg = await currentStores.getOrganization(
				invitation.organization_id,
			);
			await emitIfRecipient(invitation.email, {
				data: {
					invited_email: invitation.email,
					inviter_identity: identityOf(resolved.user),
					organization_name: revokedOrg?.name ?? "organization",
				},
				eventType: authEmailEvents.organization.member.inviteRevoked,
			});
			return jsonResponse(200, { status: true }, headers);
		}

if (path === "/organization/list-invitations" && method === "GET") {
			const resolved = await requireSession(request, currentStores);
			const organizationId =
				new URL(request.url).searchParams.get("organizationId") ??
				resolved.session.active_organization_id;
			if (!organizationId) {
				throw AthenaAuthRuntimeError.badRequest("organizationId is required");
			}
			const member = await timeAuthSpan("authz", () =>
				currentStores.getMember(organizationId, resolved.user.id),
			);
			if (!member) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			const invitations = await currentStores.listInvitations(organizationId);
			return jsonResponse(
				200,
				invitations.map((invitation) => toPublicInvitation(invitation)),
				headers,
			);
		}

if (path === "/organization/invite-member-reminder" && method === "POST") {
			const resolved = await requireSession(request, currentStores);
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const invitationId = requireStringField(body, "invitationId");
			const invitation = await currentStores.getInvitation(invitationId);
			if (invitation?.status !== "pending") {
				throw AthenaAuthRuntimeError.badRequest("Invitation is not pending");
			}
			const actor = await currentStores.getMember(
				invitation.organization_id,
				resolved.user.id,
			);
			if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			await mutate({
				context: {
					actor: {
						kind: "user",
						organizationId: invitation.organization_id,
						sessionId: resolved.session.id,
						userId: resolved.user.id,
					},
					request: hookRequest(request, path),
					traceId,
				},
				event: "organization.member.invite.reminder",
				execute: async () => invitation,
				input: { invitationId },
				previous: async () => ({
					invitation: sanitizeHookInvitation(invitation),
				}),
				resultOf: (row) => ({ invitation: sanitizeHookInvitation(row) }),
			});
			const reminderOrg = await currentStores.getOrganization(
				invitation.organization_id,
			);
			const origin = new URL(request.url).origin;
			const basePath = config.basePath || ATHENA_AUTH_DEFAULT_BASE_PATH;
			await emitMail({
				data: {
					invitation_url: `${origin}${basePath}/organization/accept-invitation?invitationId=${encodeURIComponent(invitation.id)}`,
					inviter_identity: identityOf(resolved.user),
					organization_name: reminderOrg?.name ?? "organization",
					role: invitation.role ?? "member",
				},
				eventType: authEmailEvents.organization.member.inviteReminder,
				recipient: invitation.email,
			});
			return jsonResponse(200, { status: true }, headers);
		}

if (path === "/organization/get-invitation" && method === "GET") {
			await requireSession(request, currentStores);
			const invitationId = new URL(request.url).searchParams.get(
				"invitationId",
			);
			if (!invitationId) {
				throw AthenaAuthRuntimeError.badRequest("invitationId is required");
			}
			const invitation = await currentStores.getInvitation(invitationId);
			if (!invitation) {
				throw AthenaAuthRuntimeError.notFound("Invitation not found");
			}
			return jsonResponse(
				200,
				{ invitation: toPublicInvitation(invitation) },
				headers,
			);
		}

if (path === "/organization/list-user-invitations" && method === "GET") {
			const resolved = await requireSession(request, currentStores);
			const email = resolved.user.email;
			const invitations = email
				? await currentStores.listInvitationsForEmail(email)
				: [];
			return jsonResponse(
				200,
				invitations.map((invitation) => toPublicInvitation(invitation)),
				headers,
			);
		}

if (path === "/organization/reject-invitation" && method === "POST") {
			const resolved = await requireSession(request, currentStores);
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const invitationId = requireStringField(body, "invitationId");
			const invitation = await currentStores.getInvitation(invitationId);
			if (!invitation) {
				throw AthenaAuthRuntimeError.notFound("Invitation not found");
			}
			const actor = await currentStores.getMember(
				invitation.organization_id,
				resolved.user.id,
			);
			const isInvitee =
				invitation.email &&
				resolved.user.email &&
				invitation.email === resolved.user.email;
			if (
				!(
					isInvitee ||
					(actor && (actor.role === "owner" || actor.role === "admin"))
				)
			) {
				throw AthenaAuthRuntimeError.forbidden();
			}
			await mutate({
				context: {
					actor: {
						kind: "user",
						organizationId: invitation.organization_id,
						sessionId: resolved.session.id,
						userId: resolved.user.id,
					},
					request: hookRequest(request, path),
					traceId,
				},
				event: "organization.invitation.reject",
				execute: async (scope) => {
					await scope.stores.updateInvitationStatus(invitation.id, "rejected");
				},
				input: { invitationId },
				previous: async () => ({
					invitation: sanitizeHookInvitation(invitation),
				}),
				resultOf: () => ({
					invitation: sanitizeHookInvitation({
						...invitation,
						status: "rejected",
					}),
				}),
			});
			return jsonResponse(200, { status: true }, headers);
		}

	return undefined;
}
