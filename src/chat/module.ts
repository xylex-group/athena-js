import { parseHttpResponseBody as parseResponseBody } from "../http/parse-response-body.ts";
import { buildSdkHeaderValue } from "../sdk-version.ts";
import { buildServiceRequestHeaders } from "../utils/athena-request-headers.ts";
import type {
  AthenaChatAddMembersRequest,
  AthenaChatAddReactionRequest,
  AthenaChatCallOptions,
  AthenaChatConnectOptions,
  AthenaChatCreateRoomRequest,
  AthenaChatDeleteResult,
  AthenaChatEditMessageRequest,
  AthenaChatListMessagesQuery,
  AthenaChatListRoomsQuery,
  AthenaChatMarkReadUpToRequest,
  AthenaChatMember,
  AthenaChatMessage,
  AthenaChatMessageCreatedResponse,
  AthenaChatMessagePage,
  AthenaChatModule,
  AthenaChatReactionSummary,
  AthenaChatReadCursor,
  AthenaChatRealtimeConnection,
  AthenaChatRealtimeInfoResponse,
  AthenaChatRealtimeModule,
  AthenaChatResolveDirectRoomRequest,
  AthenaChatRemoveResult,
  AthenaChatResumeRoomCursor,
  AthenaChatRoom,
  AthenaChatRoomCreatedResponse,
  AthenaChatRoomPage,
  AthenaChatSearchMessagesRequest,
  AthenaChatSearchPage,
  AthenaChatSendMessageRequest,
  AthenaChatUpdateRoomRequest,
  AthenaChatWebSocketFactory,
  AthenaChatWebSocketLike,
  AthenaChatWsClientCommand,
  AthenaChatWsServerEvent,
} from "./types.ts";

const SDK_NAME = "xylex-group/athena-chat";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);
export class AthenaChatError extends Error {
  status: number;
  endpoint: string;
  method: string;
  requestId?: string;
  body: unknown;

  constructor(input: {
    message: string;
    status: number;
    endpoint: string;
    method: string;
    requestId?: string;
    body: unknown;
  }) {
    super(input.message);
    this.name = "AthenaChatError";
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.requestId = input.requestId;
    this.body = input.body;
  }
}

export interface AthenaChatClientConfig {
  apiKey: string;
  baseUrl?: string;
  bearerToken?: string;
  client?: string;
  cookie?: string;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  realtimeInfoUrl?: string;
  sessionToken?: string;
  webSocketFactory?: AthenaChatWebSocketFactory;
  wsUrl?: string;
}

export interface InternalChatModuleRuntimeOptions {
  resolveCallOptions?: () =>
    | AthenaChatCallOptions
    | undefined
    | Promise<AthenaChatCallOptions | undefined>;
}

function deriveRealtimeInfoUrl(wsUrl?: string): string | undefined {
  if (!wsUrl) {
    return;
  }

  const parsed = new URL(normalizeWsUrl(wsUrl, "Athena chat WebSocket URL"));
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = parsed.pathname.replace(/\/wss\/gateway$/, "/wss/info");
  return parsed.toString();
}

function normalizeWsUrl(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw new Error(`${label} must be a valid absolute ws(s) URL.`, {
      cause: error,
    });
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`${label} must use ws or wss.`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-correlation-id") ??
    headers.get("x-athena-request-id") ??
    undefined
  );
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    for (const candidate of [payload.error, payload.message, payload.details]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  return fallback;
}

function encodePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return encodeURIComponent(normalized);
}

function encodeQuery(query?: Record<string, unknown>): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
      continue;
    }
    params.set(key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function createSocket(
  factory: AthenaChatWebSocketFactory,
  url: string,
  protocols?: string | string[]
): AthenaChatWebSocketLike {
  try {
    return new (
      factory as new (
        socketUrl: string,
        socketProtocols?: string | string[]
      ) => AthenaChatWebSocketLike
    )(url, protocols);
  } catch (error) {
    if (error instanceof TypeError) {
      return (
        factory as (
          socketUrl: string,
          socketProtocols?: string | string[]
        ) => AthenaChatWebSocketLike
      )(url, protocols);
    }
    throw error;
  }
}

function buildHeaders(
  config: AthenaChatClientConfig,
  options?: AthenaChatCallOptions
): Record<string, string> {
  return buildServiceRequestHeaders("chat", SDK_HEADER_VALUE, config, options);
}

function withJsonBody(init: RequestInit, body: unknown): RequestInit {
  return {
    ...init,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    },
  };
}

/** Coalesce concurrent identical GET chat reads (method+url+auth scope). */
const inflightGetRequests = new Map<string, Promise<unknown>>();

function headerIgnoreCase(
  headers: Record<string, string>,
  name: string
): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value) {
      return value;
    }
  }
  return "";
}

function chatGetInflightKey(
  method: string,
  url: string,
  headers: Record<string, string>
): string {
  // Include every response-scoping credential so concurrent session-token
  // callers on a shared SDK never share one in-flight GET promise.
  const auth =
    headerIgnoreCase(headers, "Authorization") ||
    headerIgnoreCase(headers, "Cookie") ||
    "";
  const sessionToken =
    headerIgnoreCase(headers, "X-Athena-Auth-Session-Token") || "";
  const bearerMirror =
    headerIgnoreCase(headers, "X-Athena-Auth-Bearer-Token") || "";
  const apiKey =
    headerIgnoreCase(headers, "x-api-key") ||
    headerIgnoreCase(headers, "X-Api-Key") ||
    headerIgnoreCase(headers, "x-athena-api-key") ||
    headerIgnoreCase(headers, "X-Athena-Key") ||
    "";
  const client =
    headerIgnoreCase(headers, "x-athena-client") ||
    headerIgnoreCase(headers, "X-Athena-Client") ||
    headerIgnoreCase(headers, "x-client") ||
    "";
  return `${method}\n${url}\n${auth}\n${sessionToken}\n${bearerMirror}\n${apiKey}\n${client}`;
}

async function request<T>(
  config: AthenaChatClientConfig,
  runtimeOptions: InternalChatModuleRuntimeOptions,
  method: string,
  endpoint: string,
  options?: AthenaChatCallOptions,
  body?: unknown
): Promise<T> {
  if (!config.baseUrl) {
    throw new Error(
      "Athena chat base URL is not configured. Pass createClient({ url }) for unified routing or set chat.url explicitly."
    );
  }
  // Deterministic single URL — never progressive path probing.
  const url = `${config.baseUrl}${endpoint}`;
  const contextOptions = await runtimeOptions.resolveCallOptions?.();
  const resolvedOptions = {
    ...contextOptions,
    ...options,
    headers:
      contextOptions?.headers || options?.headers
        ? { ...(contextOptions?.headers ?? {}), ...(options?.headers ?? {}) }
        : undefined,
  };
  const headers = buildHeaders(config, resolvedOptions);
  const init: RequestInit = {
    headers,
    method,
    signal: resolvedOptions.signal,
  };
  const finalInit =
    body === undefined || method === "GET" ? init : withJsonBody(init, body);

  const execute = async (): Promise<T> => {
    const response = await fetch(url, finalInit);
    const rawText = await response.text();
    const { parsed } = parseResponseBody(
      rawText,
      response.headers.get("content-type")
    );

    if (!response.ok) {
      throw new AthenaChatError({
        body: parsed,
        endpoint,
        message: resolveErrorMessage(
          parsed,
          `Athena chat ${method} ${endpoint} failed with ${response.status}`
        ),
        method,
        requestId: resolveRequestId(response.headers),
        status: response.status,
      });
    }

    return parsed as T;
  };

  if (method === "GET" && body === undefined) {
    // Per-call AbortSignal must keep independent cancellation semantics —
    // do not coalesce signaled requests onto another caller's promise.
    if (resolvedOptions.signal) {
      return execute();
    }
    const key = chatGetInflightKey(method, url, headers);
    const existing = inflightGetRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const pending = execute().finally(() => {
      if (inflightGetRequests.get(key) === pending) {
        inflightGetRequests.delete(key);
      }
    });
    inflightGetRequests.set(key, pending);
    return pending;
  }

  return execute();
}

function unwrapEnvelopeData<T extends { data: unknown }>(
  payload: T
): T["data"] {
  return payload.data;
}

function createRealtimeConnection(
  config: AthenaChatClientConfig,
  options?: AthenaChatConnectOptions
): AthenaChatRealtimeConnection {
  if (!config.wsUrl) {
    throw new Error(
      "Athena chat WebSocket URL is not configured. Pass createClient({ url }) for unified routing or set chat.wsUrl explicitly."
    );
  }

  const wsFactory =
    config.webSocketFactory ??
    (globalThis as unknown as { WebSocket?: AthenaChatWebSocketFactory })
      .WebSocket;

  if (!wsFactory) {
    throw new Error(
      "No WebSocket implementation is available. Provide chat.webSocketFactory in createClient(...) or run in a runtime with global WebSocket support."
    );
  }

  const socket = createSocket(wsFactory, config.wsUrl, options?.protocols);

  const send = (command: AthenaChatWsClientCommand) => {
    socket.send(JSON.stringify(command));
  };

  if (options?.onMessage) {
    const listener = (event: unknown) => {
      const messageEvent = event as { data?: unknown };
      const raw = messageEvent?.data;
      if (typeof raw !== "string") {
        return;
      }
      try {
        options.onMessage?.(
          JSON.parse(raw) as AthenaChatWsServerEvent | Record<string, unknown>
        );
      } catch {
        options.onMessage?.({
          error: "Invalid JSON message from Athena chat realtime gateway.",
          type: "error",
        });
      }
    };

    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("message", listener);
    } else {
      socket.onmessage = listener as AthenaChatWebSocketLike["onmessage"];
    }
  }

  const hello = (command?: {
    token?: string | null;
    room_subscriptions?: string[] | null;
  }) => {
    send({
      room_subscriptions: command?.room_subscriptions,
      token: command?.token,
      type: "auth.hello",
    });
  };

  if (options?.hello) {
    const onOpen = () =>
      hello({
        room_subscriptions: options.hello?.room_subscriptions ?? undefined,
        token: options.hello?.token ?? undefined,
      });
    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("open", onOpen);
    } else {
      socket.onopen = onOpen;
    }
  }

  return {
    close(code, reason) {
      socket.close(code, reason);
    },
    hello,
    ping(at = new Date().toISOString()) {
      send({
        at,
        type: "ping",
      });
    },
    presenceHeartbeat(activeRoomId) {
      send({
        active_room_id: activeRoomId ?? undefined,
        type: "chat.presence.heartbeat",
      });
    },
    readUpTo(roomId, input) {
      send({
        message_id: input?.message_id ?? undefined,
        room_id: roomId,
        seq: input?.seq ?? undefined,
        type: "chat.read.up_to",
      });
    },
    resume(rooms: AthenaChatResumeRoomCursor[]) {
      send({
        rooms,
        type: "chat.resume",
      });
    },
    send,
    socket,
    subscribe(roomId, fromSeq) {
      send({
        from_seq: fromSeq ?? undefined,
        room_id: roomId,
        type: "chat.subscribe",
      });
    },
    typingStart(roomId) {
      send({
        room_id: roomId,
        type: "chat.typing.start",
      });
    },
    typingStop(roomId) {
      send({
        room_id: roomId,
        type: "chat.typing.stop",
      });
    },
    unsubscribe(roomId) {
      send({
        room_id: roomId,
        type: "chat.unsubscribe",
      });
    },
  };
}

export function createChatModule(
  config: AthenaChatClientConfig,
  runtimeOptions: InternalChatModuleRuntimeOptions = {}
): AthenaChatModule {
  const call = <T>(
    method: string,
    endpoint: string,
    options?: AthenaChatCallOptions,
    body?: unknown
  ): Promise<T> =>
    request<T>(config, runtimeOptions, method, endpoint, options, body);

  const realtime: AthenaChatRealtimeModule = {
    connect(options) {
      return createRealtimeConnection(config, options);
    },
    info(options) {
      const realtimeInfoUrl =
        config.realtimeInfoUrl ?? deriveRealtimeInfoUrl(config.wsUrl);
      if (!realtimeInfoUrl) {
        throw new Error(
          "Athena chat realtime info URL is not configured. Pass createClient({ url }) for unified routing or set chat.wsUrl explicitly."
        );
      }

      return request<AthenaChatRealtimeInfoResponse>(
        {
          ...config,
          baseUrl: realtimeInfoUrl,
        },
        runtimeOptions,
        "GET",
        "",
        options
      );
    },
  };

  return {
    message: {
      reaction: {
        add(
          messageId: string,
          input: AthenaChatAddReactionRequest,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatReactionSummary>(
            "POST",
            `/messages/${encodePathSegment(messageId, "chat message ID")}/reactions`,
            options,
            input
          );
        },
        remove(
          messageId: string,
          emoji: string,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatReactionSummary>(
            "DELETE",
            `/messages/${encodePathSegment(messageId, "chat message ID")}/reactions/${encodePathSegment(emoji, "reaction emoji")}`,
            options
          );
        },
      },
      search(
        input: AthenaChatSearchMessagesRequest,
        options?: AthenaChatCallOptions
      ) {
        return call<AthenaChatSearchPage>(
          "POST",
          "/messages/search",
          options,
          input
        );
      },
    },
    realtime,
    room: {
      archive(roomId: string, options?: AthenaChatCallOptions) {
        return call<AthenaChatRoom>(
          "POST",
          `/rooms/${encodePathSegment(roomId, "chat room ID")}/archive`,
          options
        );
      },
      create(
        input: AthenaChatCreateRoomRequest,
        options?: AthenaChatCallOptions
      ) {
        return call<AthenaChatRoomCreatedResponse>(
          "POST",
          "/rooms",
          options,
          input
        );
      },
      resolveDirect(
        input: AthenaChatResolveDirectRoomRequest,
        options?: AthenaChatCallOptions
      ) {
        return call<AthenaChatRoom>(
          "POST",
          "/rooms/direct/resolve",
          options,
          input
        );
      },
      get(roomId: string, options?: AthenaChatCallOptions) {
        return call<AthenaChatRoom>(
          "GET",
          `/rooms/${encodePathSegment(roomId, "chat room ID")}`,
          options
        );
      },
      list(query?: AthenaChatListRoomsQuery, options?: AthenaChatCallOptions) {
        return call<AthenaChatRoomPage>(
          "GET",
          `/rooms${encodeQuery(query as Record<string, unknown> | undefined)}`,
          options
        );
      },
      member: {
        add(
          roomId: string,
          input: AthenaChatAddMembersRequest,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatMember[]>(
            "POST",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/members`,
            options,
            input
          );
        },
        list(roomId: string, options?: AthenaChatCallOptions) {
          return call<AthenaChatMember[]>(
            "GET",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/members`,
            options
          );
        },
        remove(
          roomId: string,
          userId: string,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatRemoveResult>(
            "DELETE",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/members/${encodePathSegment(userId, "chat user ID")}`,
            options
          );
        },
      },
      message: {
        delete(
          roomId: string,
          messageId: string,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatDeleteResult>(
            "DELETE",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/messages/${encodePathSegment(messageId, "chat message ID")}`,
            options
          );
        },
        list(
          roomId: string,
          query?: AthenaChatListMessagesQuery,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatMessagePage>(
            "GET",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/messages${encodeQuery(query as Record<string, unknown> | undefined)}`,
            options
          );
        },
        send(
          roomId: string,
          input: AthenaChatSendMessageRequest,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatMessageCreatedResponse>(
            "POST",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/messages`,
            options,
            input
          );
        },
        update(
          roomId: string,
          messageId: string,
          input: AthenaChatEditMessageRequest,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatMessage>(
            "PATCH",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/messages/${encodePathSegment(messageId, "chat message ID")}`,
            options,
            input
          );
        },
      },
      readCursor: {
        upTo(
          roomId: string,
          input?: AthenaChatMarkReadUpToRequest,
          options?: AthenaChatCallOptions
        ) {
          return call<AthenaChatReadCursor>(
            "POST",
            `/rooms/${encodePathSegment(roomId, "chat room ID")}/read-cursor`,
            options,
            input ?? {}
          );
        },
      },
      update(
        roomId: string,
        input: AthenaChatUpdateRoomRequest,
        options?: AthenaChatCallOptions
      ) {
        return call<AthenaChatRoom>(
          "PATCH",
          `/rooms/${encodePathSegment(roomId, "chat room ID")}`,
          options,
          input
        );
      },
    },
  };
}

export const chatSdkManifest = {
  basePath: "/chat",
  methods: [
    { method: "GET", name: "listRooms", path: "/chat/rooms" },
    { method: "POST", name: "createRoom", path: "/chat/rooms" },
    {
      method: "POST",
      name: "resolveDirectRoom",
      path: "/chat/rooms/direct/resolve",
    },
    { method: "GET", name: "getRoom", path: "/chat/rooms/{room_id}" },
    { method: "PATCH", name: "updateRoom", path: "/chat/rooms/{room_id}" },
    {
      method: "POST",
      name: "archiveRoom",
      path: "/chat/rooms/{room_id}/archive",
    },
    {
      method: "GET",
      name: "listRoomMessages",
      path: "/chat/rooms/{room_id}/messages",
    },
    {
      method: "POST",
      name: "sendRoomMessage",
      path: "/chat/rooms/{room_id}/messages",
    },
    {
      method: "PATCH",
      name: "updateRoomMessage",
      path: "/chat/rooms/{room_id}/messages/{message_id}",
    },
    {
      method: "DELETE",
      name: "deleteRoomMessage",
      path: "/chat/rooms/{room_id}/messages/{message_id}",
    },
    {
      method: "POST",
      name: "advanceReadCursor",
      path: "/chat/rooms/{room_id}/read-cursor",
    },
    {
      method: "GET",
      name: "listRoomMembers",
      path: "/chat/rooms/{room_id}/members",
    },
    {
      method: "POST",
      name: "addRoomMembers",
      path: "/chat/rooms/{room_id}/members",
    },
    {
      method: "DELETE",
      name: "removeRoomMember",
      path: "/chat/rooms/{room_id}/members/{user_id}",
    },
    {
      method: "POST",
      name: "addReaction",
      path: "/chat/messages/{message_id}/reactions",
    },
    {
      method: "DELETE",
      name: "removeReaction",
      path: "/chat/messages/{message_id}/reactions/{emoji}",
    },
    { method: "POST", name: "searchMessages", path: "/chat/messages/search" },
    { method: "GET", name: "getRealtimeInfo", path: "/wss/info" },
    { method: "GET", name: "connectRealtime", path: "/wss/gateway" },
  ],
  namespace: "chat",
} as const;

export function unwrapChatRoom(
  payload: AthenaChatRoomCreatedResponse
): AthenaChatRoom {
  return unwrapEnvelopeData(payload) as AthenaChatRoom;
}

export function unwrapChatMessage(
  payload: AthenaChatMessageCreatedResponse
): AthenaChatMessage {
  return unwrapEnvelopeData(payload) as AthenaChatMessage;
}
