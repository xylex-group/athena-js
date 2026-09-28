/**
 * Operator WebAuthn policy + supported extension allow-list.
 * Unspecified passwordless registration defaults to residentKey required
 * and credProps requested (SimpleWebAuthn passkeys). Operator overrides win.
 */

export type AthenaPasskeyUserVerification =
  | "discouraged"
  | "preferred"
  | "required";

export type AthenaPasskeyResidentKey = "discouraged" | "preferred" | "required";

export type AthenaPasskeyAuthenticatorAttachment =
  | "cross-platform"
  | "platform";

export interface AthenaPasskeyRegistrationExtensions {
  credProps?: boolean;
}

/** Intentionally empty until Athena defines an authentication-extension contract. */
export type AthenaPasskeyAuthenticationExtensions = Record<string, never>;

export interface AthenaPasskeyRegistrationPolicy {
  authenticatorAttachment: AthenaPasskeyAuthenticatorAttachment | null;
  extensions: AthenaPasskeyRegistrationExtensions;
  residentKey: AthenaPasskeyResidentKey | null;
  userVerification: AthenaPasskeyUserVerification | null;
}

export interface AthenaPasskeyAuthenticationPolicy {
  extensions: AthenaPasskeyAuthenticationExtensions;
  userVerification: AthenaPasskeyUserVerification | null;
}

export interface AthenaPasskeyAuthenticatorSelection {
  authenticatorAttachment?: AthenaPasskeyAuthenticatorAttachment;
  requireResidentKey?: boolean;
  residentKey?: AthenaPasskeyResidentKey;
  userVerification?: AthenaPasskeyUserVerification;
}

const USER_VERIFICATION = new Set<AthenaPasskeyUserVerification>([
  "discouraged",
  "preferred",
  "required",
]);
const RESIDENT_KEY = new Set<AthenaPasskeyResidentKey>([
  "discouraged",
  "preferred",
  "required",
]);
const ATTACHMENT = new Set<AthenaPasskeyAuthenticatorAttachment>([
  "cross-platform",
  "platform",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>
): T | null {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : null;
}

export function normalizePasskeyRegistrationPolicy(
  raw: unknown
): AthenaPasskeyRegistrationPolicy {
  const record = asRecord(raw);
  const extensionsRaw = asRecord(record?.extensions);
  return {
    authenticatorAttachment: pickEnum(
      record?.authenticatorAttachment,
      ATTACHMENT
    ),
    extensions: {
      ...(extensionsRaw?.credProps === true ? { credProps: true } : {}),
      ...(extensionsRaw?.credProps === false ? { credProps: false } : {}),
    },
    residentKey: pickEnum(record?.residentKey, RESIDENT_KEY),
    userVerification: pickEnum(record?.userVerification, USER_VERIFICATION),
  };
}

export function normalizePasskeyAuthenticationPolicy(
  raw: unknown
): AthenaPasskeyAuthenticationPolicy {
  const record = asRecord(raw);
  return {
    extensions: {},
    userVerification: pickEnum(record?.userVerification, USER_VERIFICATION),
  };
}

export function requireUserVerificationFromPolicy(
  userVerification: AthenaPasskeyUserVerification | null
): boolean {
  return userVerification === "required";
}

export function registrationAuthenticatorSelection(input: {
  attachmentOverride?: AthenaPasskeyAuthenticatorAttachment | null;
  policy: AthenaPasskeyRegistrationPolicy;
}): AthenaPasskeyAuthenticatorSelection | undefined {
  const attachment =
    input.attachmentOverride ?? input.policy.authenticatorAttachment;
  const selection: AthenaPasskeyAuthenticatorSelection = {};
  if (attachment) {
    selection.authenticatorAttachment = attachment;
  }
  const residentKey = input.policy.residentKey ?? "required";
  selection.residentKey = residentKey;
  selection.requireResidentKey = residentKey === "required";
  if (input.policy.userVerification) {
    selection.userVerification = input.policy.userVerification;
  }
  return selection;
}

export function supportedRegistrationExtensions(
  policy: AthenaPasskeyRegistrationPolicy
): AthenaPasskeyRegistrationExtensions | undefined {
  if (policy.extensions.credProps === false) {
    return;
  }
  return { credProps: true };
}

/**
 * Persist only Athena-normalized extension meaning. Never store raw
 * `clientExtensionResults`.
 */
export function normalizeCredPropsResidentKey(
  clientExtensionResults: unknown
): boolean | null {
  const record = asRecord(clientExtensionResults);
  const credProps = asRecord(record?.credProps);
  if (typeof credProps?.rk === "boolean") {
    return credProps.rk;
  }
  return null;
}
