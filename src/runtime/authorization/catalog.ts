import { BILLING_OPERATION_RIGHTS } from "../../billing/runtime/rights.ts";
import { BILLING_RIGHT_DEFINITIONS } from "../../billing/rights-catalog.ts";
import { STORAGE_RIGHT_DEFINITIONS } from "../../storage/rights-catalog.ts";
import {
  type AthenaRightsAuthority,
  createAthenaRightsAuthority,
} from "../../rights/authority.ts";
import type { AthenaRightContribution } from "../../rights/contribution.ts";
import { resolveAthenaRightsIr } from "../../rights/resolver.ts";
import type { AthenaRightDefinition, AthenaRightsIr } from "../../rights/types.ts";
import { AUTHORIZATION_RIGHT_DEFINITIONS } from "../../rights/definitions.ts";

export {
  defineAthenaRight,
  AUTHORIZATION_PLATFORM_DELEGATE,
  AUTHORIZATION_PLATFORM_READ,
  AUTHORIZATION_ROLES_DELEGATE,
  AUTHORIZATION_ROLES_READ,
  BILLING_PAYMENTS_READ,
  ORGANIZATION_MEMBERS_READ,
  ORGANIZATION_OWNERS_ASSIGN,
} from "../../rights/definitions.ts";
export {
  AUTHORIZATION_PLATFORM_WRITE,
  AUTHORIZATION_ROLES_WRITE,
  ORGANIZATION_LIFECYCLE_DELETE,
  ORGANIZATION_MEMBERS_INVITE,
  ORGANIZATION_MEMBERS_WRITE,
} from "./capability-rights.ts";

export const AUTHORIZATION_CATALOG_VERSION = 3;

function freezeRightsIr(value: AthenaRightsIr): AthenaRightsIr {
  return Object.freeze({
    ...value,
    metadata: Object.freeze({
      ...(value.metadata.provenance
        ? { provenance: Object.freeze([...value.metadata.provenance]) }
        : {}),
    }),
    rights: Object.freeze(
      value.rights.map((definition) => Object.freeze({ ...definition }))
    ),
  });
}

let cachedIr: AthenaRightsIr | undefined;
let cached: readonly AthenaRightDefinition[] | undefined;
let cachedByKey: ReadonlyMap<string, AthenaRightDefinition> | undefined;

export function getAthenaAuthorizationRightsIr(): AthenaRightsIr {
  cachedIr ??= freezeRightsIr(
    resolveAthenaRightsIr(
      [
        ...BILLING_RIGHT_DEFINITIONS,
        ...STORAGE_RIGHT_DEFINITIONS,
        ...AUTHORIZATION_RIGHT_DEFINITIONS,
      ].map(
        (definition): AthenaRightContribution => ({
          definition,
          source:
            definition.domain === "billing"
              ? "billing"
              : definition.domain === "storage"
                ? "storage"
                : "authorization",
        })
      ),
      { provenance: ["authorization"] }
    )
  );
  return cachedIr;
}

export function listAthenaAuthorizationRights(): readonly AthenaRightDefinition[] {
  cached ??= Object.freeze([...getAthenaAuthorizationRightsIr().rights]);
  return cached;
}

export function getAthenaAuthorizationRight(
  key: string
): AthenaRightDefinition | undefined {
  cachedByKey ??= new Map(
    listAthenaAuthorizationRights().map((entry) => [entry.key, entry])
  );
  return cachedByKey.get(key);
}

export function getAthenaAuthorizationRightsAuthority(): AthenaRightsAuthority {
  return createAthenaRightsAuthority(getAthenaAuthorizationRightsIr());
}

export function assertBillingOperationsReferenceCatalog(): void {
  const registered = new Set(
    listAthenaAuthorizationRights().map((entry) => entry.key)
  );
  for (const [operation, required] of Object.entries(
    BILLING_OPERATION_RIGHTS
  )) {
    for (const key of required) {
      if (!registered.has(key)) {
        throw new Error(
          `Billing operation ${operation} references unregistered right ${key}`
        );
      }
    }
  }
}
