import { randomUUID } from "node:crypto";
import type {
	AthenaChatAttachmentInput,
	AthenaChatAttachmentView,
	AthenaChatMember,
	AthenaChatMemberRole,
	AthenaChatMessage,
	AthenaChatReactionCount,
	AthenaChatRoom,
	AthenaChatRoomKind,
} from "../types.ts";
import type { AthenaChatDatabase } from "./database.ts";
import { chatBadRequest, chatConflict, chatForbidden, chatNotFound } from "./errors.ts";
import type { ChatActor } from "./principal.ts";
import type { ChatDomainEvent } from "./store.ts";

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
		last_read_message_id: asNullableString(row.last_read_message_id) ?? undefined,
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
	reactions: AthenaChatReactionCount[],
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

function attachmentView(input: AthenaChatAttachmentInput): AthenaChatAttachmentView {
	return {
		...input,
		authorized_url_path: `/files/${input.file_id}`,
		proxy_url_path: `/files/${input.file_id}`,
		public_url_path: `/files/${input.file_id}`,
	};
}

export class PostgresChatStore {
	constructor(private readonly database: AthenaChatDatabase) {}

	async transaction<T>(fn: (store: PostgresChatStore) => Promise<T>): Promise<T> {
		return this.database.transaction(async (scoped) => fn(new PostgresChatStore(scoped)));
	}

	async requireMember(roomId: string, actor: ChatActor, lock = false): Promise<AthenaChatMember> {
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
		const result = await this.database.query<RoomRow>(sql, [roomId, actor.userId]);
		const row = result.rows[0];
		if (!row || asString(row.organization_id) !== actor.organizationId) {
			throw chatNotFound("Chat room not found.");
		}
		if (!row.user_id || row.hidden_at) {
			throw chatForbidden("Not a member of this chat room.");
		}
		return mapMember(row);
	}

	async listRooms(actor: ChatActor, includeArchived = false): Promise<AthenaChatRoom[]> {
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
			ORDER BY COALESCE(r.last_message_at, r.updated_at) DESC
			`,
			[actor.organizationId, actor.userId, includeArchived],
		);
		return result.rows.map(mapRoom);
	}

	async getRoom(roomId: string, actor: ChatActor): Promise<AthenaChatRoom> {
		await this.requireMember(roomId, actor);
		const result = await this.database.query<RoomRow>(
			"SELECT * FROM athena.chat_rooms WHERE id = $1",
			[roomId],
		);
		const row = result.rows[0];
		if (!row) {
			throw chatNotFound("Chat room not found.");
		}
		return mapRoom(row);
	}

	async createRoom(
		actor: ChatActor,
		input: { kind: AthenaChatRoomKind; member_user_ids?: string[]; title?: string | null },
	): Promise<AthenaChatRoom> {
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
			[room.id, room.organization_id, room.kind, room.title, room.created_by, createdAt],
		);
		const memberIds = new Set([actor.userId, ...(input.member_user_ids ?? [])]);
		for (const userId of memberIds) {
			await this.#putMember(room.id, userId, userId === actor.userId ? "owner" : "member");
		}
		await this.#insertOutbox("chat_room", room.id, room.id, null, "chat.room.created", {
			room,
		});
		return room;
	}

	async resolveDirect(actor: ChatActor, participantUserIds: [string, string]): Promise<AthenaChatRoom> {
		const [left, right] = participantUserIds;
		if (!left || !right || left === right) {
			throw chatBadRequest("Direct rooms require two distinct participants.");
		}
		if (actor.userId !== left && actor.userId !== right) {
			throw chatForbidden("Caller must be a direct-room participant.");
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
			[candidateId, actor.organizationId, actor.userId, createdAt],
		);
		for (const userId of [one, two]) {
			await this.#putMember(candidateId, userId, userId === actor.userId ? "owner" : "member");
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
			[actor.organizationId, one, two, candidateId],
		);
		const createdId = inserted.rows[0]?.room_id;
		if (!createdId) {
			await this.database.query("DELETE FROM athena.chat_rooms WHERE id = $1", [candidateId]);
			const existing = await this.database.query<{ room_id: string }>(
				`
				SELECT room_id
				FROM athena.chat_direct_rooms
				WHERE organization_id = $1
					AND participant_one_id = $2
					AND participant_two_id = $3
				`,
				[actor.organizationId, one, two],
			);
			const roomId = existing.rows[0]?.room_id;
			if (!roomId) {
				throw chatConflict("direct room resolution conflicted without a durable room");
			}
			return this.getRoom(roomId, actor);
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
		await this.#insertOutbox("chat_room", room.id, room.id, null, "chat.room.created", { room });
		return room;
	}

	async updateRoom(roomId: string, actor: ChatActor, title?: string | null): Promise<AthenaChatRoom> {
		const member = await this.requireMember(roomId, actor, true);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can update this room.");
		}
		await this.database.query(
			`
			UPDATE athena.chat_rooms
			SET title = COALESCE($2, title),
				updated_at = now(),
				version = version + 1
			WHERE id = $1
			`,
			[roomId, title ?? null],
		);
		return this.getRoom(roomId, actor);
	}

	async archiveRoom(roomId: string, actor: ChatActor): Promise<AthenaChatRoom> {
		const member = await this.requireMember(roomId, actor, true);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can archive this room.");
		}
		await this.database.query(
			`
			UPDATE athena.chat_rooms
			SET archived_at = now(),
				updated_at = now(),
				version = version + 1
			WHERE id = $1
			`,
			[roomId],
		);
		return this.getRoom(roomId, actor);
	}

	async listMembers(roomId: string, actor: ChatActor): Promise<AthenaChatMember[]> {
		await this.requireMember(roomId, actor);
		const result = await this.database.query<MemberRow>(
			`
			SELECT *
			FROM athena.chat_room_members
			WHERE room_id = $1 AND hidden_at IS NULL
			`,
			[roomId],
		);
		return result.rows.map(mapMember);
	}

	async addMembers(
		roomId: string,
		actor: ChatActor,
		userIds: string[],
		role: AthenaChatMemberRole = "member",
	): Promise<AthenaChatMember[]> {
		const member = await this.requireMember(roomId, actor, true);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can add members.");
		}
		for (const userId of userIds) {
			await this.#putMember(roomId, userId, role);
		}
		return this.listMembers(roomId, actor);
	}

	async removeMember(roomId: string, actor: ChatActor, userId: string): Promise<void> {
		const member = await this.requireMember(roomId, actor, true);
		if (actor.userId !== userId && member.role === "member") {
			throw chatForbidden("Only owners and admins can remove members.");
		}
		const result = await this.database.query(
			`
			UPDATE athena.chat_room_members
			SET hidden_at = now()
			WHERE room_id = $1 AND user_id = $2
			RETURNING user_id
			`,
			[roomId, userId],
		);
		if ((result.rows?.length ?? 0) === 0) {
			throw chatNotFound("Chat member not found.");
		}
	}

	async listMessages(
		roomId: string,
		actor: ChatActor,
		query?: { after_seq?: number; before_seq?: number; limit?: number },
	): Promise<AthenaChatMessage[]> {
		await this.requireMember(roomId, actor);
		const limit = query?.limit ?? 50;
		const result = await this.database.query<MessageRow>(
			`
			SELECT *
			FROM athena.chat_messages
			WHERE room_id = $1
				AND deleted_at IS NULL
				AND ($2::bigint IS NULL OR room_seq > $2)
				AND ($3::bigint IS NULL OR room_seq < $3)
			ORDER BY room_seq DESC
			LIMIT $4
			`,
			[roomId, query?.after_seq ?? null, query?.before_seq ?? null, limit],
		);
		const rows = [...result.rows].reverse();
		const messages: AthenaChatMessage[] = [];
		for (const row of rows) {
			messages.push(await this.#hydrateMessage(row, actor.userId));
		}
		return messages;
	}

	async sendMessage(
		roomId: string,
		actor: ChatActor,
		input: {
			attachments?: AthenaChatAttachmentInput[];
			body_json?: Record<string, unknown> | null;
			body_text?: string | null;
			client_message_id?: string | null;
			metadata_json?: Record<string, unknown> | null;
			reply_to_message_id?: string | null;
		},
	): Promise<{ event: ChatDomainEvent; message: AthenaChatMessage }> {
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
				[roomId, actor.userId, input.client_message_id],
			);
			const row = existing.rows[0];
			if (row) {
				const message = await this.#hydrateMessage(row, actor.userId);
				return {
					event: {
						kind: "chat.message.created",
						message,
						roomId,
						roomSeq: message.room_seq,
					},
					message,
				};
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
				],
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
					[roomId, actor.userId, input.client_message_id],
				);
				const replayedRow = replayed.rows[0];
				if (replayedRow) {
					const message = await this.#hydrateMessage(replayedRow, actor.userId);
					return {
						event: {
							kind: "chat.message.created",
							message,
							roomId,
							roomSeq: message.room_seq,
						},
						message,
					};
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
			[roomId, messageId, nextSeq, createdAt],
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
		await this.#insertOutbox("chat_message", messageId, roomId, nextSeq, "chat.message.created", {
			message,
		});
		return {
			event: {
				kind: "chat.message.created",
				message,
				roomId,
				roomSeq: nextSeq,
			},
			message,
		};
	}

	async updateMessage(
		roomId: string,
		messageId: string,
		actor: ChatActor,
		input: {
			body_json?: Record<string, unknown> | null;
			body_text?: string | null;
			metadata_json?: Record<string, unknown> | null;
		},
	): Promise<{ event: ChatDomainEvent; message: AthenaChatMessage }> {
		await this.requireMember(roomId, actor, true);
		const existing = await this.database.query<MessageRow>(
			`
			SELECT *
			FROM athena.chat_messages
			WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL
			`,
			[messageId, roomId],
		);
		const row = existing.rows[0];
		if (!row) {
			throw chatNotFound("Chat message not found.");
		}
		if (asString(row.sender_id) !== actor.userId) {
			throw chatForbidden("Only the sender can edit this message.");
		}
		await this.database.query(
			`
			UPDATE athena.chat_messages
			SET body_text = COALESCE($2, body_text),
				body_json = COALESCE($3, body_json),
				metadata_json = COALESCE($4, metadata_json),
				edited_at = now()
			WHERE id = $1
			`,
			[messageId, input.body_text ?? null, input.body_json ?? null, input.metadata_json ?? null],
		);
		const updated = await this.database.query<MessageRow>(
			"SELECT * FROM athena.chat_messages WHERE id = $1",
			[messageId],
		);
		const updatedRow = updated.rows[0] ?? row;
		const message = await this.#hydrateMessage(updatedRow, actor.userId);
		await this.#insertOutbox(
			"chat_message",
			messageId,
			roomId,
			message.room_seq,
			"chat.message.updated",
			{ message },
		);
		return {
			event: {
				kind: "chat.message.updated",
				message,
				roomId,
				roomSeq: message.room_seq,
			},
			message,
		};
	}

	async deleteMessage(roomId: string, messageId: string, actor: ChatActor): Promise<void> {
		await this.requireMember(roomId, actor, true);
		const existing = await this.database.query<MessageRow>(
			"SELECT sender_id FROM athena.chat_messages WHERE id = $1 AND room_id = $2",
			[messageId, roomId],
		);
		const row = existing.rows[0];
		if (!row) {
			throw chatNotFound("Chat message not found.");
		}
		if (asString(row.sender_id) !== actor.userId) {
			throw chatForbidden("Only the sender can delete this message.");
		}
		await this.database.query(
			"UPDATE athena.chat_messages SET deleted_at = now() WHERE id = $1",
			[messageId],
		);
	}

	async addReaction(
		messageId: string,
		actor: ChatActor,
		emoji: string,
	): Promise<AthenaChatReactionCount[]> {
		const message = await this.#requireMessageAccess(messageId, actor);
		await this.database.query(
			`
			INSERT INTO athena.chat_message_reactions (message_id, user_id, emoji)
			VALUES ($1, $2, $3)
			ON CONFLICT (message_id, user_id, emoji) DO NOTHING
			`,
			[messageId, actor.userId, emoji],
		);
		return this.#reactionsFor(message.id, actor.userId);
	}

	async removeReaction(
		messageId: string,
		actor: ChatActor,
		emoji: string,
	): Promise<AthenaChatReactionCount[]> {
		const message = await this.#requireMessageAccess(messageId, actor);
		await this.database.query(
			`
			DELETE FROM athena.chat_message_reactions
			WHERE message_id = $1 AND user_id = $2 AND emoji = $3
			`,
			[messageId, actor.userId, emoji],
		);
		return this.#reactionsFor(message.id, actor.userId);
	}

	async search(
		actor: ChatActor,
		input: { query: string; room_id?: string | null; limit?: number | null },
	): Promise<{ message: AthenaChatMessage; room_id: string }[]> {
		const query = input.query.trim();
		if (!query) {
			throw chatBadRequest("Search query is required.");
		}
		const limit = input.limit ?? 20;
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
				AND ($3::uuid IS NULL OR m.room_id = $3)
				AND COALESCE(m.body_text, '') ILIKE '%' || $4 || '%'
			ORDER BY m.created_at DESC
			LIMIT $5
			`,
			[actor.organizationId, actor.userId, input.room_id ?? null, query, limit],
		);
		const hits: { message: AthenaChatMessage; room_id: string }[] = [];
		for (const row of result.rows) {
			const message = await this.#hydrateMessage(row, actor.userId);
			hits.push({ message, room_id: message.room_id });
		}
		return hits;
	}

	async markRead(
		roomId: string,
		actor: ChatActor,
		input?: { message_id?: string | null; seq?: number | null },
	): Promise<{ last_read_message_id?: string | null; last_read_seq: number }> {
		const member = await this.requireMember(roomId, actor, true);
		let seq = input?.seq ?? member.last_read_seq;
		let messageId = input?.message_id ?? member.last_read_message_id ?? null;
		if (input?.message_id) {
			const existing = await this.database.query<MessageRow>(
				"SELECT id, room_seq FROM athena.chat_messages WHERE id = $1 AND room_id = $2",
				[input.message_id, roomId],
			);
			const row = existing.rows[0];
			if (!row) {
				throw chatNotFound("Chat message not found.");
			}
			seq = asNumber(row.room_seq);
			messageId = asString(row.id);
		}
		await this.database.query(
			`
			UPDATE athena.chat_room_members
			SET last_read_seq = $3,
				last_read_message_id = $4
			WHERE room_id = $1 AND user_id = $2
			`,
			[roomId, actor.userId, seq, messageId],
		);
		return {
			last_read_message_id: messageId,
			last_read_seq: seq,
		};
	}

	async #lockRoom(
		roomId: string,
		actor: ChatActor,
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
			[roomId, actor.userId],
		);
		const row = result.rows[0];
		if (!row || asString(row.organization_id) !== actor.organizationId) {
			throw chatNotFound("Chat room not found.");
		}
		if (!row.user_id || row.hidden_at) {
			throw chatForbidden("Not a member of this chat room.");
		}
		return {
			archived_at: asNullableString(row.archived_at),
			last_message_seq: asNumber(row.last_message_seq),
		};
	}

	async #putMember(roomId: string, userId: string, role: AthenaChatMemberRole): Promise<void> {
		await this.database.query(
			`
			INSERT INTO athena.chat_room_members
				(room_id, user_id, role, last_read_seq, muted)
			VALUES
				($1, $2, $3, 0, false)
			ON CONFLICT (room_id, user_id) DO UPDATE
			SET hidden_at = NULL,
				role = EXCLUDED.role
			`,
			[roomId, userId, role],
		);
	}

	async #insertAttachments(
		messageId: string,
		attachments: AthenaChatAttachmentInput[],
	): Promise<void> {
		for (const attachment of attachments) {
			await this.database.query(
				`
				INSERT INTO athena.files (id)
				VALUES ($1)
				ON CONFLICT (id) DO NOTHING
				`,
				[attachment.file_id],
			);
			await this.database.query(
				`
				INSERT INTO athena.chat_message_attachments (message_id, file_id, ordinal)
				VALUES ($1, $2, $3)
				`,
				[messageId, attachment.file_id, attachment.ordinal],
			);
		}
	}

	async #insertOutbox(
		aggregateType: "chat_message" | "chat_room" | "read_cursor",
		aggregateId: string,
		roomId: string,
		roomSeq: number | null,
		eventType: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		await this.database.query(
			`
			INSERT INTO athena.chat_outbox
				(id, aggregate_type, aggregate_id, room_id, room_seq, event_type, payload_json)
			VALUES
				($1, $2, $3, $4, $5, $6, $7)
			`,
			[randomUUID(), aggregateType, aggregateId, roomId, roomSeq, eventType, payload],
		);
	}

	async #requireMessageAccess(messageId: string, actor: ChatActor): Promise<AthenaChatMessage> {
		const result = await this.database.query<MessageRow>(
			`
			SELECT m.*
			FROM athena.chat_messages AS m
			INNER JOIN athena.chat_rooms AS r ON r.id = m.room_id
			WHERE m.id = $1 AND m.deleted_at IS NULL AND r.organization_id = $2
			`,
			[messageId, actor.organizationId],
		);
		const row = result.rows[0];
		if (!row) {
			throw chatNotFound("Chat message not found.");
		}
		await this.requireMember(asString(row.room_id), actor);
		return this.#hydrateMessage(row, actor.userId);
	}

	async #hydrateMessage(row: MessageRow, actorId: string): Promise<AthenaChatMessage> {
		const messageId = asString(row.id);
		const attachments = await this.#attachmentsFor(messageId);
		const reactions = await this.#reactionsFor(messageId, actorId);
		return mapMessage(row, attachments, reactions);
	}

	async #attachmentsFor(messageId: string): Promise<AthenaChatAttachmentView[]> {
		const result = await this.database.query<RoomRow>(
			`
			SELECT a.file_id, a.ordinal, f.file_name, f.original_name, f.content_type,
				f.mime_type, f.extension, f.size_bytes, f.status, f.visibility, f.url,
				f.bucket, f.storage_key
			FROM athena.chat_message_attachments AS a
			LEFT JOIN athena.files AS f ON f.id = a.file_id
			WHERE a.message_id = $1
			ORDER BY a.ordinal
			`,
			[messageId],
		);
		return result.rows.map((row) => ({
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
		}));
	}

	async #reactionsFor(messageId: string, actorId: string): Promise<AthenaChatReactionCount[]> {
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
			[messageId, actorId],
		);
		return result.rows.map((row) => ({
			count: asNumber(row.count),
			emoji: asString(row.emoji),
			reacted: row.reacted === true,
		}));
	}
}

export function createPostgresChatStore(database: AthenaChatDatabase): PostgresChatStore {
	return new PostgresChatStore(database);
}
