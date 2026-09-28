import type {
  AthenaChatRealtimeConnection,
  AthenaChatRealtimeSession,
  AthenaChatRealtimeSessionOptions,
  AthenaChatRealtimeSessionState,
} from "../types.ts";

interface SessionTransport {
  open: (
    onEvent: (event: Parameters<
      NonNullable<AthenaChatRealtimeSessionOptions["onEvent"]>
    >[0]) => void,
    onClose: () => void,
    onOpen: () => void
  ) => AthenaChatRealtimeConnection;
  authorize?: (roomId: string) => Promise<void>;
  readonly local: boolean;
}

function roomIdOf(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return;
  }
  const record = event as Record<string, unknown>;
  return typeof record.room_id === "string" ? record.room_id : undefined;
}

function roomSeqOf(event: unknown): number | undefined {
  if (!event || typeof event !== "object") {
    return;
  }
  const record = event as Record<string, unknown>;
  if (typeof record.room_seq === "number") {
    return record.room_seq;
  }
  if (typeof record.seq === "number") {
    return record.seq;
  }
  const message = record.message;
  if (
    message &&
    typeof message === "object" &&
    typeof (message as { room_seq?: unknown }).room_seq === "number"
  ) {
    return (message as { room_seq: number }).room_seq;
  }
  return undefined;
}

function delayForAttempt(
  attempt: number,
  options: AthenaChatRealtimeSessionOptions
): number {
  const base = options.reconnect?.baseDelayMs ?? 250;
  const maximum = options.reconnect?.maxDelayMs ?? 10_000;
  const jitter = options.reconnect?.jitter ?? 0.2;
  const spread =
    typeof jitter === "function"
      ? jitter(attempt)
      : (Math.random() * 2 - 1) * Math.max(0, jitter);
  const multiplier = Math.max(0, 1 + Math.min(1, spread));
  return Math.min(maximum, Math.round(base * 2 ** attempt * multiplier));
}

export function createChatRealtimeSession(
  transport: SessionTransport,
  options: AthenaChatRealtimeSessionOptions = {}
): AthenaChatRealtimeSession {
  let connection: AthenaChatRealtimeConnection | null = null;
  let state: AthenaChatRealtimeSessionState = "idle";
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const subscriptions = new Map<string, number>();
  const lastObserved = new Map<string, number>();
  const observedEventIds = new Set<string>();

  const emitState = (next: AthenaChatRealtimeSessionState): void => {
    state = next;
    options.onStateChange?.(next);
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || transport.local || reconnectTimer !== undefined) {
      return;
    }
    emitState("reconnecting");
    const delay = delayForAttempt(reconnectAttempt, options);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (!stopped) {
        start();
      }
    }, delay);
  };

  const onEvent = (event: Parameters<
    NonNullable<AthenaChatRealtimeSessionOptions["onEvent"]>
  >[0]): void => {
    const eventId =
      event && typeof event === "object" && "event_id" in event
        ? String((event as { event_id?: unknown }).event_id ?? "")
        : "";
    if (eventId) {
      if (observedEventIds.has(eventId)) {
        return;
      }
      observedEventIds.add(eventId);
    }
    const roomId = roomIdOf(event);
    const roomSeq = roomSeqOf(event);
    if (roomId && roomSeq !== undefined) {
      const previous = lastObserved.get(roomId);
      if (previous !== undefined && roomSeq < previous) {
        return;
      }
      if (
        previous !== undefined &&
        roomSeq > previous + 1 &&
        options.onSyncRequired
      ) {
        options.onSyncRequired({
          expectedFromSeq: previous + 1,
          reason: "sequence_gap",
          roomId,
        });
      }
      lastObserved.set(roomId, Math.max(previous ?? 0, roomSeq));
      subscriptions.set(
        roomId,
        Math.max(subscriptions.get(roomId) ?? 0, roomSeq)
      );
    }
    if (
      event &&
      typeof event === "object" &&
      "type" in event &&
      (event as { type?: unknown }).type === "chat.sync.required"
    ) {
      const record = event as {
        expected_from_seq?: number | null;
        reason?: string | null;
        room_id?: string | null;
      };
      options.onSyncRequired?.({
        ...(record.expected_from_seq != null
          ? { expectedFromSeq: record.expected_from_seq }
          : {}),
        reason: record.reason ?? "server_requested_sync",
        roomId: record.room_id ?? undefined,
      });
    }
    options.onEvent?.(event);
  };

  const connect = (): void => {
    if (stopped) {
      return;
    }
    emitState("connecting");
    connection = transport.open(
      onEvent,
      () => {
        connection = null;
        if (!stopped) {
          scheduleReconnect();
        }
      },
      () => {
        reconnectAttempt = 0;
        emitState("connected");
        if (subscriptions.size > 0) {
          connection?.resume(
            [...subscriptions].map(([room_id, last_seq]) => ({
              last_seq,
              room_id,
            }))
          );
        }
      }
    );
    if (transport.local) {
      emitState("connected");
      if (subscriptions.size > 0) {
        connection.resume(
          [...subscriptions].map(([room_id, last_seq]) => ({
            last_seq,
            room_id,
          }))
        );
      }
    }
  };

  function start(): void {
    if (stopped || state === "connected" || state === "connecting") {
      return;
    }
    clearReconnectTimer();
    connect();
  }

  return {
    get state() {
      return state;
    },
    start,
    stop() {
      stopped = true;
      clearReconnectTimer();
      connection?.close();
      connection = null;
      emitState("closed");
    },
    async subscribe(roomId, subscribeOptions): Promise<void> {
      await transport.authorize?.(roomId);
      const afterSeq = subscribeOptions?.afterSeq ?? 0;
      subscriptions.set(roomId, afterSeq);
      lastObserved.set(roomId, afterSeq);
      connection?.subscribe(roomId, afterSeq);
    },
    unsubscribe(roomId) {
      subscriptions.delete(roomId);
      lastObserved.delete(roomId);
      connection?.unsubscribe(roomId);
    },
  };
}
