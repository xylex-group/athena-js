import { ATHENA_BUILTIN_ROLE_DEFINITIONS } from "../../roles/builtin.ts";
import { fingerprintAthenaRolesIr } from "../../roles/ir/fingerprint.ts";
import {
  ATHENA_ROLES_IR_KIND,
  ATHENA_ROLES_IR_VERSION,
} from "../../roles/types.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  getAthenaAuthorizationRightsIr,
} from "./catalog.ts";
import { fingerprintAthenaRightsIr } from "../../rights/ir/fingerprint.ts";
import { createAthenaRightsAuthority } from "../../rights/authority.ts";
import type { AthenaRightsIr } from "../../rights/types.ts";

export { AUTHORIZATION_CATALOG_VERSION };

/**
 * Transaction-owned catalog materialization lock.
 * Distinct from Auth DDL (`ATHENA_AUTH_INIT_ADVISORY_LOCK`) and signing-key
 * activation. Must be `pg_advisory_xact_lock` on the transaction client.
 */
export const AUTHORIZATION_CATALOG_LOCK = 872_046_055;

export function authorizationRightsFingerprint(
  rightsIr: AthenaRightsIr = getAthenaAuthorizationRightsIr()
): string {
  return fingerprintAthenaRightsIr(rightsIr);
}

export function authorizationRolesFingerprint(
  rightsIr: AthenaRightsIr = getAthenaAuthorizationRightsIr()
): string {
  const rightsAuthority = createAthenaRightsAuthority(rightsIr);
  return fingerprintAthenaRolesIr({
    irVersion: ATHENA_ROLES_IR_VERSION,
    kind: ATHENA_ROLES_IR_KIND,
    metadata: {},
    roles: ATHENA_BUILTIN_ROLE_DEFINITIONS,
  }, rightsAuthority);
}

export function catalogStateIsCurrent(
  current:
    | {
        catalogVersion: number;
        rightsFingerprint: string;
        rolesFingerprint: string;
      }
    | undefined,
  rightsIr: AthenaRightsIr = getAthenaAuthorizationRightsIr()
): boolean {
  return (
    current !== undefined &&
    current.catalogVersion === AUTHORIZATION_CATALOG_VERSION &&
    current.rightsFingerprint === authorizationRightsFingerprint(rightsIr) &&
    current.rolesFingerprint === authorizationRolesFingerprint(rightsIr)
  );
}

export const AUTHORIZATION_CATALOG_STATE_SQL = `
CREATE TABLE IF NOT EXISTS athena.authorization_catalog_state (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    catalog_version INTEGER NOT NULL,
    materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rights_fingerprint TEXT NOT NULL,
    roles_fingerprint TEXT NOT NULL
);
`;
