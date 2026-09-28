import type { AthenaPrincipalRightsProjection } from "../data/principal.ts";
import {
  effectiveRightsFromResolution,
  resolveStoredUserRightsResolution,
} from "../data/rights-resolution.ts";
import type { AthenaAuthorizationShadowDiagnostic } from "./types.ts";
import { ATHENA_AUTHORIZATION_SHADOW_KIND } from "./types.ts";

const listeners = new Set<
  (diagnostic: AthenaAuthorizationShadowDiagnostic) => void
>();

export function subscribeAthenaAuthorizationShadow(
  listener: (diagnostic: AthenaAuthorizationShadowDiagnostic) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthorizationShadow(
  diagnostic: AthenaAuthorizationShadowDiagnostic
): void {
  for (const listener of listeners) {
    listener(diagnostic);
  }
}

export function compareAuthorizationShadow(input: {
  assignedRights: readonly string[];
  legacyRights: readonly string[];
  userId: string;
}): AthenaAuthorizationShadowDiagnostic {
  const assigned = [...input.assignedRights].sort();
  const legacy = [...input.legacyRights].sort();
  const matched =
    assigned.length === legacy.length &&
    assigned.every((key, index) => key === legacy[index]);
  const diagnostic: AthenaAuthorizationShadowDiagnostic = {
    assignedRights: assigned,
    kind: ATHENA_AUTHORIZATION_SHADOW_KIND,
    legacyRights: legacy,
    matched,
    userId: input.userId,
  };
  emitAuthorizationShadow(diagnostic);
  return diagnostic;
}

export function legacyRightsFromProjection(
  user: {
    metadata?: unknown;
    rights?: readonly string[];
    role?: string | null;
  },
  authorization?: AthenaPrincipalRightsProjection
): readonly string[] {
  return effectiveRightsFromResolution(
    resolveStoredUserRightsResolution(user, authorization, {
      userId: "shadow",
    })
  );
}

export function hasLegacyRoleMap(
  authorization?: AthenaPrincipalRightsProjection
): boolean {
  return Object.keys(authorization?.rightsByRole ?? {}).length > 0;
}
