import type {
  AthenaAuthAuthorizationBindings,
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthQueryValue,
  AthenaAuthRequestInput,
  AthenaAuthResult,
} from "../types.ts";

type AuthorizationRequest = <T = unknown>(
  input: AthenaAuthRequestInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<T>>;

function rolePath(id: string): `/authorization/roles/${string}` {
  return `/authorization/roles/${encodeURIComponent(id)}`;
}

function asQuery(
  query: Record<string, unknown> | undefined
): Record<string, AthenaAuthQueryValue> | undefined {
  if (!query) {
    return;
  }
  return query as Record<string, AthenaAuthQueryValue>;
}

export function createAuthorizationModule(
  request: AuthorizationRequest
): AthenaAuthAuthorizationBindings {
  return {
    cloneRole: (input, options) =>
      request(
        {
          body: input,
          endpoint: "/authorization/roles/clone",
          method: "POST",
        },
        options
      ),
    createRole: (input, options) =>
      request(
        {
          body: input,
          endpoint: "/authorization/roles",
          method: "POST",
        },
        options
      ),
    deleteRole: (input, options) =>
      request(
        {
          body: input,
          endpoint: rolePath(input.id),
          method: "DELETE",
          query: {
            expectedVersion: input.expectedVersion,
            reassignmentRoleId: input.reassignmentRoleId ?? undefined,
          },
        },
        options
      ),
    getRole: (input, options) =>
      request(
        {
          endpoint: rolePath(input.id),
          method: "GET",
          query: {
            organizationId: input.organizationId,
            scope: input.scope,
          },
        },
        options
      ),
    getSnapshot: (input, options) =>
      request(
        {
          endpoint: "/authorization/snapshot",
          fetchOptions: (input as AthenaAuthFetchCompatibleInput | undefined)
            ?.fetchOptions,
          method: "GET",
        },
        options
      ),
    listAudit: (input, options) =>
      request(
        {
          endpoint: "/authorization/audit",
          method: "GET",
          query: asQuery(
            (input as { query?: Record<string, unknown> } | undefined)?.query
          ),
        },
        options
      ),
    listMemberAssignments: (input, options) =>
      request(
        {
          endpoint: "/authorization/assignments/members",
          method: "GET",
          query: asQuery(
            (input as { query?: Record<string, unknown> } | undefined)?.query
          ),
        },
        options
      ),
    listRights: (input, options) =>
      request(
        {
          endpoint: "/authorization/rights",
          fetchOptions: (input as AthenaAuthFetchCompatibleInput | undefined)
            ?.fetchOptions,
          method: "GET",
        },
        options
      ),
    listRoles: (input, options) =>
      request(
        {
          endpoint: "/authorization/roles",
          fetchOptions: (input as AthenaAuthFetchCompatibleInput | undefined)
            ?.fetchOptions,
          method: "GET",
          query: asQuery(
            (input as { query?: Record<string, unknown> } | undefined)?.query
          ),
        },
        options
      ),
    listUserAssignments: (input, options) =>
      request(
        {
          endpoint: "/authorization/assignments/users",
          fetchOptions: (input as AthenaAuthFetchCompatibleInput | undefined)
            ?.fetchOptions,
          method: "GET",
        },
        options
      ),
    replaceMemberRoleAssignments: (input, options) =>
      request(
        {
          body: input,
          endpoint: `/authorization/assignments/members/${encodeURIComponent(input.memberId)}`,
          method: "PUT",
        },
        options
      ),
    replaceRoleRights: (input, options) =>
      request(
        {
          body: input,
          endpoint: `${rolePath(input.id)}/rights`,
          method: "PUT",
        },
        options
      ),
    replaceUserRoleAssignments: (input, options) =>
      request(
        {
          body: input,
          endpoint: `/authorization/assignments/users/${encodeURIComponent(input.userId)}`,
          method: "PUT",
        },
        options
      ),
    updateRole: (input, options) =>
      request(
        {
          body: input,
          endpoint: rolePath(input.id),
          method: "PATCH",
        },
        options
      ),
  };
}
