export const ATHENA_AUTHENTICATION_METHODS = [
  "password",
  "passkey",
  "social",
  "email_link",
  "email_otp",
  "totp",
  "recovery_code",
  "impersonation",
] as const;

export type AthenaAuthenticationMethod =
  (typeof ATHENA_AUTHENTICATION_METHODS)[number];

export interface AthenaAuthenticationContext {
  authenticatedAt: Date;
  methods: readonly AthenaAuthenticationMethod[];
}

export interface IssueSessionAuthentication {
  authenticatedAt?: Date;
  methods: readonly AthenaAuthenticationMethod[];
}

const METHOD_SET = new Set<string>(ATHENA_AUTHENTICATION_METHODS);

export function isAthenaAuthenticationMethod(
  value: string
): value is AthenaAuthenticationMethod {
  return METHOD_SET.has(value);
}

export function normalizeAuthenticationMethods(
  value: unknown
): AthenaAuthenticationMethod[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique: AthenaAuthenticationMethod[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isAthenaAuthenticationMethod(entry)) {
      continue;
    }
    if (!unique.includes(entry)) {
      unique.push(entry);
    }
  }
  return unique;
}

export function resolveAuthenticationContext(
  input: IssueSessionAuthentication,
  now: Date
): AthenaAuthenticationContext {
  return {
    authenticatedAt: input.authenticatedAt ?? now,
    methods: normalizeAuthenticationMethods(input.methods),
  };
}

export function authenticationContextFromSession(session: {
  authenticated_at: Date | string;
  authentication_methods: unknown;
}): AthenaAuthenticationContext {
  return {
    authenticatedAt:
      session.authenticated_at instanceof Date
        ? session.authenticated_at
        : new Date(session.authenticated_at),
    methods: normalizeAuthenticationMethods(session.authentication_methods),
  };
}

export function impersonationAuthenticationFromActor(session: {
  authenticated_at: Date | string;
  authentication_methods: unknown;
}): AthenaAuthenticationContext {
  const actor = authenticationContextFromSession(session);
  return {
    authenticatedAt: actor.authenticatedAt,
    methods: [...actor.methods, "impersonation"],
  };
}

export function restoredAuthenticationFromImpersonation(session: {
  authenticated_at: Date | string;
  authentication_methods: unknown;
}): AthenaAuthenticationContext {
  const impersonated = authenticationContextFromSession(session);
  return {
    authenticatedAt: impersonated.authenticatedAt,
    methods: impersonated.methods.filter(
      (method) => method !== "impersonation"
    ),
  };
}
