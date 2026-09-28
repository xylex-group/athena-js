import type {
  AthenaAdminHasPermissionRequest,
  AthenaAdminHasPermissionResponse,
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthGuardResult,
  AthenaAuthOrganization,
  AthenaAuthOrganizationBindings,
  AthenaAuthOrganizationCheckSlugRequest,
  AthenaAuthOrganizationCreateRequest,
  AthenaAuthOrganizationDeleteRequest,
  AthenaAuthOrganizationGetFullQuery,
  AthenaAuthOrganizationGetInvitationQuery,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationInvitationActionRequest,
  AthenaAuthOrganizationInviteMemberRequest,
  AthenaAuthOrganizationLeaveRequest,
  AthenaAuthOrganizationListInvitationsQuery,
  AthenaAuthOrganizationListMembersQuery,
  AthenaAuthOrganizationListUserInvitationsQuery,
  AthenaAuthOrganizationMember,
  AthenaAuthOrganizationRemoveMemberRequest,
  AthenaAuthOrganizationSetActiveRequest,
  AthenaAuthOrganizationUpdateMemberRoleRequest,
  AthenaAuthOrganizationUpdateRequest,
  AthenaAuthStatusResponse,
} from "../types.ts";
import type { AuthSessionMutationController } from "./session-mutations.ts";
import type { AuthTransport } from "./transport.ts";

export function createOrganizationClientModule(input: {
  mutations: AuthSessionMutationController;
  requirePermission: (
    endpoint: "/admin/has-permission" | "/organization/has-permission",
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthGuardResult>;
  transport: AuthTransport;
}): AthenaAuthOrganizationBindings {
  const { mutations, requirePermission, transport } = input;
  const { resolvedConfig } = transport;

  return {
    checkSlug: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput,
        { available: boolean }
      >(
        resolvedConfig,
        { endpoint: "/organization/check-slug", method: "POST" },
        input,
        options
      ),
    create: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: "/organization/create", method: "POST" },
        input,
        options
      ),
    delete: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/delete", method: "POST" },
        input,
        options
      ),
    getFull: (input, options) =>
      transport.executeGetWithQueryCompatibleInput<
        AthenaAuthOrganizationGetFullQuery,
        {
          organization: AthenaAuthOrganization;
          members?: AthenaAuthOrganizationMember[];
          invitations?: AthenaAuthOrganizationInvitation[];
        }
      >(
        resolvedConfig,
        { endpoint: "/organization/get-full-organization", method: "GET" },
        input,
        options
      ),
    hasPermission: (input, options) =>
      transport.postGeneric<AthenaAdminHasPermissionResponse>(
        "/organization/has-permission",
        input,
        options
      ),
    invitation: {
      accept: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/accept-invitation", method: "POST" },
          input,
          options
        ),
      cancel: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/cancel-invitation", method: "POST" },
          input,
          options
        ),
      get: (input, options) =>
        transport.executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationGetInvitationQuery,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: "/organization/get-invitation", method: "GET" },
          input,
          options
        ),
      list: (input, options) =>
        transport.executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListInvitationsQuery,
          AthenaAuthOrganizationInvitation[]
        >(
          resolvedConfig,
          { endpoint: "/organization/list-invitations", method: "GET" },
          input,
          options
        ),
      reject: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/reject-invitation", method: "POST" },
          input,
          options
        ),
    },
    leave: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/leave", method: "POST" },
        input,
        options
      ),
    list: (input, options) =>
      transport.getGeneric<AthenaAuthOrganization[]>(
        "/organization/list",
        input,
        options
      ),
    listUserInvitations: (input, options) =>
      transport.executeGetWithQueryCompatibleInput<
        AthenaAuthOrganizationListUserInvitationsQuery,
        AthenaAuthOrganizationInvitation[]
      >(
        resolvedConfig,
        { endpoint: "/organization/list-user-invitations", method: "GET" },
        input,
        options
      ),
    member: {
      getActive: (input, options) =>
        transport.executeGetWithCompatibleInput<AthenaAuthOrganizationMember>(
          resolvedConfig,
          { endpoint: "/organization/get-active-member", method: "GET" },
          input,
          options
        ),
      invite: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationInviteMemberRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: "/organization/invite-member", method: "POST" },
          input,
          options
        ),
      list: (input, options) =>
        transport.executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListMembersQuery,
          AthenaAuthOrganizationMember[]
        >(
          resolvedConfig,
          { endpoint: "/organization/list-members", method: "GET" },
          input,
          options
        ),
      remove: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationRemoveMemberRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/remove-member", method: "POST" },
          input,
          options
        ),
      updateRole: (input, options) =>
        transport.executePostWithCompatibleInput<
          AthenaAuthOrganizationUpdateMemberRoleRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/update-member-role", method: "POST" },
          input,
          options
        ),
    },
    requirePermission: (input, options) =>
      requirePermission("/organization/has-permission", input, options),
    setActive: async (input, options) => {
      const { fetchOptions } = transport.extractFetchOptions(input);
      const effectiveOptions = transport.mergeCallOptions(
        fetchOptions,
        options
      );
      const result = await transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/set-active", method: "POST" },
        input,
        options
      );
      if (!result.ok) {
        return result;
      }
      const organizationId =
        input && typeof input === "object" && "organizationId" in input
          ? (input as AthenaAuthOrganizationSetActiveRequest).organizationId
          : undefined;
      if (mutations.isSessionResponse(result.data)) {
        mutations.sessionStore.accept(result.data);
      }
      mutations.patchActiveOrganization(organizationId ?? null);
      await mutations.refreshSessionStore(undefined, effectiveOptions);
      return result;
    },
    update: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: "/organization/update", method: "POST" },
        input,
        options
      ),
  };
}
