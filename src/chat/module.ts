import { buildSdkHeaderValue } from '../sdk-version.ts'
import { buildServiceRequestHeaders } from '../utils/athena-request-headers.ts'
import type {
  AthenaChatAddMembersRequest,
  AthenaChatAddReactionRequest,
  AthenaChatCallOptions,
  AthenaChatConnectOptions,
  AthenaChatCreateRoomRequest,
  AthenaChatDeleteResult,
  AthenaChatEditMessageRequest,
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
  AthenaChatListMessagesQuery,
  AthenaChatListRoomsQuery,
} from './types.ts'

const SDK_NAME = 'xylex-group/athena-chat'
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME)
export class AthenaChatError extends Error {
  status: number
  endpoint: string
  method: string
  requestId?: string
  body: unknown

  constructor(input: {
    message: string
    status: number
    endpoint: string
    method: string
    requestId?: string
    body: unknown
  }) {
    super(input.message)
    this.name = 'AthenaChatError'
    this.status = input.status
    this.endpoint = input.endpoint
    this.method = input.method
    this.requestId = input.requestId
    this.body = input.body
  }
}

export interface AthenaChatClientConfig {
  baseUrl?: string
  realtimeInfoUrl?: string
  apiKey: string
  athenaKey?: string | null
  client?: string
  headers?: Record<string, string>
  bearerToken?: string
  cookie?: string
  sessionToken?: string
  forceNoCache?: boolean
  wsUrl?: string
  webSocketFactory?: AthenaChatWebSocketFactory
}

function deriveRealtimeInfoUrl(wsUrl?: string): string | undefined {
  if (!wsUrl) {
    return undefined
  }

  const parsed = new URL(normalizeWsUrl(wsUrl, 'Athena chat WebSocket URL'))
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
  parsed.pathname = parsed.pathname.replace(/\/wss\/gateway$/, '/wss/info')
  return parsed.toString()
}

function normalizeWsUrl(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required.`)
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${label} must be a valid absolute ws(s) URL.`)
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`${label} must use ws or wss.`)
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseResponseBody(rawText: string, contentType: string | null) {
  if (!rawText) {
    return { parsed: null as unknown, parseFailed: false }
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes('application/json') ?? false
  const looksJson =
    contentTypeSuggestsJson || rawText.startsWith('{') || rawText.startsWith('[')

  if (!looksJson) {
    return { parsed: rawText as unknown, parseFailed: false }
  }

  try {
    return { parsed: JSON.parse(rawText) as unknown, parseFailed: false }
  } catch {
    return { parsed: rawText as unknown, parseFailed: true }
  }
}

function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get('x-request-id') ??
    headers.get('x-correlation-id') ??
    headers.get('x-athena-request-id') ??
    undefined
  )
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    for (const candidate of [payload.error, payload.message, payload.details]) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim()
      }
    }
  }

  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim()
  }

  return fallback
}

function encodePathSegment(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required.`)
  }
  return encodeURIComponent(normalized)
}

function encodeQuery(query?: Record<string, unknown>): string {
  if (!query) {
    return ''
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item))
        }
      }
      continue
    }
    params.set(key, String(value))
  }

  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function createSocket(
  factory: AthenaChatWebSocketFactory,
  url: string,
  protocols?: string | string[],
): AthenaChatWebSocketLike {
  try {
    return new (factory as new (
      socketUrl: string,
      socketProtocols?: string | string[],
    ) => AthenaChatWebSocketLike)(url, protocols)
  } catch (error) {
    if (error instanceof TypeError) {
      return (factory as (
        socketUrl: string,
        socketProtocols?: string | string[],
      ) => AthenaChatWebSocketLike)(url, protocols)
    }
    throw error
  }
}

function buildHeaders(
  config: AthenaChatClientConfig,
  options?: AthenaChatCallOptions,
): Record<string, string> {
  return buildServiceRequestHeaders('chat', SDK_HEADER_VALUE, config, options)
}

function withJsonBody(init: RequestInit, body: unknown): RequestInit {
  return {
    ...init,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  }
}

async function request<T>(
  config: AthenaChatClientConfig,
  method: string,
  endpoint: string,
  options?: AthenaChatCallOptions,
  body?: unknown,
): Promise<T> {
  if (!config.baseUrl) {
    throw new Error(
      'Athena chat base URL is not configured. Pass createClient({ url }) for unified routing or set chat.url / chatUrl explicitly.',
    )
  }
  const url = `${config.baseUrl}${endpoint}`
  const init: RequestInit = {
    method,
    headers: buildHeaders(config, options),
    signal: options?.signal,
  }
  const finalInit =
    body === undefined || method === 'GET'
      ? init
      : withJsonBody(init, body)

  const response = await fetch(url, finalInit)
  const rawText = await response.text()
  const { parsed } = parseResponseBody(rawText, response.headers.get('content-type'))

  if (!response.ok) {
    throw new AthenaChatError({
      message: resolveErrorMessage(parsed, `Athena chat ${method} ${endpoint} failed with ${response.status}`),
      status: response.status,
      endpoint,
      method,
      requestId: resolveRequestId(response.headers),
      body: parsed,
    })
  }

  return parsed as T
}

function unwrapEnvelopeData<T extends { data: unknown }>(payload: T): T['data'] {
  return payload.data
}

function createRealtimeConnection(
  config: AthenaChatClientConfig,
  options?: AthenaChatConnectOptions,
): AthenaChatRealtimeConnection {
  if (!config.wsUrl) {
    throw new Error(
      'Athena chat WebSocket URL is not configured. Pass createClient({ url }) for unified routing or set chat.wsUrl / chatWsUrl explicitly.',
    )
  }

  const wsFactory =
    config.webSocketFactory ??
    ((globalThis as unknown as { WebSocket?: AthenaChatWebSocketFactory }).WebSocket)

  if (!wsFactory) {
    throw new Error(
      'No WebSocket implementation is available. Provide chat.webSocketFactory in createClient(...) or run in a runtime with global WebSocket support.',
    )
  }

  const socket = createSocket(wsFactory, config.wsUrl, options?.protocols)

  const send = (command: AthenaChatWsClientCommand) => {
    socket.send(JSON.stringify(command))
  }

  if (options?.onMessage) {
    const listener = (event: unknown) => {
      const messageEvent = event as { data?: unknown }
      const raw = messageEvent?.data
      if (typeof raw !== 'string') {
        return
      }
      try {
        options.onMessage?.(JSON.parse(raw) as AthenaChatWsServerEvent | Record<string, unknown>)
      } catch {
        options.onMessage?.({ type: 'error', error: 'Invalid JSON message from Athena chat realtime gateway.' })
      }
    }

    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('message', listener)
    } else {
      socket.onmessage = listener as AthenaChatWebSocketLike['onmessage']
    }
  }

  const hello = (command?: { token?: string | null; room_subscriptions?: string[] | null }) => {
    send({
      type: 'auth.hello',
      token: command?.token,
      room_subscriptions: command?.room_subscriptions,
    })
  }

  if (options?.hello) {
    const onOpen = () => hello({
      token: options.hello?.token ?? undefined,
      room_subscriptions: options.hello?.room_subscriptions ?? undefined,
    })
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', onOpen)
    } else {
      socket.onopen = onOpen
    }
  }

  return {
    socket,
    send,
    hello,
    subscribe(roomId, fromSeq) {
      send({
        type: 'chat.subscribe',
        room_id: roomId,
        from_seq: fromSeq ?? undefined,
      })
    },
    unsubscribe(roomId) {
      send({
        type: 'chat.unsubscribe',
        room_id: roomId,
      })
    },
    resume(rooms: AthenaChatResumeRoomCursor[]) {
      send({
        type: 'chat.resume',
        rooms,
      })
    },
    typingStart(roomId) {
      send({
        type: 'chat.typing.start',
        room_id: roomId,
      })
    },
    typingStop(roomId) {
      send({
        type: 'chat.typing.stop',
        room_id: roomId,
      })
    },
    presenceHeartbeat(activeRoomId) {
      send({
        type: 'chat.presence.heartbeat',
        active_room_id: activeRoomId ?? undefined,
      })
    },
    readUpTo(roomId, input) {
      send({
        type: 'chat.read.up_to',
        room_id: roomId,
        message_id: input?.message_id ?? undefined,
        seq: input?.seq ?? undefined,
      })
    },
    ping(at = new Date().toISOString()) {
      send({
        type: 'ping',
        at,
      })
    },
    close(code, reason) {
      socket.close(code, reason)
    },
  }
}

export function createChatModule(config: AthenaChatClientConfig): AthenaChatModule {
  const realtime: AthenaChatRealtimeModule = {
    info(options) {
      const realtimeInfoUrl = config.realtimeInfoUrl ?? deriveRealtimeInfoUrl(config.wsUrl)
      if (!realtimeInfoUrl) {
        throw new Error(
          'Athena chat realtime info URL is not configured. Pass createClient({ url }) for unified routing or set chat.wsUrl / chatWsUrl explicitly.',
        )
      }

      return request<AthenaChatRealtimeInfoResponse>(
        {
          ...config,
          baseUrl: realtimeInfoUrl,
        },
        'GET',
        '',
        options,
      )
    },
    connect(options) {
      return createRealtimeConnection(config, options)
    },
  }

  return {
    room: {
      list(query?: AthenaChatListRoomsQuery, options?: AthenaChatCallOptions) {
        return request<AthenaChatRoomPage>(
          config,
          'GET',
          `/rooms${encodeQuery(query as Record<string, unknown> | undefined)}`,
          options,
        )
      },
      create(input: AthenaChatCreateRoomRequest, options?: AthenaChatCallOptions) {
        return request<AthenaChatRoomCreatedResponse>(config, 'POST', '/rooms', options, input)
      },
      get(roomId: string, options?: AthenaChatCallOptions) {
        return request<AthenaChatRoom>(
          config,
          'GET',
          `/rooms/${encodePathSegment(roomId, 'chat room ID')}`,
          options,
        )
      },
      update(roomId: string, input: AthenaChatUpdateRoomRequest, options?: AthenaChatCallOptions) {
        return request<AthenaChatRoom>(
          config,
          'PATCH',
          `/rooms/${encodePathSegment(roomId, 'chat room ID')}`,
          options,
          input,
        )
      },
      archive(roomId: string, options?: AthenaChatCallOptions) {
        return request<AthenaChatRoom>(
          config,
          'POST',
          `/rooms/${encodePathSegment(roomId, 'chat room ID')}/archive`,
          options,
        )
      },
      readCursor: {
        upTo(roomId: string, input?: AthenaChatMarkReadUpToRequest, options?: AthenaChatCallOptions) {
          return request<AthenaChatReadCursor>(
            config,
            'POST',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/read-cursor`,
            options,
            input ?? {},
          )
        },
      },
      member: {
        list(roomId: string, options?: AthenaChatCallOptions) {
          return request<AthenaChatMember[]>(
            config,
            'GET',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/members`,
            options,
          )
        },
        add(roomId: string, input: AthenaChatAddMembersRequest, options?: AthenaChatCallOptions) {
          return request<AthenaChatMember[]>(
            config,
            'POST',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/members`,
            options,
            input,
          )
        },
        remove(roomId: string, userId: string, options?: AthenaChatCallOptions) {
          return request<AthenaChatRemoveResult>(
            config,
            'DELETE',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/members/${encodePathSegment(userId, 'chat user ID')}`,
            options,
          )
        },
      },
      message: {
        list(roomId: string, query?: AthenaChatListMessagesQuery, options?: AthenaChatCallOptions) {
          return request<AthenaChatMessagePage>(
            config,
            'GET',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/messages${encodeQuery(query as Record<string, unknown> | undefined)}`,
            options,
          )
        },
        send(roomId: string, input: AthenaChatSendMessageRequest, options?: AthenaChatCallOptions) {
          return request<AthenaChatMessageCreatedResponse>(
            config,
            'POST',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/messages`,
            options,
            input,
          )
        },
        update(roomId: string, messageId: string, input: AthenaChatEditMessageRequest, options?: AthenaChatCallOptions) {
          return request<AthenaChatMessage>(
            config,
            'PATCH',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/messages/${encodePathSegment(messageId, 'chat message ID')}`,
            options,
            input,
          )
        },
        delete(roomId: string, messageId: string, options?: AthenaChatCallOptions) {
          return request<AthenaChatDeleteResult>(
            config,
            'DELETE',
            `/rooms/${encodePathSegment(roomId, 'chat room ID')}/messages/${encodePathSegment(messageId, 'chat message ID')}`,
            options,
          )
        },
      },
    },
    message: {
      reaction: {
        add(messageId: string, input: AthenaChatAddReactionRequest, options?: AthenaChatCallOptions) {
          return request<AthenaChatReactionSummary>(
            config,
            'POST',
            `/messages/${encodePathSegment(messageId, 'chat message ID')}/reactions`,
            options,
            input,
          )
        },
        remove(messageId: string, emoji: string, options?: AthenaChatCallOptions) {
          return request<AthenaChatReactionSummary>(
            config,
            'DELETE',
            `/messages/${encodePathSegment(messageId, 'chat message ID')}/reactions/${encodePathSegment(emoji, 'reaction emoji')}`,
            options,
          )
        },
      },
      search(input: AthenaChatSearchMessagesRequest, options?: AthenaChatCallOptions) {
        return request<AthenaChatSearchPage>(
          config,
          'POST',
          '/messages/search',
          options,
          input,
        )
      },
    },
    realtime,
  }
}

export const chatSdkManifest = {
  namespace: 'chat',
  basePath: '/chat',
  methods: [
    { name: 'listRooms', method: 'GET', path: '/chat/rooms' },
    { name: 'createRoom', method: 'POST', path: '/chat/rooms' },
    { name: 'getRoom', method: 'GET', path: '/chat/rooms/{room_id}' },
    { name: 'updateRoom', method: 'PATCH', path: '/chat/rooms/{room_id}' },
    { name: 'archiveRoom', method: 'POST', path: '/chat/rooms/{room_id}/archive' },
    { name: 'listRoomMessages', method: 'GET', path: '/chat/rooms/{room_id}/messages' },
    { name: 'sendRoomMessage', method: 'POST', path: '/chat/rooms/{room_id}/messages' },
    { name: 'updateRoomMessage', method: 'PATCH', path: '/chat/rooms/{room_id}/messages/{message_id}' },
    { name: 'deleteRoomMessage', method: 'DELETE', path: '/chat/rooms/{room_id}/messages/{message_id}' },
    { name: 'advanceReadCursor', method: 'POST', path: '/chat/rooms/{room_id}/read-cursor' },
    { name: 'listRoomMembers', method: 'GET', path: '/chat/rooms/{room_id}/members' },
    { name: 'addRoomMembers', method: 'POST', path: '/chat/rooms/{room_id}/members' },
    { name: 'removeRoomMember', method: 'DELETE', path: '/chat/rooms/{room_id}/members/{user_id}' },
    { name: 'addReaction', method: 'POST', path: '/chat/messages/{message_id}/reactions' },
    { name: 'removeReaction', method: 'DELETE', path: '/chat/messages/{message_id}/reactions/{emoji}' },
    { name: 'searchMessages', method: 'POST', path: '/chat/messages/search' },
    { name: 'getRealtimeInfo', method: 'GET', path: '/wss/info' },
    { name: 'connectRealtime', method: 'GET', path: '/wss/gateway' },
  ],
} as const

export function unwrapChatRoom(payload: AthenaChatRoomCreatedResponse): AthenaChatRoom {
  return unwrapEnvelopeData(payload) as AthenaChatRoom
}

export function unwrapChatMessage(payload: AthenaChatMessageCreatedResponse): AthenaChatMessage {
  return unwrapEnvelopeData(payload) as AthenaChatMessage
}
