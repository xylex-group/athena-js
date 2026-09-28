import { AthenaChatError } from "../error.ts";
import { errorDescriptor } from "../../runtime/error/registry.ts";

export function chatError(
  status: number,
  message: string,
  code: string,
  details: Record<string, unknown> = {}
): AthenaChatError {
  const descriptor = errorDescriptor("chat", code);
  return new AthenaChatError({
    body: {
      ...details,
      code,
      message,
      ...(descriptor ? { errorNumber: descriptor.errorNumber } : {}),
    },
    endpoint: "local",
    message,
    method: "LOCAL",
    status,
  });
}

export function chatUnauthenticated(): AthenaChatError {
  return chatError(
    401,
    "Authentication required",
    "ATHENA_CHAT_UNAUTHENTICATED"
  );
}

export function chatForbidden(
  message = "Insufficient permissions"
): AthenaChatError {
  return chatError(403, message, "ATHENA_CHAT_FORBIDDEN");
}

export function chatAuthorizationDenied(message: string): AthenaChatError {
  return chatError(403, message, "ATHENA_CHAT_AUTHORIZATION_DENIED");
}

export function chatMembershipDenied(
  message = "Not a member of this chat room."
): AthenaChatError {
  return chatError(403, message, "ATHENA_CHAT_MEMBERSHIP_DENIED");
}

export function chatRoleDenied(message: string): AthenaChatError {
  return chatError(403, message, "ATHENA_CHAT_ROLE_DENIED");
}

export function chatNotFound(message = "Not found"): AthenaChatError {
  return chatError(404, message, "ATHENA_CHAT_NOT_FOUND");
}

export function chatConflict(message: string): AthenaChatError {
  return chatError(409, message, "ATHENA_CHAT_CONFLICT");
}

export function chatBadRequest(message: string): AthenaChatError {
  return chatError(400, message, "ATHENA_CHAT_BAD_REQUEST");
}

export function chatCapabilityUnsupported(
  capability: string,
  runtime: "local" | "remote" = "local"
): AthenaChatError {
  return chatError(
    501,
    `Chat capability "${capability}" is unsupported on ${runtime} realtime.`,
    "ATHENA_CHAT_CAPABILITY_UNSUPPORTED",
    { capability, runtime }
  );
}

export function chatTransactionFailed(): AthenaChatError {
  return chatError(
    500,
    "Chat transaction failed.",
    "ATHENA_CHAT_TRANSACTION_FAILED"
  );
}

export function chatPublicationFailed(): AthenaChatError {
  return chatError(
    500,
    "Chat event publication failed after commit.",
    "ATHENA_CHAT_PUBLICATION_FAILED"
  );
}
