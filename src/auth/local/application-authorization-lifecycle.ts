import type { AthenaAuthLifecycleAuthorization } from "../hooks/types.ts";
import type { AthenaAuthActor } from "../domain/context.ts";
import type { AthenaAuthStores } from "./store-contract.ts";
import { createApplicationLifecycleCapability } from "../../runtime/authorization/application-lifecycle-capability.ts";

const APPLICATION_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const ROLE_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const RETRIES = 3;

interface LifecycleScope {
  actorUserId?: string;
  application: string;
  isActive: () => boolean;
  organizationId: string;
  userId: string;
}

function assertLifecycleScope(
  input: { application: string; organizationId: string },
  scope: LifecycleScope,
) {
  if (!scope.isActive()) {
    throw new Error("Athena lifecycle authorization is no longer active.");
  }
  if (
    input.application !== scope.application ||
    input.organizationId !== scope.organizationId
  ) {
    throw new Error("Athena lifecycle authorization is scoped to its triggering application and organization.");
  }
}

function rolePrefix(application: string) {
  if (!APPLICATION_KEY.test(application)) {
    throw new Error("Invalid application authorization role key.");
  }
  return `application_${application}_`;
}

function roleKey(application: string, key: string) {
  if (!ROLE_KEY.test(key)) {
    throw new Error("Invalid application authorization role key.");
  }
  return `${rolePrefix(application)}${key}`;
}

export function createApplicationAuthorizationLifecycle(
  stores: AthenaAuthStores,
  applicationRightKeys: readonly string[],
  actor: AthenaAuthActor,
  scope: LifecycleScope,
): AthenaAuthLifecycleAuthorization {
  const allowedRights = new Set(applicationRightKeys);
  const lifecycleCapability = createApplicationLifecycleCapability(scope);
  return {
    async reconcileOrganizationRoles({ application, organizationId, roles }) {
      assertLifecycleScope({ application, organizationId }, scope);
      const definitions = roles.map((role) => ({
        ...role,
        applicationKey: roleKey(application, role.key),
        name: role.name.trim(),
        rights: [...new Set(role.rights)].sort(),
      }));
      const keys = new Set<string>();
      for (const role of definitions) {
        if (!role.name) {
          throw new Error(`Application role ${role.key} must have a non-empty name.`);
        }
        if (keys.has(role.applicationKey)) {
          throw new Error(`Duplicate application authorization role ${role.key}.`);
        }
        keys.add(role.applicationKey);
        if (role.rights.some((right) => !allowedRights.has(right))) {
          throw new Error(`Application role ${role.key} contains a right not contributed by the application.`);
        }
      }

      for (const definition of definitions) {
        assertLifecycleScope({ application, organizationId }, scope);
        let reconciled = false;
        for (let attempt = 0; attempt < RETRIES; attempt += 1) {
          const current = (await stores.authorization.listRoles({
            organizationId,
            scopeKind: "organization",
          })).find((role) => role.key === definition.applicationKey);
          if (!current) {
            try {
              await stores.authorization.createRole({
                actorRights: [],
                actorUserId: actor.userId,
                applicationManaged: true,
                applicationKey: definition.applicationKey,
                lifecycleCapability,
                name: definition.name,
                organizationId,
                rights: definition.rights,
                scopeKind: "organization",
              });
              reconciled = true;
              break;
            } catch (error) {
              const concurrent = (await stores.authorization.listRoles({
                organizationId,
                scopeKind: "organization",
              })).some((role) => role.key === definition.applicationKey);
              if (!concurrent || attempt === RETRIES - 1) throw error;
            }
            continue;
          }
          const detail = await stores.authorization.getRole(current.id, organizationId);
          if (!detail) continue;
          const rights = [...detail.rights].sort();
          if (
            detail.name === definition.name &&
            detail.protected &&
            !detail.assignable &&
            rights.length === definition.rights.length &&
            rights.every((right, index) => right === definition.rights[index])
          ) {
            reconciled = true;
            break;
          }
          try {
            await stores.authorization.updateRole({
                actorRights: [],
                actorUserId: actor.userId,
                applicationManaged: true,
                expectedVersion: current.version,
                id: current.id,
                lifecycleCapability,
              name: definition.name,
              organizationId,
              rights: definition.rights,
            });
            reconciled = true;
            break;
          } catch (error) {
            if (attempt === RETRIES - 1) throw error;
          }
        }
        if (!reconciled) {
          throw new Error(`Could not reconcile application role ${definition.applicationKey}.`);
        }
      }
    },

    async replaceMemberApplicationRole({
      application,
      organizationId,
      preserveRoleKeys = [],
      roleKey: key,
      userId,
    }) {
      assertLifecycleScope({ application, organizationId }, scope);
      if (userId !== scope.userId) {
        throw new Error("Athena lifecycle authorization is scoped to its triggering member.");
      }
      const targetKey = roleKey(application, key);
      for (let attempt = 0; attempt < RETRIES; attempt += 1) {
        assertLifecycleScope({ application, organizationId }, scope);
        const member = (await stores.listMembers(organizationId)).find(
          (candidate) => candidate.user_id === userId,
        );
        if (!member) throw new Error("Athena member was not found for lifecycle role assignment.");
        const roles = await stores.authorization.listRoles({
          organizationId,
          scopeKind: "organization",
        });
        const targetRole = roles.find(({ key: candidate }) => candidate === targetKey);
        if (!targetRole) throw new Error(`Application role ${targetKey} is not materialized.`);
        const detail = await stores.authorization.getRole(targetRole.id, organizationId);
        if (!detail) throw new Error(`Application role ${targetKey} is not materialized.`);
        if (detail.rights.some((right) => !allowedRights.has(right))) {
          throw new Error(`Application role ${targetKey} contains a right not contributed by the application.`);
        }
        if (!detail.protected || detail.assignable) {
          throw new Error(`Application role ${targetKey} is not application-managed.`);
        }
        const prefix = rolePrefix(application);
        const managed = new Set(
          roles
            .filter(({ key: candidate }) => candidate.startsWith(prefix))
            .map(({ id }) => id),
        );
        const snapshot = await stores.authorization.readMemberRoleAssignmentsSnapshot({
          organizationId,
        });
        const assignment = snapshot.assignments.find(({ memberId }) => memberId === member.id);
        if (!assignment) throw new Error("Athena member assignment was not found.");
        const managedKeys = new Map(
          roles
            .filter(({ key: candidate }) => candidate.startsWith(prefix))
            .map(({ id, key: candidate }) => [id, candidate.slice(prefix.length)]),
        );
        const preservedRoleId = assignment.roleIds.find((id) =>
          preserveRoleKeys.includes(managedKeys.get(id) ?? ""),
        );
        const selectedRole = preservedRoleId ?? targetRole.id;
        const roleIds = [...new Set([
          ...assignment.roleIds.filter((id) => !managed.has(id)),
          selectedRole,
        ])].sort();
        if (
          roleIds.length === assignment.roleIds.length &&
          roleIds.every((id, index) => id === [...assignment.roleIds].sort()[index])
        ) return { changed: false };
        try {
          await stores.authorization.replaceMemberRoleAssignments({
            actorRights: [],
            actorUserId: actor.userId,
            expectedVersion: snapshot.revision,
            memberId: member.id,
            memberUserId: userId,
            organizationId,
            lifecycleCapability,
            roleIds,
          });
          return { changed: true };
        } catch (error) {
          if (attempt === RETRIES - 1) throw error;
        }
      }
      throw new Error("Could not reconcile application role assignment after concurrent updates.");
    },
  };
}
