import { AthenaAuthRuntimeError } from "../../auth/local/errors.ts";
import type { AthenaAuthorizationRoleScope } from "./types.ts";

/**
 * Organization custom roles are tenant-owned. Built-in organization templates
 * (`organization_id` NULL) may be cloned into the actor's organization.
 * Another organization's custom role must never be a clone source.
 */
export function assertCloneRoleTenantBoundary(input: {
  sourceOrganizationId: string | null;
  sourceScopeKind: AthenaAuthorizationRoleScope;
  targetOrganizationId: string | null | undefined;
}): void {
  const targetOrganizationId = input.targetOrganizationId ?? null;
  if (input.sourceScopeKind === "platform" && targetOrganizationId) {
    throw AthenaAuthRuntimeError.badRequest(
      "Platform roles cannot be cloned into an organization"
    );
  }
  if (input.sourceScopeKind === "organization" && !targetOrganizationId) {
    throw AthenaAuthRuntimeError.badRequest(
      "Organization roles must be cloned into an organization"
    );
  }
  if (
    input.sourceScopeKind === "organization" &&
    input.sourceOrganizationId !== null &&
    input.sourceOrganizationId !== targetOrganizationId
  ) {
    throw AthenaAuthRuntimeError.forbidden();
  }
}
