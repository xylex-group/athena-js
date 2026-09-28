import { AthenaConfigurationError } from "../config/errors.ts";
import type { AthenaChatConfig, AthenaChatMode } from "./types.ts";

export type { AthenaChatMode };
/** Resolved constructor outcome. Disabled is `chat: false` / omitted, not a mode. */
export type AthenaChatExecutionMode = "disabled" | AthenaChatMode;

export function isAthenaChatConfig(value: unknown): value is AthenaChatConfig {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function chatUrlOf(
  chat: boolean | AthenaChatConfig | undefined
): string | undefined {
  if (!isAthenaChatConfig(chat)) {
    return;
  }
  const url = chat.url?.trim();
  return url ? url : undefined;
}

/**
 * Resolve Chat runtime. Same structural pattern as Embedded Auth:
 * `chat: false` / omitted → disabled; `mode` is only `"local" | "remote"`.
 *
 * `chat: true` + `databaseUrl` + no `chat.url` → local.
 * Explicit `chat.mode` wins. Local + `chat.url` is a conflict.
 */
export function resolveChatMode(input: {
  chat?: boolean | AthenaChatConfig;
  clusterUrl?: string | null;
  databaseUrl?: string | null;
}): AthenaChatExecutionMode {
  const chat = input.chat;
  if (chat === undefined || chat === false) {
    return "disabled";
  }

  const databaseUrl = input.databaseUrl?.trim() || undefined;
  const url = chatUrlOf(chat);
  const explicitMode = isAthenaChatConfig(chat) ? chat.mode : undefined;

  if (
    explicitMode !== undefined &&
    explicitMode !== "local" &&
    explicitMode !== "remote"
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_CHAT_MODE_INVALID",
      'chat.mode must be "local" or "remote". Pass chat: false to disable Chat.',
      "chat"
    );
  }

  if (explicitMode === "local") {
    if (url) {
      throw new AthenaConfigurationError(
        "ATHENA_CHAT_LOCAL_REMOTE_CONFLICT",
        'chat.mode "local" cannot be combined with chat.url. Use remote Chat or omit the URL.',
        "chat"
      );
    }
    if (!databaseUrl) {
      throw new AthenaConfigurationError(
        "ATHENA_CHAT_LOCAL_DATABASE_REQUIRED",
        'chat.mode "local" requires databaseUrl (DATABASE_URL).',
        "chat"
      );
    }
    return "local";
  }

  if (explicitMode === "remote") {
    if (!url) {
      throw new AthenaConfigurationError(
        "ATHENA_CHAT_REMOTE_URL_REQUIRED",
        'chat.mode "remote" requires chat.url.',
        "chat"
      );
    }
    return "remote";
  }

  if (chat === true) {
    if (databaseUrl) {
      return "local";
    }
    throw new AthenaConfigurationError(
      "ATHENA_CHAT_LOCAL_DATABASE_REQUIRED",
      "chat: true requires databaseUrl for local Chat, or pass chat.url for remote Chat.",
      "chat"
    );
  }

  if (url) {
    return "remote";
  }

  const clusterUrl = input.clusterUrl?.trim() || undefined;
  if (clusterUrl) {
    return "remote";
  }

  if (databaseUrl) {
    return "local";
  }

  throw new AthenaConfigurationError(
    "ATHENA_CHAT_CONFIG_INCOMPLETE",
    "Chat config needs chat.url (remote) or databaseUrl (local).",
    "chat"
  );
}
