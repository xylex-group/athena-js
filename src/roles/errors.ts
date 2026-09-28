export const ATHENA_ROLES_IR_INVALID = "ATHENA_ROLES_IR_INVALID";

export class AthenaRolesIrValidationError extends Error {
  readonly code = ATHENA_ROLES_IR_INVALID;

  constructor(message: string) {
    super(message);
    this.name = "AthenaRolesIrValidationError";
  }
}

export const ATHENA_ROLE_ID_INVALID = "ATHENA_ROLE_ID_INVALID";
export const ATHENA_ROLE_KEY_INVALID = "ATHENA_ROLE_KEY_INVALID";

export class AthenaRoleIdentityError extends Error {
  constructor(
    readonly code:
      | typeof ATHENA_ROLE_ID_INVALID
      | typeof ATHENA_ROLE_KEY_INVALID,
    message: string
  ) {
    super(message);
    this.name = "AthenaRoleIdentityError";
  }
}
