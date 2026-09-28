import { ATHENA_ROLE_ID_INVALID, AthenaRoleIdentityError } from "./errors.ts";

declare const athenaRoleIdBrand: unique symbol;

export type AthenaRoleId = string & {
  readonly [athenaRoleIdBrand]: true;
};

export function parseAthenaRoleId(raw: string): AthenaRoleId {
  if (typeof raw !== "string") {
    throw new AthenaRoleIdentityError(
      ATHENA_ROLE_ID_INVALID,
      "Role ID must be a string"
    );
  }
  const value = raw.trim();
  if (value.length === 0 || [...value].some((character) => character < " ")) {
    throw new AthenaRoleIdentityError(
      ATHENA_ROLE_ID_INVALID,
      "Role ID must be a non-empty string without control characters"
    );
  }
  return value as AthenaRoleId;
}

export function tryParseAthenaRoleId(raw: string): AthenaRoleId | undefined {
  try {
    return parseAthenaRoleId(raw);
  } catch (error) {
    if (error instanceof AthenaRoleIdentityError) {
      return undefined;
    }
    throw error;
  }
}

export function athenaRoleIdString(id: AthenaRoleId): string {
  return id;
}
