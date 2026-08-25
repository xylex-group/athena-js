import type { AthenaChatCapabilities } from "./types.ts";

/** P0 local Chat: in-process created/updated only. Not interchangeable with remote WSS. */
export const LOCAL_CHAT_CAPABILITIES: AthenaChatCapabilities = Object.freeze({
	realtime: Object.freeze({
		crossProcess: false,
		messageDeletes: false,
		messageUpdates: true,
		messages: true,
		presence: false,
		reactions: false,
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
		messageUpdates: true,
		messages: true,
		presence: true,
		reactions: true,
		replayPersisted: true,
		resumable: true,
		typing: true,
		websocket: true,
	}),
	transport: "remote",
});
