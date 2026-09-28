import { ATHENA_ROLE_KEY_INVALID, AthenaRoleIdentityError } from "./errors.ts";

declare const athenaRoleKeyBrand: unique symbol;

export type AthenaRoleKey = string & {
  readonly [athenaRoleKeyBrand]: true;
};

const LEGACY_ROLE_ALIASES = new Set([
  "admin",
  "customer",
  "member",
  "owner",
  "unauthorized",
]);

export function parseAthenaRoleKey(raw: string): AthenaRoleKey {
  if (typeof raw !== "string") {
    throw new AthenaRoleIdentityError(
      ATHENA_ROLE_KEY_INVALID,
      "Role key must be a string"
    );
  }
  const value = raw.trim();
  if (
    !/^[a-z][a-z0-9_]{0,127}$/.test(value) ||
    LEGACY_ROLE_ALIASES.has(value)
  ) {
    throw new AthenaRoleIdentityError(
      ATHENA_ROLE_KEY_INVALID,
      "Role key must be a canonical non-legacy symbolic key"
    );
  }
  return value as AthenaRoleKey;
}

export function tryParseAthenaRoleKey(raw: string): AthenaRoleKey | undefined {
  try {
    return parseAthenaRoleKey(raw);
  } catch (error) {
    if (error instanceof AthenaRoleIdentityError) {
      return undefined;
    }
    throw error;
  }
}

export function athenaRoleKeyString(key: AthenaRoleKey): string {
  return key;
}
