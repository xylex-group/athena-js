interface ApplicationLifecycleScope {
  actorUserId?: string;
  application: string;
  isActive: () => boolean;
  organizationId: string;
  userId: string;
}

const scopes = new WeakMap<object, ApplicationLifecycleScope>();

export function createApplicationLifecycleCapability(
  scope: ApplicationLifecycleScope,
): object {
  const capability = Object.freeze({});
  scopes.set(capability, scope);
  return capability;
}

export function isApplicationLifecycleCapabilityFor(
  capability: unknown,
  input: {
    applicationKey?: string;
    actorUserId?: string;
    memberUserId?: string;
    organizationId?: string | null;
  },
): boolean {
  if (typeof capability !== "object" || capability === null) return false;
  const scope = scopes.get(capability);
  if (!scope?.isActive() || scope.organizationId !== input.organizationId) return false;
  if (input.actorUserId !== scope.actorUserId) return false;
  if (input.memberUserId && input.memberUserId !== scope.userId) return false;
  return (
    input.applicationKey === undefined ||
    input.applicationKey.startsWith(`application_${scope.application}_`)
  );
}
