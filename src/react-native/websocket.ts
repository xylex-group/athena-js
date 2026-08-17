import type { AthenaChatWebSocketFactory } from "../chat/types.ts";

/**
 * Resolve a WebSocket factory without assuming `window.WebSocket`.
 * Prefers an explicit factory, then `globalThis.WebSocket`.
 */
export function resolveReactNativeWebSocketFactory(
  factory?: AthenaChatWebSocketFactory | null,
): AthenaChatWebSocketFactory | undefined {
  if (factory) {
    return factory;
  }
  const globalFactory = (
    globalThis as unknown as { WebSocket?: AthenaChatWebSocketFactory }
  ).WebSocket;
  return globalFactory;
}