import { randomUUID } from "node:crypto";
import {
  type ChatEventEnvelope,
  type ChatMutationCommit,
  createChatEvent,
} from "../events.ts";
import { decodeChatSearchCursor, encodeChatSearchCursor } from "../search.ts";
import type {
  AthenaChatAttachmentInput,
  AthenaChatAttachmentView,
  AthenaChatListRoomsQuery,
  AthenaChatMember,
  AthenaChatMemberRole,
  AthenaChatMessage,
  AthenaChatReactionCount,
  AthenaChatRoom,
  AthenaChatRoomKind,
} from "../types.ts";
import type { AthenaChatDatabase } from "./database.ts";
import {
  chatBadRequest,
  chatConflict,
  chatMembershipDenied,
  chatNotFound,
  chatRoleDenied,
} from "./errors.ts";
import {
  type ChatPersistenceIdentity,
  normalizeChatRoomListQuery,
} from "./store.ts";

type RoomRow = Record<string, unknown>;
type MessageRow = Record<string, unknown>;
type MemberRow = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = asString(value);
  return text ? text : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }
  return 0;
}

function asJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function canonicalPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

function mapRoom(row: RoomRow): AthenaChatRoom {
  return {
    archived_at: asNullableString(row.archived_at) ?? undefined,
    created_at: asString(row.created_at),
    created_by: asString(row.created_by),
    id: asString(row.id),
    kind: asString(row.kind) as AthenaChatRoomKind,
    last_message_at: asNullableString(row.last_message_at) ?? undefined,
    last_message_id: asNullableString(row.last_message_id) ?? undefined,
    last_message_seq: asNumber(row.last_message_seq),
    organization_id: asString(row.organization_id),
    title: asNullableString(row.title),
    updated_at: asString(row.updated_at),
    version: asNumber(row.version),
  };
}

function mapMember(row: MemberRow): AthenaChatMember {
  return {
    hidden_at: asNullableString(row.hidden_at) ?? undefined,
    joined_at: asString(row.joined_at),
    last_read_message_id:
      asNullableString(row.last_read_message_id) ?? undefined,
    last_read_seq: asNumber(row.last_read_seq),
    muted: row.muted === true,
    notification_mode: asNullableString(row.notification_mode) ?? undefined,
    role: asString(row.role) as AthenaChatMemberRole,
    room_id: asString(row.room_id),
    user_id: asString(row.user_id),
  };
}

function mapMessage(
  row: MessageRow,
  attachments: AthenaChatAttachmentView[],
  reactions: AthenaChatReactionCount[]
): AthenaChatMessage {
  return {
    attachments,
    body_json: asJson(row.body_json),
    body_text: asNullableString(row.body_text),
    client_message_id: asNullableString(row.client_message_id),
    created_at: asString(row.created_at),
    deleted_at: asNullableString(row.deleted_at) ?? undefined,
    edited_at: asNullableString(row.edited_at) ?? undefined,
    id: asString(row.id),
    metadata_json: asJson(row.metadata_json),
    reactions,
    reply_to_message_id: asNullableString(row.reply_to_message_id),
    room_id: asString(row.room_id),
    room_seq: asNumber(row.room_seq),
    sender_id: asString(row.sender_id),
  };
}

function mapAttachment(row: RoomRow): AthenaChatAttachmentView {
  return {
    authorized_url_path: `/files/${asString(row.file_id)}`,
    bucket: asNullableString(row.bucket),
    content_type: asNullableString(row.content_type),
    extension: asNullableString(row.extension),
    file_id: asString(row.file_id),
    file_name: asNullableString(row.file_name),
    file_url: asNullableString(row.url),
    mime_type: asNullableString(row.mime_type),
    ordinal: asNumber(row.ordinal),
    original_name: asNullableString(row.original_name),
    proxy_url_path: `/files/${asString(row.file_id)}`,
    public_url_path: `/files/${asString(row.file_id)}`,
    size_bytes: row.size_bytes == null ? null : asNumber(row.size_bytes),
    status: asNullableString(row.status),
    storage_key: asNullableString(row.storage_key),
    visibility: asNullableString(row.visibility),
  };
}

function mapReaction(row: RoomRow): AthenaChatReactionCount {
  return {
    count: asNumber(row.count),
    emoji: asString(row.emoji),
    reacted: row.reacted === true,
  };
}

function attachmentView(
  input: AthenaChatAttachmentInput
): AthenaChatAttachmentView {
  return {
    ...input,
    authorized_url_path: `/files/${input.file_id}`,
    proxy_url_path: `/files/${input.file_id}`,
    public_url_path: `/files/${input.file_id}`,
  };
}

export class PostgresChatStore {
  constructor(private readonly database: AthenaChatDatabase) {}

  async transaction<T>(
    fn: (store: PostgresChatStore) => Promise<T>
  ): Promise<T> {
    return this.database.transaction(async (scoped) =>
      fn(new PostgresChatStore(scoped))
    );
  }

  async requireMember(
    roomId: string,
    actor: ChatPersistenceIdentity,
    lock = false
  ): Promise<AthenaChatMember> {
    const sql = `
			SELECT r.id, r.organization_id, r.archived_at, r.last_message_seq,
				m.room_id, m.user_id, m.role, m.joined_at, m.hidden_at, m.muted,
				m.notification_mode, m.last_read_seq, m.last_read_message_id
			FROM athena.chat_rooms AS r
			LEFT JOIN athena.chat_room_members AS m
				ON m.room_id = r.id AND m.user_id = $2
			WHERE r.id = $1
			${lock ? "FOR UPDATE OF r" : ""}
		`;
    const result = await this.database.query<RoomRow>(sql, [
      roomId,
      actor.userId,
    ]);
    const row = result.rows[0];
    if (!row || asString(row.organization_id) !== actor.organizationId) {
      throw chatNotFound("Chat room not found.");
    }
    if (!row.user_id || row.hidden_at) {
      throw chatMembershipDenied();
    }
    return mapMember(row);
  }

  async listRooms(
    actor: ChatPersistenceIdentity,
    query?: AthenaChatListRoomsQuery
  ): Promise<AthenaChatRoom[]> {
    const normalizedQuery = normalizeChatRoomListQuery(query);
    const result = await this.database.query<RoomRow>(
      `
			SELECT r.*
			FROM athena.chat_rooms AS r
			INNER JOIN athena.chat_room_members AS m
				ON m.room_id = r.id
			WHERE r.organization_id = $1
				AND m.user_id = $2
				AND m.hidden_at IS NULL
				AND ($3::boolean OR r.archived_at IS NULL)
			ORDER BY COALESCE(r.last_message_at, r.created_at) DESC,
				r.updated_at DESC, r.id DESC
			LIMIT $4 OFFSET $5
			`,
      [
        actor.organizationId,
        actor.userId,
        normalizedQuery.includeArchived,
        normalizedQuery.limit,
        normalizedQuery.offset,
      ]
    );
    return result.rows.map(mapRoom);
  }

  async getRoom(
    roomId: string,
    actor: ChatPersistenceIdentity
  ): Promise<AthenaChatRoom> {
    await this.requireMember(roomId, actor);
    const result = await this.database.query<RoomRow>(
      "SELECT * FROM athena.chat_rooms WHERE id = $1",
      [roomId]
    );
    const row = result.rows[0];
    if (!row) {
      throw chatNotFound("Chat room not found.");
    }
    return mapRoom(row);
  }

  async createRoom(
    actor: ChatPersistenceIdentity,
    input: {
      kind: AthenaChatRoomKind;
      member_user_ids?: string[];
      title?: string | null;
    }
  ): Promise<ChatMutationCommit<AthenaChatRoom>> {
    if (input.kind === "dm") {
      throw chatBadRequest("Use resolveDirect for dm rooms.");
    }
    const createdAt = nowIso();
    const room: AthenaChatRoom = {
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
    await this.database.query(
      `
			INSERT INTO athena.chat_rooms
				(id, organization_id, kind, title, created_by, last_message_seq, version, created_at, updated_at)
			VALUES
				($1, $2, $3, $4, $5, 0, 1, $6::timestamptz, $6::timestamptz)
			`,
      [
        room.id,
        room.organization_id,
        room.kind,
        room.title,
        room.created_by,
        createdAt,
      ]
    );
    const memberIds = new Set([actor.userId, ...(input.member_user_ids ?? [])]);
    for (const userId of memberIds) {
      await this.#putMember(
        room.id,
        userId,
        userId === actor.userId ? "owner" : "member"
      );
    }
    const event = createChatEvent({
      payload: { room, type: "chat.room.created" },
      roomId: room.id,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", room.id, event);
    return { event, value: room };
  }

  async resolveDirect(
    actor: ChatPersistenceIdentity,
    participantUserIds: [string, string]
  ): Promise<ChatMutationCommit<AthenaChatRoom>> {
    const [left, right] = participantUserIds;
    if (!(left && right) || left === right) {
      throw chatBadRequest("Direct rooms require two distinct participants.");
    }
    if (actor.userId !== left && actor.userId !== right) {
      throw chatMembershipDenied("Caller must be a direct-room participant.");
    }
    const [one, two] = canonicalPair(left, right);
    const createdAt = nowIso();
    const candidateId = randomUUID();
    await this.database.query(
      `
			INSERT INTO athena.chat_rooms
				(id, organization_id, kind, title, created_by, last_message_seq, version, created_at, updated_at)
			VALUES
				($1, $2, 'dm', NULL, $3, 0, 1, $4::timestamptz, $4::timestamptz)
			`,
      [candidateId, actor.organizationId, actor.userId, createdAt]
    );
    for (const userId of [one, two]) {
      await this.#putMember(
        candidateId,
        userId,
        userId === actor.userId ? "owner" : "member"
      );
    }
    const inserted = await this.database.query<{ room_id: string }>(
      `
			INSERT INTO athena.chat_direct_rooms
				(organization_id, participant_one_id, participant_two_id, room_id)
			VALUES
				($1, $2, $3, $4)
			ON CONFLICT (organization_id, participant_one_id, participant_two_id) DO NOTHING
			RETURNING room_id
			`,
      [actor.organizationId, one, two, candidateId]
    );
    const createdId = inserted.rows[0]?.room_id;
    if (!createdId) {
      await this.database.query("DELETE FROM athena.chat_rooms WHERE id = $1", [
        candidateId,
      ]);
      const existing = await this.database.query<{ room_id: string }>(
        `
				SELECT room_id
				FROM athena.chat_direct_rooms
				WHERE organization_id = $1
					AND participant_one_id = $2
					AND participant_two_id = $3
				`,
        [actor.organizationId, one, two]
      );
      const roomId = existing.rows[0]?.room_id;
      if (!roomId) {
        throw chatConflict(
          "direct room resolution conflicted without a durable room"
        );
      }
      return { value: await this.getRoom(roomId, actor) };
    }
    const room: AthenaChatRoom = {
      created_at: createdAt,
      created_by: actor.userId,
      id: candidateId,
      kind: "dm",
      last_message_seq: 0,
      organization_id: actor.organizationId,
      title: null,
      updated_at: createdAt,
      version: 1,
    };
    const event = createChatEvent({
      payload: { room, type: "chat.room.created" },
      roomId: room.id,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", room.id, event);
    return { event, value: room };
  }

  async updateRoom(
    roomId: string,
    actor: ChatPersistenceIdentity,
    title?: string | null
  ): Promise<ChatMutationCommit<AthenaChatRoom>> {
    const member = await this.requireMember(roomId, actor, true);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can update this room.");
    }
    const current = await this.getRoom(roomId, actor);
    const nextTitle = title === undefined ? current.title : title;
    if (nextTitle === current.title) {
      return { value: current };
    }
    await this.database.query(
      `
			UPDATE athena.chat_rooms
			SET title = $2,
				updated_at = now(),
				version = version + 1
			WHERE id = $1
			`,
      [roomId, nextTitle]
    );
    const room = await this.getRoom(roomId, actor);
    const event = createChatEvent({
      payload: { room, type: "chat.room.updated" },
      roomId,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", roomId, event);
    return { event, value: room };
  }

  async archiveRoom(
    roomId: string,
    actor: ChatPersistenceIdentity
  ): Promise<ChatMutationCommit<AthenaChatRoom>> {
    const member = await this.requireMember(roomId, actor, true);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can archive this room.");
    }
    const current = await this.getRoom(roomId, actor);
    if (current.archived_at) {
      return { value: current };
    }
    await this.database.query(
      `
			UPDATE athena.chat_rooms
			SET archived_at = now(),
				updated_at = now(),
				version = version + 1
			WHERE id = $1
			`,
      [roomId]
    );
    const room = await this.getRoom(roomId, actor);
    const event = createChatEvent({
      payload: { room, type: "chat.room.archived" },
      roomId,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", roomId, event);
    return { event, value: room };
  }

  async listMembers(
    roomId: string,
    actor: ChatPersistenceIdentity
  ): Promise<AthenaChatMember[]> {
    await this.requireMember(roomId, actor);
    const result = await this.database.query<MemberRow>(
      `
			SELECT *
			FROM athena.chat_room_members
			WHERE room_id = $1 AND hidden_at IS NULL
			`,
      [roomId]
    );
    return result.rows.map(mapMember);
  }

  async addMembers(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userIds: string[],
    role: AthenaChatMemberRole = "member"
  ): Promise<ChatMutationCommit<AthenaChatMember[]>> {
    const member = await this.requireMember(roomId, actor, true);
    if (member.role === "member") {
      throw chatRoleDenied("Only owners and admins can add members.");
    }
    if (!["owner", "admin", "member"].includes(role)) {
      throw chatBadRequest("Invalid chat member role.");
    }
    if (role === "owner" && member.role !== "owner") {
      throw chatRoleDenied("Only an owner can grant owner role.");
    }
    let changed = false;
    for (const userId of userIds) {
      changed = (await this.#putMember(roomId, userId, role)) || changed;
    }
    if (changed) {
      await this.database.query(
        "UPDATE athena.chat_rooms SET version = version + 1, updated_at = now() WHERE id = $1",
        [roomId]
      );
    }
    const members = await this.listMembers(roomId, actor);
    const room = await this.database.query<{ version: unknown }>(
      "SELECT version FROM athena.chat_rooms WHERE id = $1",
      [roomId]
    );
    const version = asNumber(room.rows[0]?.version);
    if (!changed) {
      return { value: members };
    }
    const event = createChatEvent({
      payload: {
        type: "chat.members.updated",
        version,
      },
      roomId,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", roomId, event);
    return { event, value: members };
  }

  async removeMember(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userId: string
  ): Promise<ChatMutationCommit<void>> {
    const member = await this.requireMember(roomId, actor, true);
    if (actor.userId !== userId && member.role === "member") {
      throw chatRoleDenied("Only owners and admins can remove members.");
    }
    const targetResult = await this.database.query<{
      created_by: unknown;
      role: unknown;
    }>(
      `
			SELECT r.created_by, m.role
			FROM athena.chat_rooms AS r
			INNER JOIN athena.chat_room_members AS m ON m.room_id = r.id
			WHERE r.id = $1 AND m.user_id = $2 AND m.hidden_at IS NULL
			`,
      [roomId, userId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw chatNotFound("Chat member not found.");
    }
    const targetRole = asString(target.role);
    if (targetRole === "owner") {
      if (asString(target.created_by) === userId) {
        throw chatRoleDenied("The founding owner cannot be removed.");
      }
      if (actor.userId !== userId && member.role !== "owner") {
        throw chatRoleDenied("Only an owner can remove another owner.");
      }
      const owners = await this.database.query<{ count: unknown }>(
        `
				SELECT COUNT(*)::int AS count
				FROM athena.chat_room_members
				WHERE room_id = $1 AND role = 'owner' AND hidden_at IS NULL
				`,
        [roomId]
      );
      if (actor.userId === userId && asNumber(owners.rows[0]?.count) <= 1) {
        throw chatRoleDenied("The last remaining owner cannot leave.");
      }
    }
    const result = await this.database.query(
      `
			UPDATE athena.chat_room_members
			SET hidden_at = now()
			WHERE room_id = $1 AND user_id = $2
			RETURNING user_id
			`,
      [roomId, userId]
    );
    if ((result.rows?.length ?? 0) === 0) {
      throw chatNotFound("Chat member not found.");
    }
    await this.database.query(
      "UPDATE athena.chat_rooms SET version = version + 1, updated_at = now() WHERE id = $1",
      [roomId]
    );
    const room = await this.database.query<{ version: unknown }>(
      "SELECT version FROM athena.chat_rooms WHERE id = $1",
      [roomId]
    );
    const event = createChatEvent({
      payload: {
        type: "chat.members.updated",
        version: asNumber(room.rows[0]?.version),
      },
      roomId,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", roomId, event);
    return { event, value: undefined };
  }

  async updateMemberRole(
    roomId: string,
    actor: ChatPersistenceIdentity,
    userId: string,
    role: AthenaChatMemberRole
  ): Promise<ChatMutationCommit<AthenaChatMember[]>> {
    const actorMember = await this.requireMember(roomId, actor, true);
    if (actorMember.role !== "owner" && actorMember.role !== "admin") {
      throw chatRoleDenied("Only owners and admins can update member roles.");
    }
    if (!["owner", "admin", "member"].includes(role)) {
      throw chatBadRequest("Invalid chat member role.");
    }
    const targetResult = await this.database.query<{
      created_by: unknown;
      role: unknown;
    }>(
      `
			SELECT r.created_by, m.role
			FROM athena.chat_rooms AS r
			INNER JOIN athena.chat_room_members AS m ON m.room_id = r.id
			WHERE r.id = $1 AND m.user_id = $2 AND m.hidden_at IS NULL
			`,
      [roomId, userId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw chatNotFound("Chat member not found.");
    }
    const previousRole = asString(target.role);
    if (asString(target.created_by) === userId && role !== "owner") {
      throw chatRoleDenied("The founding owner cannot be demoted.");
    }
    if (previousRole === "owner" && role !== "owner") {
      const owners = await this.database.query<{ count: unknown }>(
        `
				SELECT COUNT(*)::int AS count
				FROM athena.chat_room_members
				WHERE room_id = $1 AND role = 'owner' AND hidden_at IS NULL
				`,
        [roomId]
      );
      if (asNumber(owners.rows[0]?.count) <= 1) {
        throw chatRoleDenied("The last remaining owner cannot be demoted.");
      }
      if (actorMember.role !== "owner") {
        throw chatRoleDenied("Only an owner can demote another owner.");
      }
    }
    if (role === "owner" && actorMember.role !== "owner") {
      throw chatRoleDenied("Only an owner can grant owner role.");
    }
    if (previousRole === role) {
      return { value: await this.listMembers(roomId, actor) };
    }
    await this.database.query(
      "UPDATE athena.chat_room_members SET role = $3 WHERE room_id = $1 AND user_id = $2",
      [roomId, userId, role]
    );
    await this.database.query(
      "UPDATE athena.chat_rooms SET version = version + 1, updated_at = now() WHERE id = $1",
      [roomId]
    );
    const members = await this.listMembers(roomId, actor);
    const room = await this.database.query<{ version: unknown }>(
      "SELECT version FROM athena.chat_rooms WHERE id = $1",
      [roomId]
    );
    const event = createChatEvent({
      payload: {
        type: "chat.members.updated",
        version: asNumber(room.rows[0]?.version),
      },
      roomId,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_room", roomId, event);
    return { event, value: members };
  }

  async listMessages(
    roomId: string,
    actor: ChatPersistenceIdentity,
    query?: { after_seq?: number; before_seq?: number; limit?: number }
  ): Promise<{
    items: AthenaChatMessage[];
    next_after_seq: number | null;
    next_before_seq: number | null;
  }> {
    await this.requireMember(roomId, actor);
    const limit = Math.min(200, Math.max(1, query?.limit ?? 50));
    const order = query?.after_seq === undefined ? "DESC" : "ASC";
    const result = await this.database.query<MessageRow>(
      `
			SELECT *
			FROM athena.chat_messages
			WHERE room_id = $1
				AND deleted_at IS NULL
				AND ($2::bigint IS NULL OR room_seq > $2)
				AND ($3::bigint IS NULL OR room_seq < $3)
			ORDER BY room_seq ${order}
			LIMIT $4
			`,
      [roomId, query?.after_seq ?? null, query?.before_seq ?? null, limit]
    );
    const rows =
      query?.after_seq === undefined ? [...result.rows].reverse() : result.rows;
    const messages = await this.#hydrateMessages(rows, actor.userId);
    return {
      items: messages,
      next_after_seq:
        query?.after_seq !== undefined && messages.length === limit
          ? (messages.at(-1)?.room_seq ?? null)
          : null,
      next_before_seq:
        query?.after_seq === undefined && messages.length === limit
          ? (messages[0]?.room_seq ?? null)
          : null,
    };
  }

  async sendMessage(
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
  ): Promise<ChatMutationCommit<{ message: AthenaChatMessage }>> {
    const access = await this.#lockRoom(roomId, actor);
    if (access.archived_at) {
      throw chatConflict("Cannot send to an archived room.");
    }
    if (input.client_message_id) {
      const existing = await this.database.query<MessageRow>(
        `
				SELECT *
				FROM athena.chat_messages
				WHERE room_id = $1
					AND sender_id = $2
					AND client_message_id = $3
				`,
        [roomId, actor.userId, input.client_message_id]
      );
      const row = existing.rows[0];
      if (row) {
        const message = await this.#hydrateMessage(row, actor.userId);
        return { value: { message } };
      }
    }
    const createdAt = nowIso();
    const nextSeq = access.last_message_seq + 1;
    const messageId = randomUUID();
    const attachments = (input.attachments ?? []).map(attachmentView);
    try {
      await this.database.query(
        `
				INSERT INTO athena.chat_messages
					(id, room_id, room_seq, sender_id, client_message_id, body_text, body_json,
					 reply_to_message_id, metadata_json, created_at)
				VALUES
					($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
				`,
        [
          messageId,
          roomId,
          nextSeq,
          actor.userId,
          input.client_message_id ?? null,
          input.body_text ?? null,
          input.body_json ?? null,
          input.reply_to_message_id ?? null,
          input.metadata_json ?? null,
          createdAt,
        ]
      );
    } catch (error) {
      if (isUniqueViolation(error) && input.client_message_id) {
        const replayed = await this.database.query<MessageRow>(
          `
					SELECT *
					FROM athena.chat_messages
					WHERE room_id = $1
						AND sender_id = $2
						AND client_message_id = $3
					`,
          [roomId, actor.userId, input.client_message_id]
        );
        const replayedRow = replayed.rows[0];
        if (replayedRow) {
          const message = await this.#hydrateMessage(replayedRow, actor.userId);
          return { value: { message } };
        }
      }
      throw error;
    }
    await this.#insertAttachments(messageId, attachments);
    await this.database.query(
      `
			UPDATE athena.chat_rooms
			SET last_message_id = $2,
				last_message_seq = $3,
				last_message_at = $4::timestamptz,
				updated_at = $4::timestamptz
			WHERE id = $1
			`,
      [roomId, messageId, nextSeq, createdAt]
    );
    const message: AthenaChatMessage = {
      attachments,
      body_json: input.body_json ?? null,
      body_text: input.body_text ?? null,
      client_message_id: input.client_message_id ?? null,
      created_at: createdAt,
      id: messageId,
      metadata_json: input.metadata_json ?? null,
      reactions: [],
      reply_to_message_id: input.reply_to_message_id ?? null,
      room_id: roomId,
      room_seq: nextSeq,
      sender_id: actor.userId,
    };
    const event = createChatEvent({
      payload: { message, type: "chat.message.created" },
      roomId,
      roomSeq: nextSeq,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_message", messageId, event);
    return { event, value: { message } };
  }

  async updateMessage(
    roomId: string,
    messageId: string,
    actor: ChatPersistenceIdentity,
    input: {
      body_json?: Record<string, unknown> | null;
      body_text?: string | null;
      metadata_json?: Record<string, unknown> | null;
    }
  ): Promise<ChatMutationCommit<{ message: AthenaChatMessage }>> {
    await this.requireMember(roomId, actor, true);
    const existing = await this.database.query<MessageRow>(
      `
			SELECT *
			FROM athena.chat_messages
			WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL
			`,
      [messageId, roomId]
    );
    const row = existing.rows[0];
    if (!row) {
      throw chatNotFound("Chat message not found.");
    }
    if (asString(row.sender_id) !== actor.userId) {
      throw chatRoleDenied("Only the sender can edit this message.");
    }
    const currentBodyText = asNullableString(row.body_text);
    const currentBodyJson = asJson(row.body_json);
    const currentMetadataJson = asJson(row.metadata_json);
    const bodyText =
      input.body_text === undefined ? currentBodyText : input.body_text;
    const bodyJson =
      input.body_json === undefined ? currentBodyJson : input.body_json;
    const metadataJson =
      input.metadata_json === undefined
        ? currentMetadataJson
        : input.metadata_json;
    const changed =
      JSON.stringify(bodyJson) !== JSON.stringify(currentBodyJson) ||
      bodyText !== currentBodyText ||
      JSON.stringify(metadataJson) !== JSON.stringify(currentMetadataJson);
    if (!changed) {
      return {
        value: { message: await this.#hydrateMessage(row, actor.userId) },
      };
    }
    await this.database.query(
      `
			UPDATE athena.chat_messages
			SET body_text = $2,
				body_json = $3,
				metadata_json = $4,
				edited_at = now()
			WHERE id = $1
			`,
      [messageId, bodyText, bodyJson, metadataJson]
    );
    const updated = await this.database.query<MessageRow>(
      "SELECT * FROM athena.chat_messages WHERE id = $1",
      [messageId]
    );
    const updatedRow = updated.rows[0] ?? row;
    const message = await this.#hydrateMessage(updatedRow, actor.userId);
    const event = createChatEvent({
      payload: { message, type: "chat.message.updated" },
      roomId,
      roomSeq: message.room_seq,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_message", messageId, event);
    return { event, value: { message } };
  }

  async deleteMessage(
    roomId: string,
    messageId: string,
    actor: ChatPersistenceIdentity
  ): Promise<ChatMutationCommit<void>> {
    await this.requireMember(roomId, actor, true);
    const existing = await this.database.query<MessageRow>(
      "SELECT sender_id, deleted_at FROM athena.chat_messages WHERE id = $1 AND room_id = $2",
      [messageId, roomId]
    );
    const row = existing.rows[0];
    if (!row) {
      throw chatNotFound("Chat message not found.");
    }
    if (asString(row.sender_id) !== actor.userId) {
      throw chatRoleDenied("Only the sender can delete this message.");
    }
    if (asNullableString(row.deleted_at)) {
      return { value: undefined };
    }
    await this.database.query(
      "UPDATE athena.chat_messages SET deleted_at = now() WHERE id = $1",
      [messageId]
    );
    const message = await this.database.query<{ room_seq: unknown }>(
      "SELECT room_seq FROM athena.chat_messages WHERE id = $1",
      [messageId]
    );
    const event = createChatEvent({
      payload: { message_id: messageId, type: "chat.message.deleted" },
      roomId,
      roomSeq: asNumber(message.rows[0]?.room_seq),
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_message", messageId, event);
    return { event, value: undefined };
  }

  async addReaction(
    messageId: string,
    actor: ChatPersistenceIdentity,
    emoji: string
  ): Promise<ChatMutationCommit<AthenaChatReactionCount[]>> {
    const message = await this.#requireMessageAccess(messageId, actor);
    const inserted = await this.database.query<{ message_id: unknown }>(
      `
			INSERT INTO athena.chat_message_reactions (message_id, user_id, emoji)
			VALUES ($1, $2, $3)
			ON CONFLICT (message_id, user_id, emoji) DO NOTHING
			RETURNING message_id
			`,
      [messageId, actor.userId, emoji]
    );
    const reactions = await this.#reactionsFor(message.id, actor.userId);
    if (inserted.rows.length === 0) {
      return { value: reactions };
    }
    const event = createChatEvent({
      payload: {
        summary: { message_id: messageId, reactions },
        type: "chat.reaction.updated",
      },
      roomId: message.room_id,
      roomSeq: message.room_seq,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_message", messageId, event);
    return { event, value: reactions };
  }

  async removeReaction(
    messageId: string,
    actor: ChatPersistenceIdentity,
    emoji: string
  ): Promise<ChatMutationCommit<AthenaChatReactionCount[]>> {
    const message = await this.#requireMessageAccess(messageId, actor);
    const deleted = await this.database.query<{ message_id: unknown }>(
      `
			DELETE FROM athena.chat_message_reactions
			WHERE message_id = $1 AND user_id = $2 AND emoji = $3
			RETURNING message_id
			`,
      [messageId, actor.userId, emoji]
    );
    const reactions = await this.#reactionsFor(message.id, actor.userId);
    if (deleted.rows.length === 0) {
      return { value: reactions };
    }
    const event = createChatEvent({
      payload: {
        summary: { message_id: messageId, reactions },
        type: "chat.reaction.updated",
      },
      roomId: message.room_id,
      roomSeq: message.room_seq,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("chat_message", messageId, event);
    return { event, value: reactions };
  }

  async search(
    actor: ChatPersistenceIdentity,
    input: {
      cursor?: string | null;
      query: string;
      room_id?: string | null;
      limit?: number | null;
    }
  ): Promise<{
    items: { message: AthenaChatMessage; room_id: string }[];
    next_cursor: string | null;
  }> {
    const query = input.query.trim();
    if (!query) {
      throw chatBadRequest("Search query is required.");
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const cursor = decodeChatSearchCursor(input.cursor);
    if (
      input.cursor &&
      !(
        cursor &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          cursor.id
        )
      )
    ) {
      throw chatBadRequest("Search cursor is invalid.");
    }
    const result = await this.database.query<MessageRow>(
      `
			SELECT m.*
			FROM athena.chat_messages AS m
			INNER JOIN athena.chat_rooms AS r ON r.id = m.room_id
			INNER JOIN athena.chat_room_members AS rm ON rm.room_id = r.id
			WHERE r.organization_id = $1
				AND rm.user_id = $2
				AND rm.hidden_at IS NULL
				AND m.deleted_at IS NULL
				AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3::timestamptz, $4::uuid))
				AND ($5::uuid IS NULL OR m.room_id = $5)
				AND COALESCE(m.body_text, '') ILIKE '%' || $6 || '%'
			ORDER BY m.created_at DESC, m.id DESC
			LIMIT $7
			`,
      [
        actor.organizationId,
        actor.userId,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        input.room_id ?? null,
        query,
        limit,
      ]
    );
    const messages = await this.#hydrateMessages(result.rows, actor.userId);
    const hits = messages.map((message) => ({
      message,
      room_id: message.room_id,
    }));
    const last = result.rows.at(-1);
    return {
      items: hits,
      next_cursor:
        hits.length === limit && last
          ? encodeChatSearchCursor({
              createdAt: asString(last.created_at),
              id: asString(last.id),
            })
          : null,
    };
  }

  async markRead(
    roomId: string,
    actor: ChatPersistenceIdentity,
    input?: { message_id?: string | null; seq?: number | null }
  ): Promise<
    ChatMutationCommit<{
      last_read_message_id?: string | null;
      last_read_seq: number;
    }>
  > {
    const member = await this.requireMember(roomId, actor, true);
    const access = await this.#lockRoom(roomId, actor);
    const currentMessageId = member.last_read_message_id ?? null;
    let requestedSeq = input?.seq ?? member.last_read_seq;
    let requestedMessageId = input?.message_id ?? currentMessageId;
    if (input?.message_id) {
      const existing = await this.database.query<MessageRow>(
        "SELECT id, room_seq FROM athena.chat_messages WHERE id = $1 AND room_id = $2",
        [input.message_id, roomId]
      );
      const row = existing.rows[0];
      if (!row) {
        throw chatNotFound("Chat message not found.");
      }
      requestedSeq = asNumber(row.room_seq);
      requestedMessageId = asString(row.id);
    }
    const seq = Math.min(
      access.last_message_seq,
      Math.max(member.last_read_seq, requestedSeq)
    );
    const nextMessageId =
      seq === requestedSeq ? requestedMessageId : currentMessageId;
    const changed =
      seq !== member.last_read_seq || nextMessageId !== currentMessageId;
    if (changed) {
      await this.database.query(
        `
			UPDATE athena.chat_room_members
			SET last_read_seq = $3,
				last_read_message_id = $4
			WHERE room_id = $1 AND user_id = $2
			`,
        [roomId, actor.userId, seq, nextMessageId]
      );
    }
    const value = {
      last_read_message_id: nextMessageId,
      last_read_seq: seq,
    };
    if (!changed) {
      return { value };
    }
    const event = createChatEvent({
      payload: {
        read_seq: seq,
        type: "chat.read.updated",
        user_id: actor.userId,
      },
      roomId,
      roomSeq: access.last_message_seq,
      traceId: actor.traceId,
    });
    await this.#insertOutbox("read_cursor", actor.userId, event);
    return { event, value };
  }

  async #lockRoom(
    roomId: string,
    actor: ChatPersistenceIdentity
  ): Promise<{ archived_at: string | null; last_message_seq: number }> {
    const result = await this.database.query<RoomRow>(
      `
			SELECT r.archived_at, r.last_message_seq, r.organization_id, m.user_id, m.hidden_at
			FROM athena.chat_rooms AS r
			LEFT JOIN athena.chat_room_members AS m
				ON m.room_id = r.id AND m.user_id = $2
			WHERE r.id = $1
			FOR UPDATE OF r
			`,
      [roomId, actor.userId]
    );
    const row = result.rows[0];
    if (!row || asString(row.organization_id) !== actor.organizationId) {
      throw chatNotFound("Chat room not found.");
    }
    if (!row.user_id || row.hidden_at) {
      throw chatMembershipDenied();
    }
    return {
      archived_at: asNullableString(row.archived_at),
      last_message_seq: asNumber(row.last_message_seq),
    };
  }

  async #putMember(
    roomId: string,
    userId: string,
    role: AthenaChatMemberRole
  ): Promise<boolean> {
    const result = await this.database.query<{ user_id: unknown }>(
      `
			INSERT INTO athena.chat_room_members
				(room_id, user_id, role, last_read_seq, muted)
			VALUES
				($1, $2, $3, 0, false)
			ON CONFLICT (room_id, user_id) DO UPDATE
			SET hidden_at = NULL,
				role = EXCLUDED.role
			WHERE hidden_at IS NOT NULL
				OR role IS DISTINCT FROM EXCLUDED.role
			RETURNING user_id
			`,
      [roomId, userId, role]
    );
    return result.rows.length > 0;
  }

  async #insertAttachments(
    messageId: string,
    attachments: AthenaChatAttachmentInput[]
  ): Promise<void> {
    for (const attachment of attachments) {
      await this.database.query(
        `
				INSERT INTO athena.files (id)
				VALUES ($1)
				ON CONFLICT (id) DO NOTHING
				`,
        [attachment.file_id]
      );
      await this.database.query(
        `
				INSERT INTO athena.chat_message_attachments (message_id, file_id, ordinal)
				VALUES ($1, $2, $3)
				`,
        [messageId, attachment.file_id, attachment.ordinal]
      );
    }
  }

  async #insertOutbox(
    aggregateType: "chat_message" | "chat_room" | "read_cursor",
    aggregateId: string,
    event: ChatEventEnvelope
  ): Promise<void> {
    const persisted = {
      event_id: event.eventId,
      occurred_at: event.occurredAt,
      payload: event.payload,
      room_id: event.roomId,
      room_seq: event.roomSeq,
      ...(event.traceId ? { trace_id: event.traceId } : {}),
    };
    await this.database.query(
      `
			INSERT INTO athena.chat_outbox
				(id, aggregate_type, aggregate_id, room_id, room_seq, event_type, payload_json)
			VALUES
				($1, $2, $3, $4, $5, $6, $7)
			`,
      [
        randomUUID(),
        aggregateType,
        aggregateId,
        event.roomId,
        event.roomSeq,
        event.payload.type,
        persisted,
      ]
    );
  }

  async #requireMessageAccess(
    messageId: string,
    actor: ChatPersistenceIdentity
  ): Promise<AthenaChatMessage> {
    const result = await this.database.query<MessageRow>(
      `
			SELECT m.*
			FROM athena.chat_messages AS m
			INNER JOIN athena.chat_rooms AS r ON r.id = m.room_id
			WHERE m.id = $1 AND m.deleted_at IS NULL AND r.organization_id = $2
			`,
      [messageId, actor.organizationId]
    );
    const row = result.rows[0];
    if (!row) {
      throw chatNotFound("Chat message not found.");
    }
    await this.requireMember(asString(row.room_id), actor);
    return this.#hydrateMessage(row, actor.userId);
  }

  async #hydrateMessage(
    row: MessageRow,
    actorId: string
  ): Promise<AthenaChatMessage> {
    const [message] = await this.#hydrateMessages([row], actorId);
    if (!message) {
      throw chatNotFound("Chat message not found.");
    }
    return message;
  }

  async #hydrateMessages(
    rows: MessageRow[],
    actorId: string
  ): Promise<AthenaChatMessage[]> {
    if (rows.length === 0) {
      return [];
    }

    const messageIds = rows.map((row) => asString(row.id));
    const [attachmentsByMessage, reactionsByMessage] = await Promise.all([
      this.#attachmentsForMany(messageIds),
      this.#reactionsForMany(messageIds, actorId),
    ]);
    return rows.map((row) => {
      const messageId = asString(row.id);
      return mapMessage(
        row,
        attachmentsByMessage.get(messageId) ?? [],
        reactionsByMessage.get(messageId) ?? []
      );
    });
  }

  async #attachmentsForMany(
    messageIds: string[]
  ): Promise<Map<string, AthenaChatAttachmentView[]>> {
    const result = await this.database.query<RoomRow>(
      `
			SELECT a.message_id, a.file_id, a.ordinal, f.file_name, f.original_name, f.content_type,
				f.mime_type, f.extension, f.size_bytes, f.status, f.visibility, f.url,
				f.bucket, f.storage_key
			FROM athena.chat_message_attachments AS a
			LEFT JOIN athena.files AS f ON f.id = a.file_id
			WHERE a.message_id = ANY($1::uuid[])
			ORDER BY a.message_id, a.ordinal
			`,
      [messageIds]
    );
    const attachmentsByMessage = new Map<string, AthenaChatAttachmentView[]>();
    for (const row of result.rows) {
      const messageId = asString(row.message_id);
      const attachments = attachmentsByMessage.get(messageId) ?? [];
      attachments.push(mapAttachment(row));
      attachmentsByMessage.set(messageId, attachments);
    }
    return attachmentsByMessage;
  }

  async #reactionsFor(
    messageId: string,
    actorId: string
  ): Promise<AthenaChatReactionCount[]> {
    const result = await this.database.query<{
      count: unknown;
      emoji: string;
      reacted: unknown;
    }>(
      `
			SELECT emoji,
				COUNT(*)::int AS count,
				BOOL_OR(user_id = $2) AS reacted
			FROM athena.chat_message_reactions
			WHERE message_id = $1
			GROUP BY emoji
			`,
      [messageId, actorId]
    );
    return result.rows.map(mapReaction);
  }

  async #reactionsForMany(
    messageIds: string[],
    actorId: string
  ): Promise<Map<string, AthenaChatReactionCount[]>> {
    const result = await this.database.query<RoomRow>(
      `
			SELECT message_id, emoji,
				COUNT(*)::int AS count,
				BOOL_OR(user_id = $2) AS reacted
			FROM athena.chat_message_reactions
			WHERE message_id = ANY($1::uuid[])
			GROUP BY message_id, emoji
			ORDER BY message_id, emoji
			`,
      [messageIds, actorId]
    );
    const reactionsByMessage = new Map<string, AthenaChatReactionCount[]>();
    for (const row of result.rows) {
      const messageId = asString(row.message_id);
      const reactions = reactionsByMessage.get(messageId) ?? [];
      reactions.push(mapReaction(row));
      reactionsByMessage.set(messageId, reactions);
    }
    return reactionsByMessage;
  }
}

export function createPostgresChatStore(
  database: AthenaChatDatabase
): PostgresChatStore {
  return new PostgresChatStore(database);
}
