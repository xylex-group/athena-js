import type { AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import {
  AUTHORIZATION_PLATFORM_READ,
  AUTHORIZATION_PLATFORM_WRITE,
  AUTHORIZATION_ROLES_READ,
  AUTHORIZATION_ROLES_WRITE,
  getAthenaAuthorizationRightsIr,
  ORGANIZATION_MEMBERS_READ,
  ORGANIZATION_MEMBERS_WRITE,
} from "../../runtime/authorization/catalog.ts";
import {
  requireExpectedVersion,
  throwAssignmentVersionConflict,
} from "../../runtime/authorization/role-invariants.ts";
import type { AuthDomainMutate } from "../hooks/execute.ts";
import type { AthenaAuthHookMember } from "../hooks/sanitize.ts";
import { sanitizeHookMember } from "../hooks/sanitize.ts";
import type { AthenaAuthMutationScope } from "../hooks/scope.ts";
import { apiKeyScopeKind, bindApiKeyAuthorization } from "./api-key.ts";
import {
  verifiedAuthorizationCommandScope,
  verifiedOrganizationScope,
} from "./authorization-guard.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { ResolvedApiKeyPrincipal } from "./extended-routes.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import {
  type AuthSessionRow,
  type AuthUserRow,
  toPublicMemberWithUser,
} from "./models.ts";
import { resolveFoundingOwnerUserId } from "./organization-invariants.ts";
import { asStringField, readJsonBody, requireStringField } from "./security.ts";

type OrganizationApiKeyRead = {
  organizationId: string;
};

async function organizationApiKeyRead(
  request: Request,
  stores: AthenaAuthStores,
  resolveApiKey: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<ResolvedApiKeyPrincipal | undefined>,
  right: AthenaRightKey
): Promise<OrganizationApiKeyRead | undefined> {
  const resolved = await resolveApiKey(request, stores);
  if (!resolved) {
    return;
  }
  if (requestedAuthorizationScope(request) === "platform") {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const organizationId = resolved.key.organization_id;
  if (apiKeyScopeKind(resolved.key) !== "organization" || !organizationId) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const verifiedOrganizationId = verifiedOrganizationScope({
    activeOrganizationId: organizationId,
    requestedOrganizationId:
      new URL(request.url).searchParams.get("organizationId") ?? undefined,
  });
  const owner = await buildSnapshot(stores, {
    session: { active_organization_id: verifiedOrganizationId },
    user: resolved.user,
  });
  const snapshot = bindApiKeyAuthorization(
    owner,
    resolved.permissions,
    "organization"
  );
  if (missingRequiredRights(snapshot.effectiveRights, [right]).length > 0) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  return { organizationId: verifiedOrganizationId };
}

function asStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function requestedAuthorizationScope(
  request: Request,
  body?: Record<string, unknown>
): "organization" | "platform" | undefined {
  const fromBody = typeof body?.scope === "string" ? body.scope : undefined;
  const fromQuery = new URL(request.url).searchParams.get("scope");
  const value = fromBody ?? fromQuery;
  if (value === "platform" || value === "organization") {
    return value;
  }
}

function roleIdFromPath(path: string): string | undefined {
  const match = /^\/authorization\/roles\/([^/]+)(?:\/rights)?$/.exec(path);
  const id = match?.[1];
  if (!id || id === "clone") {
    return;
  }
  return id;
}

export async function handleAuthorizationRoute(
  request: Request,
  path: string,
  method: string,
  stores: AthenaAuthStores,
  headers: Headers,
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ session: AuthSessionRow; user: AuthUserRow }>,
  bodyLimitBytes: number,
  resolveApiKey: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<ResolvedApiKeyPrincipal | undefined>,
  mutate: AuthDomainMutate
): Promise<Response | undefined> {
  if (path === "/authorization/snapshot" && method === "GET") {
    const resolved = await requireSession(request, stores);
    const snapshot = await buildSnapshot(stores, resolved);
    return jsonResponse(200, snapshot, headers);
  }

  if (path === "/authorization/rights" && method === "GET") {
    const apiKeyRead = await organizationApiKeyRead(
      request,
      stores,
      resolveApiKey,
      AUTHORIZATION_ROLES_READ
    );
    if (apiKeyRead) {
      return jsonResponse(
        200,
        { rights: getAthenaAuthorizationRightsIr().rights },
        headers
      );
    }
    const resolved = await requireSession(request, stores);
    const snapshot = await buildSnapshot(stores, resolved);
    const lacksPlatformRead =
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_PLATFORM_READ,
      ]).length > 0;
    const lacksOrganizationRoleRead =
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_ROLES_READ,
      ]).length > 0;
    if (lacksPlatformRead && lacksOrganizationRoleRead) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    return jsonResponse(
      200,
      { rights: getAthenaAuthorizationRightsIr().rights },
      headers
    );
  }

  if (path === "/authorization/roles" && method === "GET") {
    const apiKeyRead = await organizationApiKeyRead(
      request,
      stores,
      resolveApiKey,
      AUTHORIZATION_ROLES_READ
    );
    if (apiKeyRead) {
      const roles = await stores.authorization.listRoles({
        organizationId: apiKeyRead.organizationId,
        scopeKind: "organization",
      });
      return jsonResponse(200, { roles }, headers);
    }
    const resolved = await requireSession(request, stores);
    const command = await requireRoleAccess(stores, resolved, request, "read");
    const roles = await stores.authorization.listRoles({
      organizationId: command.scope.organizationId,
      scopeKind: command.scope.kind,
    });
    return jsonResponse(200, { roles }, headers);
  }

  if (path === "/authorization/roles" && method === "POST") {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body
    );
    const name = requireStringField(body, "name");
    const role = await stores.authorization.createRole({
      actorRights: command.snapshot.effectiveRights,
      actorUserId: resolved.user.id,
      name,
      organizationId: command.scope.organizationId,
      rights: asStringArray(body, "rights"),
      scopeKind: command.scope.kind,
      unrestrictedGrant: command.unrestrictedGrant,
    });
    return jsonResponse(200, { role }, headers);
  }

  if (path === "/authorization/roles/clone" && method === "POST") {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const sourceRoleId = requireStringField(body, "sourceRoleId");
    const name = asStringField(body, "name") ?? "Cloned role";
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body
    );
    if (command.scope.kind === "organization") {
      const member = await stores.getMember(
        command.scope.organizationId ?? "",
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
    }
    const cloned = await stores.authorization.cloneRole({
      actorRights: command.snapshot.effectiveRights,
      actorUserId: resolved.user.id,
      name,
      organizationId: command.scope.organizationId,
      sourceRoleId,
      unrestrictedGrant: command.unrestrictedGrant,
    });
    return jsonResponse(200, { role: cloned }, headers);
  }

  const roleId = roleIdFromPath(path);
  if (
    method === "GET" &&
    (path === "/authorization/roles/{id}" ||
      (Boolean(roleId) && path === `/authorization/roles/${roleId}`))
  ) {
    const apiKeyRead = await organizationApiKeyRead(
      request,
      stores,
      resolveApiKey,
      AUTHORIZATION_ROLES_READ
    );
    if (apiKeyRead) {
      const role = await stores.authorization.getRole(
        roleIdFromPath(path) ?? "",
        apiKeyRead.organizationId
      );
      if (!role) {
        throw AthenaAuthRuntimeError.notFound("Role not found");
      }
      return jsonResponse(200, { role }, headers);
    }
    const resolved = await requireSession(request, stores);
    const command = await requireRoleAccess(stores, resolved, request, "read");
    const id = roleIdFromPath(path) ?? "";
    const role = await stores.authorization.getRole(
      id,
      command.scope.organizationId
    );
    if (!role) {
      throw AthenaAuthRuntimeError.notFound("Role not found");
    }
    return jsonResponse(200, { role }, headers);
  }

  if (
    method === "PATCH" &&
    (path === "/authorization/roles/{id}" ||
      (Boolean(roleId) && path === `/authorization/roles/${roleId}`))
  ) {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body
    );
    const id = roleIdFromPath(path) ?? "";
    const rights = Array.isArray(body.rights)
      ? asStringArray(body, "rights")
      : undefined;
    const existing = await stores.authorization.getRole(
      id,
      command.scope.organizationId
    );
    if (!existing) {
      throw AthenaAuthRuntimeError.notFound("Role not found");
    }
    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name
        : existing.name;
    if (rights === undefined && typeof body.name !== "string") {
      throw AthenaAuthRuntimeError.badRequest("name or rights is required");
    }
    const role = await stores.authorization.updateRole({
      actorRights: command.snapshot.effectiveRights,
      actorUserId: resolved.user.id,
      expectedVersion: requireExpectedVersion(body.expectedVersion),
      id,
      name,
      organizationId: command.scope.organizationId,
      ...(rights ? { rights } : {}),
      unrestrictedGrant: command.unrestrictedGrant,
    });
    return jsonResponse(200, { role }, headers);
  }

  if (
    method === "PUT" &&
    (path === "/authorization/roles/{id}/rights" ||
      (Boolean(roleId) && path === `/authorization/roles/${roleId}/rights`))
  ) {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body
    );
    const id = roleIdFromPath(path) ?? "";
    const role = await stores.authorization.replaceRoleRights({
      actorRights: command.snapshot.effectiveRights,
      actorUserId: resolved.user.id,
      expectedVersion: requireExpectedVersion(body.expectedVersion),
      id,
      organizationId: command.scope.organizationId,
      rights: asStringArray(body, "rights"),
      unrestrictedGrant: command.unrestrictedGrant,
    });
    return jsonResponse(200, { role }, headers);
  }

  if (
    method === "DELETE" &&
    (path === "/authorization/roles/{id}" ||
      (Boolean(roleId) && path === `/authorization/roles/${roleId}`))
  ) {
    const resolved = await requireSession(request, stores);
    const url = new URL(request.url);
    let body: Record<string, unknown> = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await readJsonBody(request, bodyLimitBytes);
    }
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body
    );
    const reassignmentRoleId =
      asStringField(body, "reassignmentRoleId") ??
      url.searchParams.get("reassignmentRoleId");
    const id = roleIdFromPath(path) ?? "";
    const role = await stores.authorization.getRole(
      id,
      command.scope.organizationId
    );
    const organizationId =
      role?.scopeKind === "organization"
        ? (role.organizationId ?? undefined)
        : undefined;
    const normalizedReassignmentRoleId = reassignmentRoleId ?? undefined;
    const deleteRole = (targetStores: AthenaAuthStores) =>
      targetStores.authorization.deleteRole({
        actorUserId: resolved.user.id,
        expectedVersion: requireExpectedVersion(
          body.expectedVersion ?? url.searchParams.get("expectedVersion")
        ),
        id,
        organizationId: command.scope.organizationId,
        reassignmentRoleId: normalizedReassignmentRoleId,
      });
    if (organizationId) {
      await mutate<
        "authorization.role.delete",
        {
          id: string;
          changes: Array<{
            member: AthenaAuthHookMember;
            previousRoleIds: readonly string[];
            roleIds: readonly string[];
          }>;
        }
      >({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: {
            method: request.method.toUpperCase(),
            path: new URL(request.url).pathname,
            userAgent: request.headers.get("user-agent") ?? undefined,
          },
          traceId: crypto.randomUUID(),
        },
        event: "authorization.role.delete",
        execute: async (scope: AthenaAuthMutationScope) => {
          const connections = await scope.stores.listIdentityConnections(
            organizationId
          );
          if (
            connections.some(
              (connection) => connection.jit_default_role_id === id
            )
          ) {
            throw new AthenaAuthRuntimeError(
              409,
              "The role is referenced by an identity connection",
              { code: "ATHENA_AUTH_IDENTITY_CONNECTION_ROLE_IN_USE" }
            );
          }
          const before = await scope.stores.authorization.readMemberRoleAssignmentsSnapshot({
            organizationId,
          });
          const deleted = await deleteRole(scope.stores);
          const after = await scope.stores.authorization.readMemberRoleAssignmentsSnapshot({
            organizationId,
          });
          const previousByMember = new Map(
            before.assignments.map((assignment) => [assignment.memberId, assignment])
          );
          const nextByMember = new Map(
            after.assignments.map((assignment) => [assignment.memberId, assignment.roleIds])
          );
          const members = await scope.stores.listMembers(organizationId);
          const changes = await Promise.all(
            deleted.reassignedMemberIds.map(async (memberId) => {
              const previous = previousByMember.get(memberId);
              if (!previous) {
                throw AthenaAuthRuntimeError.internal(
                  new Error("ATHENA_AUTH_ROLE_ASSIGNMENT_MEMBER_MISSING")
                );
              }
              const member = members.find(
                (entry) => entry.id === memberId
              );
              if (!member) {
                throw AthenaAuthRuntimeError.internal(
                  new Error("ATHENA_AUTH_ROLE_REASSIGNMENT_MEMBER_MISSING")
                );
              }
              return {
                member: await toPublicMemberWithUser(member, (userId) =>
                  scope.stores.getUserById(userId)
                ),
                previousRoleIds: previous.roleIds,
                roleIds: nextByMember.get(memberId) ?? [],
              };
            })
          );
          return { changes, id };
        },
        input: {
          organizationId,
          reassignmentRoleId: normalizedReassignmentRoleId,
          roleId: id,
        },
        previous: async () => ({ roleId: id }),
        resultOf: (result: {
          id: string;
          changes: Array<{
            member: AthenaAuthHookMember;
            previousRoleIds: readonly string[];
            roleIds: readonly string[];
          }>;
        }) => ({
          changes: result.changes.map((change) => ({ ...change })),
          deleted: true,
          id: result.id,
        }),
        secondaryEvents: (result: {
          changes: Array<{
            member: AthenaAuthHookMember;
            previousRoleIds: readonly string[];
            roleIds: readonly string[];
          }>;
        }) =>
          result.changes.map((change) => ({
            event: "authorization.member.roles.replace" as const,
            input: {
              changes: [{ memberId: change.member.id, roleIds: change.roleIds }],
              organizationId,
            },
            previous: {
              changes: [
                {
                  memberId: change.member.id,
                  roleIds: change.previousRoleIds,
                },
              ],
            },
            result: { changes: [change] },
          })),
      });
    } else {
      await deleteRole(stores);
    }
    return jsonResponse(200, { ok: true }, headers);
  }

  if (path === "/authorization/audit" && method === "GET") {
    const resolved = await requireSession(request, stores);
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      undefined,
      undefined,
      "platform"
    );
    if (command.scope.kind === "organization") {
      const member = await stores.getMember(
        command.scope.organizationId ?? "",
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
    }
    const entries = await stores.authorization.listAudit({
      limit: 50,
      organizationId: command.scope.organizationId,
    });
    return jsonResponse(200, { entries }, headers);
  }

  if (path === "/authorization/assignments/users" && method === "GET") {
    const resolved = await requireSession(request, stores);
    await requireRoleAccess(
      stores,
      resolved,
      request,
      "read",
      undefined,
      "platform"
    );
    const users = await stores.listUsers();
    const assignmentSnapshot =
      await stores.authorization.readUserRoleAssignmentsSnapshot({
        userIds: users.map((user) => user.id),
      });
    const byUser = new Map(
      assignmentSnapshot.assignments.map((entry) => [
        entry.userId,
        entry.roleIds,
      ])
    );
    return jsonResponse(
      200,
      {
        revision: assignmentSnapshot.revision,
        users: users.map((user) => ({
          email: user.email,
          id: user.id,
          name: user.name,
          roleIds: byUser.get(user.id) ?? [],
        })),
      },
      headers
    );
  }

  const userAssignmentId =
    /^\/authorization\/assignments\/users\/([^/]+)$/.exec(path)?.[1];
  if (
    method === "PUT" &&
    (path === "/authorization/assignments/users/{userId}" ||
      Boolean(userAssignmentId))
  ) {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const command = await requireRoleAccess(
      stores,
      resolved,
      request,
      "write",
      body,
      "platform"
    );
    const userId = userAssignmentId ?? requireStringField(body, "userId");
    if (userId.trim().length === 0) {
      throw AthenaAuthRuntimeError.badRequest("userId is required");
    }
    const result = await stores.authorization.replaceUserRoleAssignments({
      actorRights: command.snapshot.effectiveRights,
      actorUserId: resolved.user.id,
      expectedVersion: requireExpectedVersion(body.expectedVersion),
      roleIds: asStringArray(body, "roleIds"),
      userId,
    });
    return jsonResponse(200, result, headers);
  }

  if (path === "/authorization/assignments/members" && method === "GET") {
    const apiKeyRead = await organizationApiKeyRead(
      request,
      stores,
      resolveApiKey,
      AUTHORIZATION_ROLES_READ
    );
    if (apiKeyRead) {
      const assignmentSnapshot =
        await stores.authorization.readMemberRoleAssignmentsSnapshot({
          organizationId: apiKeyRead.organizationId,
        });
      return jsonResponse(
        200,
        {
          assignments: assignmentSnapshot.assignments,
          revision: assignmentSnapshot.revision,
        },
        headers
      );
    }
    const resolved = await requireSession(request, stores);
    const snapshot = await buildSnapshot(stores, resolved);
    const canListMembers =
      missingRequiredRights(snapshot.effectiveRights, [
        ORGANIZATION_MEMBERS_READ,
      ]).length === 0 ||
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_ROLES_READ,
      ]).length === 0 ||
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_PLATFORM_READ,
      ]).length === 0 ||
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_PLATFORM_WRITE,
      ]).length === 0;
    if (!canListMembers) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    const organizationId = verifiedOrganizationScope({
      activeOrganizationId: resolved.session.active_organization_id,
      requestedOrganizationId:
        new URL(request.url).searchParams.get("organizationId") ?? undefined,
    });
    if (!(await stores.getMember(organizationId, resolved.user.id))) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    const assignmentSnapshot =
      await stores.authorization.readMemberRoleAssignmentsSnapshot({
        organizationId,
      });
    return jsonResponse(
      200,
      {
        assignments: assignmentSnapshot.assignments,
        revision: assignmentSnapshot.revision,
      },
      headers
    );
  }

  const memberAssignmentId =
    /^\/authorization\/assignments\/members\/([^/]+)$/.exec(path)?.[1];
  if (
    method === "PUT" &&
    (path === "/authorization/assignments/members/{memberId}" ||
      Boolean(memberAssignmentId))
  ) {
    const resolved = await requireSession(request, stores);
    const body = await readJsonBody(request, bodyLimitBytes);
    const snapshot = await buildSnapshot(stores, resolved);
    if (
      missingRequiredRights(snapshot.effectiveRights, [
        ORGANIZATION_MEMBERS_WRITE,
      ]).length > 0 &&
      missingRequiredRights(snapshot.effectiveRights, [
        AUTHORIZATION_PLATFORM_WRITE,
      ]).length > 0
    ) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    const organizationId = verifiedOrganizationScope({
      activeOrganizationId: resolved.session.active_organization_id,
      requestedOrganizationId:
        asStringField(body, "organizationId") ??
        new URL(request.url).searchParams.get("organizationId") ??
        undefined,
    });
    if (!(await stores.getMember(organizationId, resolved.user.id))) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    const id = memberAssignmentId ?? requireStringField(body, "memberId");
    if (id.trim().length === 0) {
      throw AthenaAuthRuntimeError.notFound("Member not found");
    }
    const orgMembers = await stores.listMembers(organizationId);
    const matched = orgMembers.find((entry) => entry.id === id);
    if (!matched) {
      throw AthenaAuthRuntimeError.notFound("Member not found");
    }
    const organization = await stores.getOrganization(organizationId);
    const roleIds = asStringArray(body, "roleIds");
    const normalize = (values: readonly string[]) =>
      [...new Set(values)].sort();
    const expectedVersion = requireExpectedVersion(body.expectedVersion);
    const before = await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
    if (before.revision !== expectedVersion) {
      throwAssignmentVersionConflict();
    }
    const previousRoleIds =
      before.assignments.find((assignment) => assignment.memberId === id)
        ?.roleIds ?? [];
    if (
      JSON.stringify(normalize(previousRoleIds)) ===
      JSON.stringify(normalize(roleIds))
    ) {
      return jsonResponse(200, { revision: before.revision }, headers);
    }
    const result = await mutate({
      context: {
        actor: {
          kind: "user",
          organizationId,
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: {
          method: request.method.toUpperCase(),
          path: new URL(request.url).pathname,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
        traceId: crypto.randomUUID(),
      },
      event: "authorization.member.roles.replace",
      execute: async (scope: AthenaAuthMutationScope) => {
        const current =
          await scope.stores.authorization.readMemberRoleAssignmentsSnapshot({
            organizationId,
          });
        const priorRoleIds =
          current.assignments.find((assignment) => assignment.memberId === id)
            ?.roleIds ?? [];
        const assignment =
          await scope.stores.authorization.replaceMemberRoleAssignments({
            actorRights: snapshot.effectiveRights,
            actorUserId: resolved.user.id,
            expectedVersion,
            foundingOwnerUserId: resolveFoundingOwnerUserId(
              organization,
              orgMembers
            ),
            memberId: id,
            memberUserId: matched.user_id,
            organizationId,
            roleIds,
          });
        const updated = await scope.stores.getMember(
          organizationId,
          matched.user_id
        );
        if (!updated) {
          throw AthenaAuthRuntimeError.internal(
            new Error("ATHENA_AUTH_ROLE_ASSIGNMENT_MEMBER_MISSING")
          );
        }
        const after =
          await scope.stores.authorization.readMemberRoleAssignmentsSnapshot({
            organizationId,
          });
        const nextRoleIds =
          after.assignments.find((entry) => entry.memberId === id)?.roleIds ?? [];
        return {
          member: await toPublicMemberWithUser(updated, (userId) =>
            scope.stores.getUserById(userId)
          ),
          previousRoleIds: priorRoleIds,
          roleIds: nextRoleIds,
          revision: assignment.revision,
        };
      },
      input: {
        changes: [{ memberId: id, roleIds: normalize(roleIds) }],
        organizationId,
      },
      previous: async () => ({
        changes: [{ memberId: id, roleIds: normalize(previousRoleIds) }],
      }),
      resultOf: (result) => ({
        changes: [
          {
            member: sanitizeHookMember(result.member),
            previousRoleIds: result.previousRoleIds,
            roleIds: result.roleIds,
          },
        ],
      }),
    });
    return jsonResponse(200, { revision: result.revision }, headers);
  }
}

async function requireRoleAccess(
  stores: AthenaAuthStores,
  resolved: { session: AuthSessionRow; user: AuthUserRow },
  request: Request,
  access: "read" | "write",
  body?: Record<string, unknown>,
  forcedScope?: "organization" | "platform",
  defaultScope?: "organization" | "platform"
) {
  const snapshot = await buildSnapshot(stores, resolved);
  const rights = snapshot.effectiveRights;
  const requestedScope =
    forcedScope ?? requestedAuthorizationScope(request, body);
  let orgRight: typeof AUTHORIZATION_ROLES_READ;
  let platformRight: typeof AUTHORIZATION_PLATFORM_READ;
  switch (access) {
    case "read":
      orgRight = AUTHORIZATION_ROLES_READ;
      platformRight = AUTHORIZATION_PLATFORM_READ;
      break;
    case "write":
      orgRight = AUTHORIZATION_ROLES_WRITE;
      platformRight = AUTHORIZATION_PLATFORM_WRITE;
      break;
    default: {
      const exhaustive: never = access;
      throw new Error(`unreachable authorization access: ${exhaustive}`);
    }
  }
  const orgOk = missingRequiredRights(rights, [orgRight]).length === 0;
  const platformOk =
    missingRequiredRights(rights, [platformRight]).length === 0;
  if (!(orgOk || platformOk)) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const requestedOrganizationId =
    asStringField(body ?? {}, "organizationId") ??
    new URL(request.url).searchParams.get("organizationId") ??
    undefined;
  const scope = verifiedAuthorizationCommandScope({
    activeOrganizationId: resolved.session.active_organization_id,
    canManageOrganizationRoles: orgOk,
    canManagePlatformRoles: platformOk,
    defaultScope,
    requestedOrganizationId,
    requestedScope,
  });
  if (scope.kind === "organization") {
    const member = await stores.getMember(
      scope.organizationId ?? "",
      resolved.user.id
    );
    if (!member) {
      throw AthenaAuthRuntimeError.forbidden();
    }
  }
  let unrestrictedGrant = false;
  if (scope.kind === "organization" && scope.organizationId) {
    const organization = await stores.getOrganization(scope.organizationId);
    const members = await stores.listMembers(scope.organizationId);
    unrestrictedGrant =
      resolveFoundingOwnerUserId(organization, members) === resolved.user.id;
  }
  return { scope, snapshot, unrestrictedGrant };
}

export async function buildSnapshot(
  stores: AthenaAuthStores,
  resolved: {
    session: Pick<AuthSessionRow, "active_organization_id">;
    user: Pick<AuthUserRow, "id">;
  }
) {
  const organizationId = resolved.session.active_organization_id;
  const organization = organizationId
    ? await stores.getOrganization(organizationId)
    : undefined;
  const members = organizationId
    ? await stores.listMembers(organizationId)
    : [];
  return stores.authorization.readSnapshot({
    activeOrganizationId: organizationId,
    foundingOwnerUserId: resolveFoundingOwnerUserId(organization, members),
    getMember: (orgId, userId) => stores.getMember(orgId, userId),
    listMembers: (orgId) => stores.listMembers(orgId),
    userId: resolved.user.id,
  });
}
