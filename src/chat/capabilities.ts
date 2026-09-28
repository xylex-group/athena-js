import type { AthenaChatCapabilities } from "./types.ts";

/** Local Chat: in-process committed domain events, not cross-process WSS. */
export const LOCAL_CHAT_CAPABILITIES: AthenaChatCapabilities = Object.freeze({
  realtime: Object.freeze({
    crossProcess: false,
    messageDeletes: true,
    messages: true,
    messageUpdates: true,
    presence: false,
    reactions: true,
    replayPersisted: false,
    resumable: true,
    typing: false,
    websocket: false,
  }),
  transport: "local",
});

export const REMOTE_CHAT_CAPABILITIES: AthenaChatCapabilities = Object.freeze({
  realtime: Object.freeze({
    crossProcess: true,
    messageDeletes: true,
    messages: true,
    messageUpdates: true,
    presence: true,
    reactions: true,
    replayPersisted: true,
    resumable: true,
    typing: true,
    websocket: true,
  }),
  transport: "remote",
});
