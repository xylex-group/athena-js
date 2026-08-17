export interface AthenaAuthAdminLimits {
  maxAdminJsonBytes: number;
  maxAdminJsonDepth: number;
  maxTemplateVariableLength: number;
  maxTemplateVariables: number;
}

export const ATHENA_AUTH_MAX_ADMIN_JSON_BYTES = 32 * 1024;
export const ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH = 8;
export const ATHENA_AUTH_MAX_TEMPLATE_VARIABLES = 64;
export const ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH = 128;

export const ATHENA_AUTH_ADMIN_LIMITS = {
  maxAdminJsonBytes: ATHENA_AUTH_MAX_ADMIN_JSON_BYTES,
  maxAdminJsonDepth: ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH,
  maxTemplateVariableLength: ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH,
  maxTemplateVariables: ATHENA_AUTH_MAX_TEMPLATE_VARIABLES,
} as const satisfies AthenaAuthAdminLimits;

function describeTemplateVariableTarget(target?: string) {
  const normalized = target?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : "Athena auth admin email template variables";
}

export function assertAthenaAuthTemplateVariables(
  variables: unknown,
  target?: string
): asserts variables is string[] {
  const label = describeTemplateVariableTarget(target);
  if (!Array.isArray(variables)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  if (variables.length > ATHENA_AUTH_MAX_TEMPLATE_VARIABLES) {
    throw new Error(
      `${label} cannot contain more than ${ATHENA_AUTH_MAX_TEMPLATE_VARIABLES} entries.`
    );
  }

  variables.forEach((variable, index) => {
    if (typeof variable !== "string") {
      throw new Error(
        `${label} must contain only strings. Received ${typeof variable} at index ${index}.`
      );
    }

    if (variable.length > ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH) {
      throw new Error(
        `${label} cannot contain entries longer than ${ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH} characters. Received ${variable.length} characters at index ${index}.`
      );
    }
  });
}
