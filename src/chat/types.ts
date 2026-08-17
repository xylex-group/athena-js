import type { AthenaGatewayBaseOptions } from "../gateway/types.ts";

export type AthenaChatRoomKind = "dm" | "group" | "channel";
export type AthenaChatMemberRole = "owner" | "admin" | "member";

export interface AthenaChatAttachmentInput {
  file_id: string;
  ordinal: number;
}

export interface AthenaChatAttachmentView extends AthenaChatAttachmentInput {
  authorized_url_path: string;
  bucket?: string | null;
  content_type?: string | null;
  extension?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  original_name?: string | null;
  proxy_url_path: string;
  public_url_path: string;
  size_bytes?: number | null;
  status?: string | null;
  storage_key?: string | null;
  visibility?: string | null;
}

export interface AthenaChatReactionCount {
  count: number;
  emoji: string;
  reacted: boolean;
}

export interface AthenaChatReactionSummary {
  message_id: string;
  reactions: AthenaChatReactionCount[];
}

export interface AthenaChatMessage {
  attachments: AthenaChatAttachmentView[];
  body_json?: Record<string, unknown> | null;
  body_text?: string | null;
  client_message_id?: string | null;
  created_at: string;
  deleted_at?: string | null;
  edited_at?: string | null;
  id: string;
  metadata_json?: Record<string, unknown> | null;
  reactions: AthenaChatReactionCount[];
  reply_to_message_id?: string | null;
  room_id: string;
  room_seq: number;
  sender_id: string;
}

export interface AthenaChatMessagePage {
  items: AthenaChatMessage[];
  next_before_seq?: number | null;
}

export interface AthenaChatRoom {
  archived_at?: string | null;
  created_at: string;
  created_by: string;
  id: string;
  kind: AthenaChatRoomKind;
  last_message_at?: string | null;
  last_message_id?: string | null;
  last_message_seq: number;
  organization_id: string;
  title?: string | null;
  updated_at: string;
  version: number;
}

export interface AthenaChatRoomPage {
  items: AthenaChatRoom[];
}

export interface AthenaChatMember {
  hidden_at?: string | null;
  joined_at: string;
  last_read_message_id?: string | null;
  last_read_seq: number;
  muted: boolean;
  notification_mode?: string | null;
  role: AthenaChatMemberRole;
  room_id: string;
  user_id: string;
}

export interface AthenaChatReadCursor {
  last_read_message_id?: string | null;
  last_read_seq: number;
  room_id: string;
  user_id: string;
}

export interface AthenaChatDeleteResult {
  message_id: string;
  ok: boolean;
}

export interface AthenaChatRemoveResult {
  ok: boolean;
  user_id: string;
}

export interface AthenaChatSearchHit {
  message: AthenaChatMessage;
  room_id: string;
}

export interface AthenaChatSearchPage {
  items: AthenaChatSearchHit[];
}

export interface AthenaChatCreateRoomRequest {
  kind: AthenaChatRoomKind;
  member_user_ids?: string[];
  title?: string | null;
}

export interface AthenaChatResolveDirectRoomRequest {
  participant_user_ids: [string, string];
}

export interface AthenaChatUpdateRoomRequest {
  title?: string | null;
}

export interface AthenaChatSendMessageRequest {
  attachments?: AthenaChatAttachmentInput[];
  body_json?: Record<string, unknown> | null;
  body_text?: string | null;
  client_message_id?: string | null;
  metadata_json?: Record<string, unknown> | null;
  reply_to_message_id?: string | null;
}

export interface AthenaChatEditMessageRequest {
  body_json?: Record<string, unknown> | null;
  body_text?: string | null;
  metadata_json?: Record<string, unknown> | null;
}

export interface AthenaChatMarkReadUpToRequest {
  message_id?: string | null;
  seq?: number | null;
}

export interface AthenaChatAddMembersRequest {
  role?: AthenaChatMemberRole | null;
  user_ids: string[];
}

export interface AthenaChatAddReactionRequest {
  emoji: string;
}

export interface AthenaChatSearchMessagesRequest {
  limit?: number | null;
  query: string;
  room_id?: string | null;
}

export interface AthenaChatRoomCreatedResponse {
  data: AthenaChatRoom;
  message: string;
  status: "success";
}

export interface AthenaChatMessageCreatedResponse {
  data: AthenaChatMessage;
  message: string;
  status: "success";
}

export interface AthenaChatListRoomsQuery {
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

export interface AthenaChatListMessagesQuery {
  after_seq?: number;
  before_seq?: number;
  limit?: number;
}

export interface AthenaChatRealtimeInfoResponse {
  data?: {
    transport?: string;
    path?: string;
    api_base?: string;
    actions?: string[];
  };
  message?: string;
  status?: string;
}

export interface AthenaChatResumeRoomCursor {
  last_seq: number;
  room_id: string;
}

export interface AthenaChatPresenceUser {
  active_room_id?: string | null;
  at?: string | null;
  state: string;
  user_id: string;
}

export interface AthenaChatWsAuthHelloCommand {
  room_subscriptions?: string[] | null;
  token?: string | null;
  type: "auth.hello";
}

export interface AthenaChatWsSubscribeCommand {
  from_seq?: number | null;
  room_id: string;
  type: "chat.subscribe";
}

export interface AthenaChatWsUnsubscribeCommand {
  room_id: string;
  type: "chat.unsubscribe";
}

export interface AthenaChatWsResumeCommand {
  rooms: AthenaChatResumeRoomCursor[];
  type: "chat.resume";
}

export interface AthenaChatWsTypingStartCommand {
  room_id: string;
  type: "chat.typing.start";
}

export interface AthenaChatWsTypingStopCommand {
  room_id: string;
  type: "chat.typing.stop";
}

export interface AthenaChatWsPresenceHeartbeatCommand {
  active_room_id?: string | null;
  type: "chat.presence.heartbeat";
}

export interface AthenaChatWsReadUpToCommand {
  message_id?: string | null;
  room_id: string;
  seq?: number | null;
  type: "chat.read.up_to";
}

export interface AthenaChatWsPingCommand {
  at: string;
  type: "ping";
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
  | AthenaChatWsPingCommand;

export interface AthenaChatWsHelloOkEvent {
  connection_id: string;
  server_time: string;
  type: "hello.ok";
}

export interface AthenaChatWsSubscribedEvent {
  from_seq?: number | null;
  room_id: string;
  type: "chat.subscribed";
}

export interface AthenaChatWsRoomEventBase {
  room: AthenaChatRoom;
  room_id: string;
}

export interface AthenaChatWsRoomCreatedEvent
  extends AthenaChatWsRoomEventBase {
  type: "chat.room.created";
}

export interface AthenaChatWsRoomUpdatedEvent
  extends AthenaChatWsRoomEventBase {
  type: "chat.room.updated";
}

export interface AthenaChatWsRoomArchivedEvent
  extends AthenaChatWsRoomEventBase {
  type: "chat.room.archived";
}

export interface AthenaChatWsMessageEventBase {
  message: AthenaChatMessage;
  room_id: string;
}

export interface AthenaChatWsMessageCreatedEvent
  extends AthenaChatWsMessageEventBase {
  type: "chat.message.created";
}

export interface AthenaChatWsMessageUpdatedEvent
  extends AthenaChatWsMessageEventBase {
  type: "chat.message.updated";
}

export interface AthenaChatWsMessageDeletedEvent {
  message_id: string;
  room_id: string;
  room_seq: number;
  type: "chat.message.deleted";
}

export interface AthenaChatWsReadUpdatedEvent {
  read_cursor: AthenaChatReadCursor;
  room_id: string;
  type: "chat.read.updated";
}

export interface AthenaChatWsMembersUpdatedEvent {
  members: AthenaChatMember[];
  room_id: string;
  type: "chat.members.updated";
}

export interface AthenaChatWsTypingUpdatedEvent {
  room_id: string;
  type: "chat.typing.updated";
  user_ids: string[];
}

export interface AthenaChatWsPresenceUpdatedEvent {
  room_id?: string | null;
  type: "chat.presence.updated";
  users: AthenaChatPresenceUser[];
}

export interface AthenaChatWsSyncRequiredEvent {
  reason?: string | null;
  room_id?: string | null;
  type: "chat.sync.required";
}

export interface AthenaChatWsReactionUpdatedEvent {
  room_id: string;
  summary: AthenaChatReactionSummary;
  type: "chat.reaction.updated";
}

export interface AthenaChatWsPongEvent {
  at: string;
  type: "pong";
}

export interface AthenaChatWsErrorEvent {
  code?: string | null;
  error: string;
  type: "error";
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
  | AthenaChatWsErrorEvent;

export type AthenaChatCallOptions = Pick<
  AthenaGatewayBaseOptions,
  | "headers"
  | "client"
  | "apiKey"
  | "bearerToken"
  | "cookie"
  | "sessionToken"
  | "forceNoCache"
> & {
  signal?: AbortSignal;
};

export interface AthenaChatWebSocketLike {
  addEventListener?: (
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ) => void;
  close: (code?: number, reason?: string) => void;
  onclose?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onmessage?:
    | ((event: { data?: string | ArrayBuffer | Uint8Array | Blob }) => void)
    | null;
  onopen?: ((event: unknown) => void) | null;
  removeEventListener?: (
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ) => void;
  send: (data: string) => void;
}

export type AthenaChatWebSocketFactory =
  | ((url: string, protocols?: string | string[]) => AthenaChatWebSocketLike)
  | (new (
      url: string,
      protocols?: string | string[]
    ) => AthenaChatWebSocketLike);

export interface AthenaChatConnectOptions {
  hello?: AthenaChatWsAuthHelloCommand;
  onMessage?: (
    message: AthenaChatWsServerEvent | Record<string, unknown>
  ) => void;
  protocols?: string | string[];
}

export interface AthenaChatRealtimeConnection {
  close: (code?: number, reason?: string) => void;
  hello: (command?: Omit<AthenaChatWsAuthHelloCommand, "type">) => void;
  ping: (at?: string) => void;
  presenceHeartbeat: (activeRoomId?: string | null) => void;
  readUpTo: (
    roomId: string,
    input?: Omit<AthenaChatMarkReadUpToRequest, never>
  ) => void;
  resume: (rooms: AthenaChatResumeRoomCursor[]) => void;
  send: (command: AthenaChatWsClientCommand) => void;
  readonly socket: AthenaChatWebSocketLike;
  subscribe: (roomId: string, fromSeq?: number | null) => void;
  typingStart: (roomId: string) => void;
  typingStop: (roomId: string) => void;
  unsubscribe: (roomId: string) => void;
}

export interface AthenaChatRealtimeModule {
  connect: (options?: AthenaChatConnectOptions) => AthenaChatRealtimeConnection;
  info: (
    options?: AthenaChatCallOptions
  ) => Promise<AthenaChatRealtimeInfoResponse>;
}

export interface AthenaChatModule {
  message: {
    reaction: {
      add: (
        messageId: string,
        input: AthenaChatAddReactionRequest,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatReactionSummary>;
      remove: (
        messageId: string,
        emoji: string,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatReactionSummary>;
    };
    search: (
      input: AthenaChatSearchMessagesRequest,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatSearchPage>;
  };
  realtime: AthenaChatRealtimeModule;
  room: {
    list: (
      query?: AthenaChatListRoomsQuery,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoomPage>;
    create: (
      input: AthenaChatCreateRoomRequest,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoomCreatedResponse>;
    resolveDirect: (
      input: AthenaChatResolveDirectRoomRequest,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoom>;
    get: (
      roomId: string,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoom>;
    update: (
      roomId: string,
      input: AthenaChatUpdateRoomRequest,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoom>;
    archive: (
      roomId: string,
      options?: AthenaChatCallOptions
    ) => Promise<AthenaChatRoom>;
    readCursor: {
      upTo: (
        roomId: string,
        input?: AthenaChatMarkReadUpToRequest,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatReadCursor>;
    };
    member: {
      list: (
        roomId: string,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatMember[]>;
      add: (
        roomId: string,
        input: AthenaChatAddMembersRequest,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatMember[]>;
      remove: (
        roomId: string,
        userId: string,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatRemoveResult>;
    };
    message: {
      list: (
        roomId: string,
        query?: AthenaChatListMessagesQuery,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatMessagePage>;
      send: (
        roomId: string,
        input: AthenaChatSendMessageRequest,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatMessageCreatedResponse>;
      update: (
        roomId: string,
        messageId: string,
        input: AthenaChatEditMessageRequest,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatMessage>;
      delete: (
        roomId: string,
        messageId: string,
        options?: AthenaChatCallOptions
      ) => Promise<AthenaChatDeleteResult>;
    };
  };
}
