export const ATHENA_NOTIFICATIONS_UNAUTHENTICATED =
  "ATHENA_NOTIFICATIONS_UNAUTHENTICATED" as const;
export const ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN =
  "ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN" as const;
export const ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN =
  "ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN" as const;
export const ATHENA_NOTIFICATIONS_DIGEST_INVALID =
  "ATHENA_NOTIFICATIONS_DIGEST_INVALID" as const;
export const ATHENA_NOTIFICATIONS_SCOPE_INVALID =
  "ATHENA_NOTIFICATIONS_SCOPE_INVALID" as const;
export const ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND =
  "ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND" as const;
export const ATHENA_NOTIFICATIONS_UNAVAILABLE =
  "ATHENA_NOTIFICATIONS_UNAVAILABLE" as const;

export type AthenaNotificationsErrorCode =
  | typeof ATHENA_NOTIFICATIONS_UNAUTHENTICATED
  | typeof ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN
  | typeof ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN
  | typeof ATHENA_NOTIFICATIONS_DIGEST_INVALID
  | typeof ATHENA_NOTIFICATIONS_SCOPE_INVALID
  | typeof ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND
  | typeof ATHENA_NOTIFICATIONS_UNAVAILABLE;

const ERROR_NUMBERS: Record<AthenaNotificationsErrorCode, number> = {
  ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN: 9002,
  ATHENA_NOTIFICATIONS_DIGEST_INVALID: 9003,
  ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND: 9005,
  ATHENA_NOTIFICATIONS_SCOPE_INVALID: 9004,
  ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN: 9001,
  ATHENA_NOTIFICATIONS_UNAUTHENTICATED: 9000,
  ATHENA_NOTIFICATIONS_UNAVAILABLE: 9006,
};

const ERROR_MESSAGES: Record<AthenaNotificationsErrorCode, string> = {
  ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN:
    "The notification channel is not in the Athena catalog.",
  ATHENA_NOTIFICATIONS_DIGEST_INVALID:
    "Notification digest must be null, daily, or weekly.",
  ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND: "The notification event was not found.",
  ATHENA_NOTIFICATIONS_SCOPE_INVALID:
    "Notification organization scope is empty or invalid.",
  ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN:
    "The notification topic is not in the Athena catalog.",
  ATHENA_NOTIFICATIONS_UNAUTHENTICATED:
    "A signed-in user is required for this notifications operation.",
  ATHENA_NOTIFICATIONS_UNAVAILABLE:
    "The notifications capability is not available on this client.",
};

export class AthenaNotificationsError extends Error {
  readonly code: AthenaNotificationsErrorCode;
  readonly error: AthenaNotificationsErrorCode;
  readonly errorNumber: number;

  constructor(code: AthenaNotificationsErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "AthenaNotificationsError";
    this.code = code;
    this.error = code;
    this.errorNumber = ERROR_NUMBERS[code];
  }
}

export function throwNotificationsError(
  code: AthenaNotificationsErrorCode
): never {
  throw new AthenaNotificationsError(code);
}
