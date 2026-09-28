import { useEffect } from "react";
import type { AthenaQueryClient } from "../query-client.ts";
import type { AthenaQueryResult } from "../types.ts";
import { useLatestRef } from "./use-latest-ref.ts";

type BrowserEventName = "focus" | "online";

interface BrowserTarget {
  addEventListener: (event: BrowserEventName, listener: () => void) => void;
  removeEventListener: (event: BrowserEventName, listener: () => void) => void;
}

function getBrowserTarget(): BrowserTarget | null {
  const maybeGlobal = globalThis as unknown as {
    addEventListener?: unknown;
    removeEventListener?: unknown;
    window?: unknown;
  };

  const hasListeners = (value: unknown): value is BrowserTarget =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as BrowserTarget).addEventListener === "function" &&
    typeof (value as BrowserTarget).removeEventListener === "function";

  if (hasListeners(maybeGlobal.window)) {
    return maybeGlobal.window;
  }

  if (hasListeners(maybeGlobal)) {
    return maybeGlobal;
  }

  return null;
}

export function useBrowserRefetch(
  event: BrowserEventName,
  input: {
    client: AthenaQueryClient;
    enabled: boolean;
    option: boolean | undefined;
    runQuery: (force?: boolean) => Promise<AthenaQueryResult<unknown>>;
  }
) {
  const enabledRef = useLatestRef(input.enabled);
  const optionRef = useLatestRef(input.option);
  const { client, runQuery } = input;

  useEffect(() => {
    const browser = getBrowserTarget();
    if (!(browser && enabledRef.current)) {
      return;
    }

    const defaults = client.defaultQueryOptions;
    const enabledForEvent =
      event === "focus"
        ? (optionRef.current ?? defaults.refetchOnWindowFocus ?? false)
        : (optionRef.current ?? defaults.refetchOnReconnect ?? false);

    if (!enabledForEvent) {
      return;
    }

    const onEvent = () => {
      if (!enabledRef.current) {
        return;
      }
      void runQuery(true);
    };

    browser.addEventListener(event, onEvent);
    return () => {
      browser.removeEventListener(event, onEvent);
    };
  }, [client, enabledRef, event, optionRef, runQuery]);
}
