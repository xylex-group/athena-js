import { randomUUID } from "node:crypto";
import {
  type ChatEventEnvelope,
  type ChatMutationCommit,
  createChatEvent,
} from "../events.ts";
import { decodeChatSearchCursor, encodeChatSearchCursor } from "../search.ts";
import type {
  AthenaChatAttachmentInput,
  AthenaChatListRoomsQuery,
  AthenaChatMember,
  AthenaChatMemberRole,
  AthenaChatMessage,
  AthenaChatReactionCount,
  AthenaChatRoom,
  AthenaChatRoomKind,
} from "../types.ts";
import {
  chatBadRequest,
  chatConflict,
  chatMembershipDenied,
  chatNotFound,
  chatRoleDenied,
} from "./errors.ts";
import type { ChatExecutionContext } from "./principal.ts";

export type ChatPersistenceIdentity = Pick<
  ChatExecutionContext,
  "organizationId" | "traceId" | "userId"
>;

type StoredMember = AthenaChatMember;
type StoredRoom = AthenaChatRoom;
type StoredMessage = AthenaChatMessage;
interface StoredReaction {
  emoji: string;
  messageId: string;
  userId: string;
}

export interface ChatSnapshot {
  directs: Map<string, string>;
  members: Map<string, StoredMember>;
  messages: Map<string, StoredMessage>;
  outbox: ChatEventEnvelope[];
  reactions: StoredReaction[];
  rooms: Map<string, StoredRoom>;
}

function cloneEvent(event: ChatEventEnvelope): ChatEventEnvelope {
  return JSON.parse(JSON.stringify(event)) as ChatEventEnvelope;
}

function cloneSnapshot(state: ChatSnapshot): ChatSnapshot {
  return {
    directs: new Map(state.directs),
    members: new Map(state.members),
    messages: new Map(
      [...state.messages.entries()].map(([id, message]) => [
        id,
        {
          ...message,
          attachments: [...message.attachments],
          reactions: message.reactions.map((item) => ({ ...item })),
        },
      ])
    ),
    outbox: state.outbox.map(cloneEvent),
    reactions: state.reactions.map((item) => ({ ...item })),
    rooms: new Map(
      [...state.rooms.entries()].map(([id, room]) => [id, { ...room }])
    ),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function memberKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

function canonicalDirectKey(
  organizationId: string,
  left: string,
  right: string
): string {
  const [a, b] = left < right ? [left, right] : [right, left];
  return `${organizationId}:${a}:${b}`;
}

function likeMatch(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

function reactionsFor(
  state: ChatSnapshot,
  messageId: string,
  actorId: string
): AthenaChatReactionCount[] {
  const counts = new Map<string, { count: number; reacted: boolean }>();
  for (const reaction of state.reactions) {
    if (reaction.messageId !== messageId) {
      continue;
    }
    const current = counts.get(reaction.emoji) ?? { count: 0, reacted: false };
    current.count += 1;
    if (reaction.userId === actorId) {
      current.reacted = true;
    }
    counts.set(reaction.emoji, current);
  }
  return [...counts.entries()].map(([emoji, value]) => ({
    count: value.count,
    emoji,
    reacted: value.reacted,
  }));
}

function hydrateMessage(
  state: ChatSnapshot,
  message: StoredMessage,
  actorId: string
): AthenaChatMessage {
  return {
    ...message,
    attachments: [...message.attachments],
    reactions: reactionsFor(state, message.id, actorId),
  };
}

export interface NormalizedChatRoomListQuery {
  includeArchived: boolean;
  limit: number;
  offset: number;
}

export function normalizeChatRoomListQuery(
  query?: AthenaChatListRoomsQuery
): NormalizedChatRoomListQuery {
  const requestedLimit = query?.limit;
  const limit =
    typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
      ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
      : 50;
  const requestedOffset = query?.offset;
  const offset =
    typeof requestedOffset === "number" && Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0;
  return {
    includeArchived: query?.include_archived ?? false,
    limit,
    offset,
  };
}

export class MemoryChatStore {
  #transactionTail: Promise<void> = Promise.resolve();
  #state: ChatSnapshot = {
    directs: new Map(),
    members: new Map(),
    messages: new Map(),
    outbox: [],
    reactions: [],
    rooms: new Map(),
  };

  async transaction<T>(fn: (store: MemoryChatStore) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousTurn = this.#transactionTail;
    this.#transactionTail = previousTurn.then(() => turn);
    await previousTurn;
    const previous = cloneSnapshot(this.#state);
    try {
      return await fn(this);
    } catch (error) {
      this.#state = previous;
      throw error;
    } finally {
      const releaseTurn = release;
      if (releaseTurn) {
        release = undefined;
        releaseTurn();
      }
    }
  }

  listOutbox(): ChatEventEnvelope[] {
    return this.#state.outbox.map(cloneEvent);
  }

  #appendEvent(event: ChatEventEnvelope): ChatEventEnvelope {
    this.#state.outbox.push(event);
    return event;
  }

  requireMember(roomId: string, actor: ChatPersistenceIdentity): StoredMember {
    const room = this.#state.rooms.get(roomId);
    if (!room || room.organization_id !== actor.organizationId) {
      throw chatNotFound("Chat room not found.");
    }
    const member = this.#state.members.get(memberKey(roomId, actor.userId));
    if (!member || member.hidden_at) {
      throw chatMembershipDenied();
    }
    return member;
  }

  listRooms(
    actor: ChatPersistenceIdentity,
    query?: AthenaChatListRoomsQuery
  ): StoredRoom[] {
    const normalizedQuery = normalizeChatRoomListQuery(query);
    const rooms: StoredRoom[] = [];
    for (const room of this.#state.rooms.values()) {
      if (room.organization_id !== actor.organizationId) {
        continue;
      }
      if (room.archived_at && !normalizedQuery.includeArchived) {
        continue;
      }
      const member = this.#state.members.get(memberKey(room.id, actor.userId));
      if (!member || member.hidden_at) {
        continue;
      }
      rooms.push({ ...room });
    }
    rooms.sort((left, right) => {
      const byActivity = (
        right.last_message_at ?? right.created_at
      ).localeCompare(left.last_message_at ?? left.created_at);
      if (byActivity !== 0) {
        return byActivity;
      }
      const byUpdate = right.updated_at.localeCompare(left.updated_at);
      return byUpdate === 0 ? right.id.localeCompare(left.id) : byUpdate;
    });
    return rooms.slice(
      normalizedQuery.offset,
      normalizedQuery.offset + normalizedQuery.limit
    );
  }

  getRoom(roomId: string, actor: ChatPersistenceIdentity): StoredRoom {
    this.requireMember(roomId, actor);
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    return { ...room };
  }

  createRoom(
    actor: ChatPersistenceIdentity,
    input: {
      kind: AthenaChatRoomKind;
      member_user_ids?: string[];
      title?: string | null;
    }
  ): ChatMutationCommit<StoredRoom> {
    if (input.kind === "dm") {
      throw chatBadRequest("Use resolveDirect for dm rooms.");
    }
    const createdAt = nowIso();
    const room: StoredRoom = {
      created_at: createdAt,
      created_by: actor.userId,
      id: randomUUID(),
      kind: input.kind,
      last_message_seq: 0,
      organization_id: actor.organizationId,
      title: input.title ?? null,
      updated_at: createdAt,
      version: 1,
    };
    this.#state.rooms.set(room.id, room);
    this.#putMember(room.id, actor.userId, "owner", createdAt);
    for (const userId of input.member_user_ids ?? []) {
      if (userId !== actor.userId) {
        this.#putMember(room.id, userId, "member", createdAt);
      }
    }
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: { room: { ...room }, type: "chat.room.created" },
          roomId: room.id,
          traceId: actor.traceId,
        })
      ),
      value: { ...room },
    };
  }

  resolveDirect(
    actor: ChatPersistenceIdentity,
    participantUserIds: [string, string]
  ): ChatMutationCommit<StoredRoom> {
    const [left, right] = participantUserIds;
    if (!(left && right) || left === right) {
      throw chatBadRequest("Direct rooms require two distinct participants.");
    }
    if (actor.userId !== left && actor.userId !== right) {
      throw chatMembershipDenied("Caller must be a direct-room participant.");
    }
    const key = canonicalDirectKey(actor.organizationId, left, right);
    const existingId = this.#state.directs.get(key);
    if (existingId) {
      return { value: this.getRoom(existingId, actor) };
    }
    const createdAt = nowIso();
    const room: StoredRoom = {
      created_at: createdAt,
      created_by: actor.userId,
      id: randomUUID(),
      kind: "dm",
      last_message_seq: 0,
      organization_id: actor.organizationId,
      title: null,
      updated_at: createdAt,
      version: 1,
    };
    this.#state.rooms.set(room.id, room);
    this.#state.directs.set(key, room.id);
    this.#putMember(room.id, left, "member", createdAt);
    this.#putMember(room.id, right, "member", createdAt);
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: { room: { ...room }, type: "chat.room.created" },
          roomId: room.id,
          traceId: actor.traceId,
        })
      ),
      value: { ...room },
    };
  }

  updateRoom(
    roomId: string,
    actor: ChatPersistenceIdentity,
    title?: string | null
  ): ChatMutationCommit<StoredRoom> {
    const member = this.requireMember(roomId, actor);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can update this room.");
    }
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    const nextTitle = title === undefined ? room.title : title;
    if (nextTitle === room.title) {
      return { value: { ...room } };
    }
    room.title = nextTitle;
    room.updated_at = nowIso();
    room.version += 1;
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: { room: { ...room }, type: "chat.room.updated" },
          roomId: room.id,
          traceId: actor.traceId,
        })
      ),
      value: { ...room },
    };
  }

  archiveRoom(
    roomId: string,
    actor: ChatPersistenceIdentity
  ): ChatMutationCommit<StoredRoom> {
    const member = this.requireMember(roomId, actor);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can archive this room.");
    }
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    if (room.archived_at) {
      return { value: { ...room } };
    }
    room.archived_at = nowIso();
    room.updated_at = room.archived_at;
    room.version += 1;
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: { room: { ...room }, type: "chat.room.archived" },
          roomId: room.id,
          traceId: actor.traceId,
        })
      ),
      value: { ...room },
    };
  }

  listMembers(roomId: string, actor: ChatPersistenceIdentity): StoredMember[] {
    this.requireMember(roomId, actor);
    return [...this.#state.members.values()]
      .filter((member) => member.room_id === roomId && !member.hidden_at)
      .map((member) => ({ ...member }));
  }

  addMembers(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userIds: string[],
    role: AthenaChatMemberRole = "member"
  ): ChatMutationCommit<StoredMember[]> {
    const member = this.requireMember(roomId, actor);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can add members.");
    }
    if (!["owner", "admin", "member"].includes(role)) {
      throw chatBadRequest("Invalid chat member role.");
    }
    if (role === "owner" && member.role !== "owner") {
      throw chatRoleDenied("Only an owner can grant owner role.");
    }
    const joinedAt = nowIso();
    let changed = false;
    for (const userId of userIds) {
      changed = this.#putMember(roomId, userId, role, joinedAt) || changed;
    }
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    if (changed) {
      room.version += 1;
      room.updated_at = joinedAt;
    }
    const members = this.listMembers(roomId, actor);
    return {
      ...(changed
        ? {
            event: this.#appendEvent(
              createChatEvent({
                payload: {
                  type: "chat.members.updated",
                  version: room.version,
                },
                roomId,
                traceId: actor.traceId,
              })
            ),
          }
        : {}),
      value: members,
    };
  }

  removeMember(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userId: string
  ): ChatMutationCommit<void> {
    const member = this.requireMember(roomId, actor);
    if (actor.userId !== userId && member.role === "member") {
      throw chatRoleDenied("Only owners and admins can remove members.");
    }
    const target = this.#state.members.get(memberKey(roomId, userId));
    const room = this.#state.rooms.get(roomId);
    if (!(target && room) || target.hidden_at) {
      throw chatNotFound("Chat member not found.");
    }
    if (target.role === "owner") {
      if (target.user_id === room.created_by) {
        throw chatRoleDenied("The founding owner cannot be removed.");
      }
      if (actor.userId !== userId && member.role !== "owner") {
        throw chatRoleDenied("Only an owner can remove another owner.");
      }
      const ownerCount = [...this.#state.members.values()].filter(
        (entry) =>
          entry.room_id === roomId && entry.role === "owner" && !entry.hidden_at
      ).length;
      if (actor.userId === userId && ownerCount <= 1) {
        throw chatRoleDenied("The last remaining owner cannot leave.");
      }
    }
    target.hidden_at = nowIso();
    room.version += 1;
    room.updated_at = target.hidden_at;
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: {
            type: "chat.members.updated",
            version: room.version,
          },
          roomId,
          traceId: actor.traceId,
        })
      ),
      value: undefined,
    };
  }

  updateMemberRole(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userId: string,
    role: AthenaChatMemberRole
  ): ChatMutationCommit<StoredMember[]> {
    const actorMember = this.requireMember(roomId, actor);
    if (actorMember.role !== "owner" && actorMember.role !== "admin") {
      throw chatRoleDenied("Only owners and admins can update member roles.");
    }
    const room = this.#state.rooms.get(roomId);
    const target = this.#state.members.get(memberKey(roomId, userId));
    if (!(room && target) || target.hidden_at) {
      throw chatNotFound("Chat member not found.");
    }
    if (target.user_id === room.created_by && role !== "owner") {
      throw chatRoleDenied("The founding owner cannot be demoted.");
    }
    if (target.role === "owner" && role !== "owner") {
      const ownerCount = [...this.#state.members.values()].filter(
        (entry) =>
          entry.room_id === roomId && entry.role === "owner" && !entry.hidden_at
      ).length;
      if (ownerCount <= 1) {
        throw chatRoleDenied("The last remaining owner cannot be demoted.");
      }
      if (actorMember.role !== "owner") {
        throw chatRoleDenied("Only an owner can demote another owner.");
      }
    }
    if (role === "owner" && actorMember.role !== "owner") {
      throw chatRoleDenied("Only an owner can grant owner role.");
    }
    if (target.role === role) {
      return { value: this.listMembers(roomId, actor) };
    }
    target.role = role;
    room.version += 1;
    room.updated_at = nowIso();
    const members = this.listMembers(roomId, actor);
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: {
            type: "chat.members.updated",
            version: room.version,
          },
          roomId,
          traceId: actor.traceId,
        })
      ),
      value: members,
    };
  }

  listMessages(
    roomId: string,
    actor: ChatPersistenceIdentity,
    query?: { after_seq?: number; before_seq?: number; limit?: number }
  ): {
    items: AthenaChatMessage[];
    next_after_seq: number | null;
    next_before_seq: number | null;
  } {
    this.requireMember(roomId, actor);
    const limit = Math.min(200, Math.max(1, query?.limit ?? 50));
    let items = [...this.#state.messages.values()].filter(
      (message) => message.room_id === roomId && !message.deleted_at
    );
    const afterSeq = query?.after_seq;
    if (afterSeq !== undefined) {
      items = items.filter((message) => message.room_seq > afterSeq);
    }
    const beforeSeq = query?.before_seq;
    if (beforeSeq !== undefined) {
      items = items.filter((message) => message.room_seq < beforeSeq);
    }
    items.sort((left, right) => left.room_seq - right.room_seq);
    const isDelta = query?.after_seq !== undefined;
    const page = isDelta ? items.slice(0, limit) : items.slice(-limit);
    const first = page[0];
    const hasOlder = first !== undefined && items[0]?.room_seq < first.room_seq;
    return {
      items: page.map((message) =>
        hydrateMessage(this.#state, message, actor.userId)
      ),
      next_after_seq:
        isDelta && page.length === limit
          ? (page.at(-1)?.room_seq ?? null)
          : null,
      next_before_seq: hasOlder ? (first?.room_seq ?? null) : null,
    };
  }

  sendMessage(
    roomId: string,
    actor: ChatPersistenceIdentity,
    input: {
      attachments?: AthenaChatAttachmentInput[];
      body_json?: Record<string, unknown> | null;
      body_text?: string | null;
      client_message_id?: string | null;
      metadata_json?: Record<string, unknown> | null;
      reply_to_message_id?: string | null;
    }
  ): ChatMutationCommit<{ message: AthenaChatMessage }> {
    this.requireMember(roomId, actor);
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    if (room.archived_at) {
      throw chatConflict("Cannot send to an archived room.");
    }
    if (input.client_message_id) {
      for (const existing of this.#state.messages.values()) {
        if (
          existing.room_id === roomId &&
          existing.client_message_id === input.client_message_id &&
          existing.sender_id === actor.userId
        ) {
          const message = hydrateMessage(this.#state, existing, actor.userId);
          return { value: { message } };
        }
      }
    }
    const createdAt = nowIso();
    const nextSeq = room.last_message_seq + 1;
    const message: StoredMessage = {
      attachments: (input.attachments ?? []).map((attachment) => ({
        ...attachment,
        authorized_url_path: `/files/${attachment.file_id}`,
        proxy_url_path: `/files/${attachment.file_id}`,
        public_url_path: `/files/${attachment.file_id}`,
      })),
      body_json: input.body_json ?? null,
      body_text: input.body_text ?? null,
      client_message_id: input.client_message_id ?? null,
      created_at: createdAt,
      id: randomUUID(),
      metadata_json: input.metadata_json ?? null,
      reactions: [],
      reply_to_message_id: input.reply_to_message_id ?? null,
      room_id: roomId,
      room_seq: nextSeq,
      sender_id: actor.userId,
    };
    this.#state.messages.set(message.id, message);
    room.last_message_at = createdAt;
    room.last_message_id = message.id;
    room.last_message_seq = nextSeq;
    room.updated_at = createdAt;
    room.version += 1;
    const hydrated = hydrateMessage(this.#state, message, actor.userId);
    const event = this.#appendEvent(
      createChatEvent({
        payload: { message: hydrated, type: "chat.message.created" },
        roomId,
        roomSeq: nextSeq,
        traceId: actor.traceId,
      })
    );
    return {
      event,
      value: { message: hydrated },
    };
  }

  updateMessage(
    roomId: string,
    messageId: string,
    actor: ChatPersistenceIdentity,
    input: {
      body_json?: Record<string, unknown> | null;
      body_text?: string | null;
      metadata_json?: Record<string, unknown> | null;
    }
  ): ChatMutationCommit<{ message: AthenaChatMessage }> {
    this.requireMember(roomId, actor);
    const message = this.#state.messages.get(messageId);
    if (!message || message.room_id !== roomId || message.deleted_at) {
      throw chatNotFound("Chat message not found.");
    }
    if (message.sender_id !== actor.userId) {
      throw chatRoleDenied("Only the sender can edit this message.");
    }
    const changed =
      (input.body_json !== undefined &&
        JSON.stringify(input.body_json) !==
          JSON.stringify(message.body_json)) ||
      (input.body_text !== undefined &&
        input.body_text !== message.body_text) ||
      (input.metadata_json !== undefined &&
        JSON.stringify(input.metadata_json) !==
          JSON.stringify(message.metadata_json));
    if (!changed) {
      return {
        value: { message: hydrateMessage(this.#state, message, actor.userId) },
      };
    }
    message.body_json =
      input.body_json === undefined ? message.body_json : input.body_json;
    message.body_text =
      input.body_text === undefined ? message.body_text : input.body_text;
    message.metadata_json =
      input.metadata_json === undefined
        ? message.metadata_json
        : input.metadata_json;
    message.edited_at = nowIso();
    const hydrated = hydrateMessage(this.#state, message, actor.userId);
    const event = this.#appendEvent(
      createChatEvent({
        payload: { message: hydrated, type: "chat.message.updated" },
        roomId,
        roomSeq: message.room_seq,
        traceId: actor.traceId,
      })
    );
    return {
      event,
      value: { message: hydrated },
    };
  }

  deleteMessage(
    roomId: string,
    messageId: string,
    actor: ChatPersistenceIdentity
  ): ChatMutationCommit<void> {
    this.requireMember(roomId, actor);
    const message = this.#state.messages.get(messageId);
    if (!message || message.room_id !== roomId) {
      throw chatNotFound("Chat message not found.");
    }
    if (message.sender_id !== actor.userId) {
      throw chatRoleDenied("Only the sender can delete this message.");
    }
    if (message.deleted_at) {
      return { value: undefined };
    }
    message.deleted_at = nowIso();
    return {
      event: this.#appendEvent(
        createChatEvent({
          payload: { message_id: messageId, type: "chat.message.deleted" },
          roomId,
          roomSeq: message.room_seq,
          traceId: actor.traceId,
        })
      ),
      value: undefined,
    };
  }

  addReaction(
    messageId: string,
    actor: ChatPersistenceIdentity,
    emoji: string
  ): ChatMutationCommit<AthenaChatReactionCount[]> {
    const message = this.#state.messages.get(messageId);
    if (!message || message.deleted_at) {
      throw chatNotFound("Chat message not found.");
    }
    this.requireMember(message.room_id, actor);
    const exists = this.#state.reactions.some(
      (reaction) =>
        reaction.messageId === messageId &&
        reaction.userId === actor.userId &&
        reaction.emoji === emoji
    );
    if (!exists) {
      this.#state.reactions.push({ emoji, messageId, userId: actor.userId });
    }
    const reactions = reactionsFor(this.#state, messageId, actor.userId);
    return {
      ...(exists
        ? {}
        : {
            event: this.#appendEvent(
              createChatEvent({
                payload: {
                  summary: { message_id: messageId, reactions },
                  type: "chat.reaction.updated",
                },
                roomId: message.room_id,
                roomSeq: message.room_seq,
                traceId: actor.traceId,
              })
            ),
          }),
      value: reactions,
    };
  }

  removeReaction(
    messageId: string,
    actor: ChatPersistenceIdentity,
    emoji: string
  ): ChatMutationCommit<AthenaChatReactionCount[]> {
    const message = this.#state.messages.get(messageId);
    if (!message || message.deleted_at) {
      throw chatNotFound("Chat message not found.");
    }
    this.requireMember(message.room_id, actor);
    const previousLength = this.#state.reactions.length;
    this.#state.reactions = this.#state.reactions.filter(
      (reaction) =>
        !(
          reaction.messageId === messageId &&
          reaction.userId === actor.userId &&
          reaction.emoji === emoji
        )
    );
    const reactions = reactionsFor(this.#state, messageId, actor.userId);
    return {
      ...(previousLength === this.#state.reactions.length
        ? {}
        : {
            event: this.#appendEvent(
              createChatEvent({
                payload: {
                  summary: { message_id: messageId, reactions },
                  type: "chat.reaction.updated",
                },
                roomId: message.room_id,
                roomSeq: message.room_seq,
                traceId: actor.traceId,
              })
            ),
          }),
      value: reactions,
    };
  }

  search(
    actor: ChatPersistenceIdentity,
    input: {
      cursor?: string | null;
      query: string;
      room_id?: string | null;
      limit?: number | null;
    }
  ): {
    items: { message: AthenaChatMessage; room_id: string }[];
    next_cursor: string | null;
  } {
    const query = input.query.trim();
    if (!query) {
      throw chatBadRequest("Search query is required.");
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const cursor = decodeChatSearchCursor(input.cursor);
    if (input.cursor && !cursor) {
      throw chatBadRequest("Search cursor is invalid.");
    }
    const compareDescending = (
      left: StoredMessage,
      right: StoredMessage
    ): number => {
      const created = right.created_at.localeCompare(left.created_at);
      return created || right.id.localeCompare(left.id);
    };
    const hits: { message: AthenaChatMessage; room_id: string }[] = [];
    const candidates = [...this.#state.messages.values()]
      .filter((message) => {
        if (
          message.deleted_at ||
          (input.room_id && message.room_id !== input.room_id)
        ) {
          return false;
        }
        const room = this.#state.rooms.get(message.room_id);
        const member = this.#state.members.get(
          memberKey(message.room_id, actor.userId)
        );
        if (
          !room ||
          room.organization_id !== actor.organizationId ||
          !member ||
          member.hidden_at
        ) {
          return false;
        }
        if (!cursor) {
          return true;
        }
        return (
          message.created_at < cursor.createdAt ||
          (message.created_at === cursor.createdAt && message.id < cursor.id)
        );
      })
      .sort(compareDescending);
    for (const message of candidates) {
      const body = message.body_text ?? "";
      if (!likeMatch(body, query)) {
        continue;
      }
      hits.push({
        message: hydrateMessage(this.#state, message, actor.userId),
        room_id: message.room_id,
      });
      if (hits.length >= limit) {
        break;
      }
    }
    const last = candidates.find(
      (message) => message.id === hits.at(-1)?.message.id
    );
    return {
      items: hits,
      next_cursor:
        hits.length === limit && last
          ? encodeChatSearchCursor({
              createdAt: last.created_at,
              id: last.id,
            })
          : null,
    };
  }

  markRead(
    roomId: string,
    actor: ChatPersistenceIdentity,
    input?: { message_id?: string | null; seq?: number | null }
  ): ChatMutationCommit<{
    last_read_message_id?: string | null;
    last_read_seq: number;
  }> {
    const member = this.requireMember(roomId, actor);
    const room = this.#state.rooms.get(roomId);
    if (!room) {
      throw chatNotFound("Chat room not found.");
    }
    let requestedSeq = input?.seq ?? member.last_read_seq;
    let requestedMessageId =
      input?.message_id ?? member.last_read_message_id ?? null;
    if (input?.message_id) {
      const message = this.#state.messages.get(input.message_id);
      if (!message || message.room_id !== roomId) {
        throw chatNotFound("Chat message not found.");
      }
      requestedSeq = message.room_seq;
      requestedMessageId = message.id;
    }
    const seq = Math.min(
      room.last_message_seq,
      Math.max(member.last_read_seq, requestedSeq)
    );
    const messageId =
      seq === requestedSeq ? requestedMessageId : member.last_read_message_id;
    const changed =
      seq !== member.last_read_seq || messageId !== member.last_read_message_id;
    if (changed) {
      member.last_read_seq = seq;
      member.last_read_message_id = messageId;
    }
    const value = {
      last_read_message_id: member.last_read_message_id,
      last_read_seq: member.last_read_seq,
    };
    return {
      ...(changed
        ? {
            event: this.#appendEvent(
              createChatEvent({
                payload: {
                  read_seq: value.last_read_seq,
                  type: "chat.read.updated",
                  user_id: actor.userId,
                },
                roomId,
                roomSeq: room.last_message_seq,
                traceId: actor.traceId,
              })
            ),
          }
        : {}),
      value,
    };
  }

  #putMember(
    roomId: string,
    userId: string,
    role: AthenaChatMemberRole,
    joinedAt: string
  ): boolean {
    const key = memberKey(roomId, userId);
    const existing = this.#state.members.get(key);
    if (existing) {
      const changed = Boolean(existing.hidden_at) || existing.role !== role;
      existing.hidden_at = null;
      existing.role = role;
      return changed;
    }
    this.#state.members.set(key, {
      joined_at: joinedAt,
      last_read_seq: 0,
      muted: false,
      role,
      room_id: roomId,
      user_id: userId,
    });
    return true;
  }
}

export function createMemoryChatStore(): MemoryChatStore {
  return new MemoryChatStore();
}
