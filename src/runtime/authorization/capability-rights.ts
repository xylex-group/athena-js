import { parseAthenaRightKey } from "../../rights/key.ts";

/** Browser-safe capability keys. Kept out of `catalog.ts` so snapshot parse does not pull billing/storage catalogs. */
export const ORGANIZATION_MEMBERS_WRITE = parseAthenaRightKey(
  "organization.members.write"
);
export const ORGANIZATION_LIFECYCLE_DELETE = parseAthenaRightKey(
  "organization.lifecycle.delete"
);
export const ORGANIZATION_MEMBERS_INVITE = parseAthenaRightKey(
  "organization.members.invite"
);
export const AUTHORIZATION_ROLES_WRITE = parseAthenaRightKey(
  "authorization.roles.write"
);
export const AUTHORIZATION_PLATFORM_WRITE = parseAthenaRightKey(
  "authorization.platform.write"
);
