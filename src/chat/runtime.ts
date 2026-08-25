import type { AthenaChatModule } from "./types.ts";

/**
 * Internal local/remote Chat port. Full module, not an adapter subset.
 * Transport (HTTP/WSS) is an implementation concern of the remote runtime.
 */
export type AthenaChatRuntime = AthenaChatModule;
