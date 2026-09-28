import { missingRequiredRights } from "../rights/matching.ts";
import { parseAthenaRightKey, type AthenaRightKey } from "../rights/key.ts";
import type { ChatExecutionContext } from "./local/principal.ts";
import { chatAuthorizationDenied } from "./local/errors.ts";

export type ChatOperation =
  | "members.read"
  | "members.write"
  | "messages.delete"
  | "messages.read"
  | "messages.write"
  | "read.write"
  | "reactions.write"
  | "rooms.admin"
  | "rooms.read"
  | "rooms.write"
  | "search.read";

const CHAT_OPERATION_RIGHTS: Readonly<Record<ChatOperation, AthenaRightKey>> =
  Object.freeze({
    "members.read": parseAthenaRightKey("chat.members.read"),
    "members.write": parseAthenaRightKey("chat.members.write"),
    "messages.delete": parseAthenaRightKey("chat.messages.delete"),
    "messages.read": parseAthenaRightKey("chat.messages.read"),
    "messages.write": parseAthenaRightKey("chat.messages.write"),
    "read.write": parseAthenaRightKey("chat.read.write"),
    "reactions.write": parseAthenaRightKey("chat.reactions.write"),
    "rooms.admin": parseAthenaRightKey("chat.rooms.admin"),
    "rooms.read": parseAthenaRightKey("chat.rooms.read"),
    "rooms.write": parseAthenaRightKey("chat.rooms.write"),
    "search.read": parseAthenaRightKey("chat.search.read"),
  });

export type ChatAuthorizationMode = "compatibility" | "enforce";

/**
 * 5.x default. Compatibility is an explicit migration concession for trusted
 * custom principals with empty Rights; it is not the Hummingbird / Athena 6
 * authorization model. New deployments should set `authorization.mode: "enforce"`.
 * Athena 6 should flip this default to `"enforce"`.
 */
export const CHAT_AUTHORIZATION_DEFAULT_MODE: ChatAuthorizationMode =
  "compatibility";

function hasLegacyCompatibleIdentity(context: ChatExecutionContext): boolean {
  const { principal } = context;
  return (
    context.rightsValid &&
    context.resolvedPrincipal.authority === "custom-trusted" &&
    principal.rights.length === 0 &&
    principal.grants.length === 0 &&
    !principal.service
  );
}

export function requiredChatRight(operation: ChatOperation): AthenaRightKey {
  return CHAT_OPERATION_RIGHTS[operation];
}

export function authorizeChatOperation(
  context: ChatExecutionContext,
  operation: ChatOperation,
  mode: ChatAuthorizationMode
): void {
  if (!context.rightsValid) {
    throw chatAuthorizationDenied("Chat principal contains malformed Rights.");
  }
  if (mode === "compatibility" && hasLegacyCompatibleIdentity(context)) {
    return;
  }

  const required = [requiredChatRight(operation)];
  const missing = missingRequiredRights(context.principal.rights, required);
  if (missing.length > 0) {
    throw chatAuthorizationDenied(
      `Chat operation "${operation}" requires ${missing.join(", ")}.`
    );
  }
}
