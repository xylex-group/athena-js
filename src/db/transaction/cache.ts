import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaTransactionCacheObserver } from "./types.ts";

const observers = new WeakMap<
  AthenaGatewayClient,
  AthenaTransactionCacheObserver
>();

export function registerTransactionCacheObserver(
  gateway: AthenaGatewayClient,
  observer: AthenaTransactionCacheObserver
): void {
  observers.set(gateway, observer);
}

export function getTransactionCacheObserver(
  gateway: AthenaGatewayClient
): AthenaTransactionCacheObserver | undefined {
  return observers.get(gateway);
}
