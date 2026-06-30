import type { AthenaGatewayBaseOptions } from '../gateway/types.ts'

export type AthenaChatRoomKind = 'dm' | 'group' | 'channel'
export type AthenaChatMemberRole = 'owner' | 'admin' | 'member'

export interface AthenaChatAttachmentInput {
  file_id: string
  ordinal: number
}

export interface AthenaChatAttachmentView extends AthenaChatAttachmentInput {
  file_name?: string | null
  original_name?: string | null
  content_type?: string | null
  mime_type?: string | null
  extension?: string | null
  size_bytes?: number | null
  status?: string | null
  visibility?: string | null
  file_url?: string | null
  bucket?: string | null
  storage_key?: string | null
  authorized_url_path: string
  proxy_url_path: string
  public_url_path: string
}

export interface AthenaChatReactionCount {
  emoji: string
  count: number
  reacted: boolean
}

export interface AthenaChatReactionSummary {
  message_id: string
  reactions: AthenaChatReactionCount[]
}

export interface AthenaChatMessage {
  id: string
  room_id: string
  room_seq: number
  sender_id: string
  client_message_id?: string | null
  body_text?: string | null
  body_json?: Record<string, unknown> | null
  reply_to_message_id?: string | null
  created_at: string
  edited_at?: string | null
  deleted_at?: string | null
  metadata_json?: Record<string, unknown> | null
  attachments: AthenaChatAttachmentView[]
  reactions: AthenaChatReactionCount[]
}

export interface AthenaChatMessagePage {
  items: AthenaChatMessage[]
  next_before_seq?: number | null
}

export interface AthenaChatRoom {
  id: string
  organization_id: string
  kind: AthenaChatRoomKind
  title?: string | null
  created_by: string
  created_at: string
  updated_at: string
  archived_at?: string | null
  last_message_id?: string | null
  last_message_seq: number
  last_message_at?: string | null
  version: number
}

export interface AthenaChatRoomPage {
  items: AthenaChatRoom[]
}

export interface AthenaChatMember {
  room_id: string
  user_id: string
  role: AthenaChatMemberRole
  joined_at: string
  last_read_seq: number
  last_read_message_id?: string | null
  muted: boolean
  notification_mode?: string | null
  hidden_at?: string | null
}

export interface AthenaChatReadCursor {
  room_id: string
  user_id: string
  last_read_seq: number
  last_read_message_id?: string | null
}

export interface AthenaChatDeleteResult {
  ok: boolean
  message_id: string
}

export interface AthenaChatRemoveResult {
  ok: boolean
  user_id: string
}

export interface AthenaChatSearchHit {
  room_id: string
  message: AthenaChatMessage
}

export interface AthenaChatSearchPage {
  items: AthenaChatSearchHit[]
}

export interface AthenaChatCreateRoomRequest {
  kind: AthenaChatRoomKind
  title?: string | null
  member_user_ids?: string[]
}

export interface AthenaChatUpdateRoomRequest {
  title?: string | null
}

export interface AthenaChatSendMessageRequest {
  client_message_id?: string | null
  body_text?: string | null
  body_json?: Record<string, unknown> | null
  reply_to_message_id?: string | null
  metadata_json?: Record<string, unknown> | null
  attachments?: AthenaChatAttachmentInput[]
}

export interface AthenaChatEditMessageRequest {
  body_text?: string | null
  body_json?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
}

export interface AthenaChatMarkReadUpToRequest {
  message_id?: string | null
  seq?: number | null
}

export interface AthenaChatAddMembersRequest {
  user_ids: string[]
  role?: AthenaChatMemberRole | null
}

export interface AthenaChatAddReactionRequest {
  emoji: string
}

export interface AthenaChatSearchMessagesRequest {
  query: string
  room_id?: string | null
  limit?: number | null
}

export interface AthenaChatRoomCreatedResponse {
  status: 'success'
  message: string
  data: AthenaChatRoom
}

export interface AthenaChatMessageCreatedResponse {
  status: 'success'
  message: string
  data: AthenaChatMessage
}

export interface AthenaChatListRoomsQuery {
  limit?: number
  offset?: number
  include_archived?: boolean
}

export interface AthenaChatListMessagesQuery {
  limit?: number
  before_seq?: number
  after_seq?: number
}

export interface AthenaChatRealtimeInfoResponse {
  status?: string
  message?: string
  data?: {
    transport?: string
    path?: string
    api_base?: string
    actions?: string[]
  }
}

export interface AthenaChatResumeRoomCursor {
  room_id: string
  last_seq: number
}

export interface AthenaChatPresenceUser {
  user_id: string
  state: string
  active_room_id?: string | null
  at?: string | null
}

export interface AthenaChatWsAuthHelloCommand {
  type: 'auth.hello'
  token?: string | null
  room_subscriptions?: string[] | null
}

export interface AthenaChatWsSubscribeCommand {
  type: 'chat.subscribe'
  room_id: string
  from_seq?: number | null
}

export interface AthenaChatWsUnsubscribeCommand {
  type: 'chat.unsubscribe'
  room_id: string
}

export interface AthenaChatWsResumeCommand {
  type: 'chat.resume'
  rooms: AthenaChatResumeRoomCursor[]
}

export interface AthenaChatWsTypingStartCommand {
  type: 'chat.typing.start'
  room_id: string
}

export interface AthenaChatWsTypingStopCommand {
  type: 'chat.typing.stop'
  room_id: string
}

export interface AthenaChatWsPresenceHeartbeatCommand {
  type: 'chat.presence.heartbeat'
  active_room_id?: string | null
}

export interface AthenaChatWsReadUpToCommand {
  type: 'chat.read.up_to'
  room_id: string
  message_id?: string | null
  seq?: number | null
}

export interface AthenaChatWsPingCommand {
  type: 'ping'
  at: string
}

export type AthenaChatWsClientCommand =
  | AthenaChatWsAuthHelloCommand
  | AthenaChatWsSubscribeCommand
  | AthenaChatWsUnsubscribeCommand
  | AthenaChatWsResumeCommand
  | AthenaChatWsTypingStartCommand
  | AthenaChatWsTypingStopCommand
  | AthenaChatWsPresenceHeartbeatCommand
  | AthenaChatWsReadUpToCommand
  | AthenaChatWsPingCommand

export interface AthenaChatWsHelloOkEvent {
  type: 'hello.ok'
  connection_id: string
  server_time: string
}

export interface AthenaChatWsSubscribedEvent {
  type: 'chat.subscribed'
  room_id: string
  from_seq?: number | null
}

export interface AthenaChatWsRoomEventBase {
  room_id: string
  room: AthenaChatRoom
}

export interface AthenaChatWsRoomCreatedEvent extends AthenaChatWsRoomEventBase {
  type: 'chat.room.created'
}

export interface AthenaChatWsRoomUpdatedEvent extends AthenaChatWsRoomEventBase {
  type: 'chat.room.updated'
}

export interface AthenaChatWsRoomArchivedEvent extends AthenaChatWsRoomEventBase {
  type: 'chat.room.archived'
}

export interface AthenaChatWsMessageEventBase {
  room_id: string
  message: AthenaChatMessage
}

export interface AthenaChatWsMessageCreatedEvent extends AthenaChatWsMessageEventBase {
  type: 'chat.message.created'
}

export interface AthenaChatWsMessageUpdatedEvent extends AthenaChatWsMessageEventBase {
  type: 'chat.message.updated'
}

export interface AthenaChatWsMessageDeletedEvent {
  type: 'chat.message.deleted'
  room_id: string
  message_id: string
  room_seq: number
}

export interface AthenaChatWsReadUpdatedEvent {
  type: 'chat.read.updated'
  room_id: string
  read_cursor: AthenaChatReadCursor
}

export interface AthenaChatWsMembersUpdatedEvent {
  type: 'chat.members.updated'
  room_id: string
  members: AthenaChatMember[]
}

export interface AthenaChatWsTypingUpdatedEvent {
  type: 'chat.typing.updated'
  room_id: string
  user_ids: string[]
}

export interface AthenaChatWsPresenceUpdatedEvent {
  type: 'chat.presence.updated'
  room_id?: string | null
  users: AthenaChatPresenceUser[]
}

export interface AthenaChatWsSyncRequiredEvent {
  type: 'chat.sync.required'
  room_id?: string | null
  reason?: string | null
}

export interface AthenaChatWsReactionUpdatedEvent {
  type: 'chat.reaction.updated'
  room_id: string
  summary: AthenaChatReactionSummary
}

export interface AthenaChatWsPongEvent {
  type: 'pong'
  at: string
}

export interface AthenaChatWsErrorEvent {
  type: 'error'
  error: string
  code?: string | null
}

export type AthenaChatWsServerEvent =
  | AthenaChatWsHelloOkEvent
  | AthenaChatWsSubscribedEvent
  | AthenaChatWsRoomCreatedEvent
  | AthenaChatWsRoomUpdatedEvent
  | AthenaChatWsRoomArchivedEvent
  | AthenaChatWsMessageCreatedEvent
  | AthenaChatWsMessageUpdatedEvent
  | AthenaChatWsMessageDeletedEvent
  | AthenaChatWsReadUpdatedEvent
  | AthenaChatWsMembersUpdatedEvent
  | AthenaChatWsTypingUpdatedEvent
  | AthenaChatWsPresenceUpdatedEvent
  | AthenaChatWsSyncRequiredEvent
  | AthenaChatWsReactionUpdatedEvent
  | AthenaChatWsPongEvent
  | AthenaChatWsErrorEvent

export type AthenaChatCallOptions = Pick<
  AthenaGatewayBaseOptions,
  | 'headers'
  | 'client'
  | 'apiKey'
  | 'athenaKey'
  | 'bearerToken'
  | 'cookie'
  | 'sessionToken'
  | 'forceNoCache'
> & {
  signal?: AbortSignal
}

export interface AthenaChatWebSocketLike {
  close(code?: number, reason?: string): void
  send(data: string): void
  addEventListener?(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: unknown) => void,
  ): void
  removeEventListener?(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: unknown) => void,
  ): void
  onopen?: ((event: unknown) => void) | null
  onmessage?: ((event: { data?: string | ArrayBuffer | Uint8Array | Blob }) => void) | null
  onerror?: ((event: unknown) => void) | null
  onclose?: ((event: unknown) => void) | null
}

export type AthenaChatWebSocketFactory =
  | ((url: string, protocols?: string | string[]) => AthenaChatWebSocketLike)
  | (new (url: string, protocols?: string | string[]) => AthenaChatWebSocketLike)

export interface AthenaChatConnectOptions {
  protocols?: string | string[]
  hello?: AthenaChatWsAuthHelloCommand
  onMessage?: (message: AthenaChatWsServerEvent | Record<string, unknown>) => void
}

export interface AthenaChatRealtimeConnection {
  readonly socket: AthenaChatWebSocketLike
  send(command: AthenaChatWsClientCommand): void
  hello(command?: Omit<AthenaChatWsAuthHelloCommand, 'type'>): void
  subscribe(roomId: string, fromSeq?: number | null): void
  unsubscribe(roomId: string): void
  resume(rooms: AthenaChatResumeRoomCursor[]): void
  typingStart(roomId: string): void
  typingStop(roomId: string): void
  presenceHeartbeat(activeRoomId?: string | null): void
  readUpTo(roomId: string, input?: Omit<AthenaChatMarkReadUpToRequest, never>): void
  ping(at?: string): void
  close(code?: number, reason?: string): void
}

export interface AthenaChatRealtimeModule {
  info(options?: AthenaChatCallOptions): Promise<AthenaChatRealtimeInfoResponse>
  connect(options?: AthenaChatConnectOptions): AthenaChatRealtimeConnection
}

export interface AthenaChatModule {
  room: {
    list(query?: AthenaChatListRoomsQuery, options?: AthenaChatCallOptions): Promise<AthenaChatRoomPage>
    create(input: AthenaChatCreateRoomRequest, options?: AthenaChatCallOptions): Promise<AthenaChatRoomCreatedResponse>
    get(roomId: string, options?: AthenaChatCallOptions): Promise<AthenaChatRoom>
    update(roomId: string, input: AthenaChatUpdateRoomRequest, options?: AthenaChatCallOptions): Promise<AthenaChatRoom>
    archive(roomId: string, options?: AthenaChatCallOptions): Promise<AthenaChatRoom>
    readCursor: {
      upTo(roomId: string, input?: AthenaChatMarkReadUpToRequest, options?: AthenaChatCallOptions): Promise<AthenaChatReadCursor>
    }
    member: {
      list(roomId: string, options?: AthenaChatCallOptions): Promise<AthenaChatMember[]>
      add(roomId: string, input: AthenaChatAddMembersRequest, options?: AthenaChatCallOptions): Promise<AthenaChatMember[]>
      remove(roomId: string, userId: string, options?: AthenaChatCallOptions): Promise<AthenaChatRemoveResult>
    }
    message: {
      list(roomId: string, query?: AthenaChatListMessagesQuery, options?: AthenaChatCallOptions): Promise<AthenaChatMessagePage>
      send(roomId: string, input: AthenaChatSendMessageRequest, options?: AthenaChatCallOptions): Promise<AthenaChatMessageCreatedResponse>
      update(roomId: string, messageId: string, input: AthenaChatEditMessageRequest, options?: AthenaChatCallOptions): Promise<AthenaChatMessage>
      delete(roomId: string, messageId: string, options?: AthenaChatCallOptions): Promise<AthenaChatDeleteResult>
    }
  }
  message: {
    reaction: {
      add(messageId: string, input: AthenaChatAddReactionRequest, options?: AthenaChatCallOptions): Promise<AthenaChatReactionSummary>
      remove(messageId: string, emoji: string, options?: AthenaChatCallOptions): Promise<AthenaChatReactionSummary>
    }
    search(input: AthenaChatSearchMessagesRequest, options?: AthenaChatCallOptions): Promise<AthenaChatSearchPage>
  }
  realtime: AthenaChatRealtimeModule
}
