import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { AthenaRightsAuthority } from "../../rights/authority.ts";
import type { AthenaRoleDefinition, AthenaRolesIr } from "../types.ts";
import { canonicalizeAthenaRolesIr } from "./canonicalize.ts";

function semanticRole(role: AthenaRoleDefinition): Record<string, unknown> {
  return {
    displayName: role.displayName,
    id: role.id,
    key: role.key,
    ...(role.description === undefined
      ? {}
      : { description: role.description }),
    assignable: role.assignable,
    protected: role.protected,
    rights: role.rights,
    scope: role.scope,
    systemKind: role.systemKind,
  };
}

export function fingerprintAthenaRolesIr(
  value: AthenaRolesIr,
  rightsAuthority: AthenaRightsAuthority
): string {
  const canonical = canonicalizeAthenaRolesIr(value, rightsAuthority);
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          irVersion: canonical.irVersion,
          kind: canonical.kind,
          roles: canonical.roles.map(semanticRole),
        })
      )
    )
  );
}
