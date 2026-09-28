import {
  type AthenaRightsAuthority,
  createAthenaRightsAuthority,
} from "../../rights/authority.ts";
import { getAthenaAuthorizationRightsIr } from "./catalog.ts";
import { canonicalizeAthenaRightsIr } from "../../rights/ir/canonicalize.ts";
import { fingerprintAthenaRightsIr } from "../../rights/ir/fingerprint.ts";
import type { AthenaRightsIr } from "../../rights/types.ts";
import {
  canonicalizeAthenaRolesIr,
  fingerprintAthenaRolesIr,
  hydrateAthenaRoleDefinition,
} from "../../roles/index.ts";
import type { AthenaRolesIr } from "../../roles/types.ts";
import type { AthenaAuthorizationInspectGraph } from "./inspect.ts";

export interface AthenaAuthorizationIrState {
  readonly rightsAuthority: AthenaRightsAuthority;
  readonly rightsFingerprint: string;
  readonly rightsIr: AthenaRightsIr;
  readonly rolesFingerprint?: string;
  readonly rolesIr?: AthenaRolesIr;
}

export function resolveAthenaAuthorizationIrState(
  input: { rightsIr?: AthenaRightsIr; rolesIr?: AthenaRolesIr } = {}
): AthenaAuthorizationIrState {
  const rightsIr = canonicalizeAthenaRightsIr(
    input.rightsIr ?? getAthenaAuthorizationRightsIr()
  );
  const rightsAuthority = createAthenaRightsAuthority(rightsIr);
  const rolesIr = input.rolesIr
    ? canonicalizeAthenaRolesIr(input.rolesIr, rightsAuthority)
    : undefined;
  return {
    rightsAuthority,
    rightsFingerprint: fingerprintAthenaRightsIr(rightsIr),
    rightsIr,
    ...(rolesIr
      ? {
          rolesFingerprint: fingerprintAthenaRolesIr(rolesIr, rightsAuthority),
          rolesIr,
        }
      : {}),
  };
}

export function rolesIrFromAuthorizationGraph(
  graph: AthenaAuthorizationInspectGraph,
  rightsAuthority: AthenaRightsAuthority
): AthenaRolesIr {
  return canonicalizeAthenaRolesIr(
    {
      irVersion: 1,
      kind: "athena.roles",
      metadata: { provenance: ["authorization-store"] },
      roles: graph.roles.map((role) =>
        hydrateAthenaRoleDefinition(
          {
            record: {
              assignable: role.assignable,
              id: role.id,
              key: role.key,
              name: role.name,
              organizationId: role.organizationId,
              protected: role.protected,
              scopeKind: role.scopeKind,
              systemKind: role.systemKind,
            },
            rights: role.rights,
          },
          rightsAuthority
        )
      ),
    },
    rightsAuthority
  );
}
