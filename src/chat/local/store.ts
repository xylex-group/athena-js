import { randomUUID } from "node:crypto";
import type {
	AthenaChatAttachmentInput,
	AthenaChatMember,
	AthenaChatMemberRole,
	AthenaChatMessage,
	AthenaChatReactionCount,
	AthenaChatRoom,
	AthenaChatRoomKind,
} from "../types.ts";
import type { ChatActor } from "./principal.ts";
import { chatBadRequest, chatConflict, chatForbidden, chatNotFound } from "./errors.ts";

export type ChatEventKind = "chat.message.created" | "chat.message.updated";

export type ChatDomainEvent = {
	kind: ChatEventKind;
	message: AthenaChatMessage;
	roomId: string;
	roomSeq: number;
};

type StoredMember = AthenaChatMember;
type StoredRoom = AthenaChatRoom;
type StoredMessage = AthenaChatMessage;
type StoredReaction = { emoji: string; messageId: string; userId: string };

export type ChatSnapshot = {
	directs: Map<string, string>;
	members: Map<string, StoredMember>;
	messages: Map<string, StoredMessage>;
	reactions: StoredReaction[];
	rooms: Map<string, StoredRoom>;
};

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
			]),
		),
		reactions: state.reactions.map((item) => ({ ...item })),
		rooms: new Map(
			[...state.rooms.entries()].map(([id, room]) => [id, { ...room }]),
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
	right: string,
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
	actorId: string,
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
	actorId: string,
): AthenaChatMessage {
	return {
		...message,
		attachments: [...message.attachments],
		reactions: reactionsFor(state, message.id, actorId),
	};
}

export class MemoryChatStore {
	#state: ChatSnapshot = {
		directs: new Map(),
		members: new Map(),
		messages: new Map(),
		reactions: [],
		rooms: new Map(),
	};

	async transaction<T>(fn: (store: MemoryChatStore) => Promise<T>): Promise<T> {
		const previous = cloneSnapshot(this.#state);
		try {
			return await fn(this);
		} catch (error) {
			this.#state = previous;
			throw error;
		}
	}

	requireMember(roomId: string, actor: ChatActor): StoredMember {
		const room = this.#state.rooms.get(roomId);
		if (!room || room.organization_id !== actor.organizationId) {
			throw chatNotFound("Chat room not found.");
		}
		const member = this.#state.members.get(memberKey(roomId, actor.userId));
		if (!member || member.hidden_at) {
			throw chatForbidden("Not a member of this chat room.");
		}
		return member;
	}

	listRooms(actor: ChatActor, includeArchived = false): StoredRoom[] {
		const rooms: StoredRoom[] = [];
		for (const room of this.#state.rooms.values()) {
			if (room.organization_id !== actor.organizationId) {
				continue;
			}
			if (room.archived_at && !includeArchived) {
				continue;
			}
			const member = this.#state.members.get(memberKey(room.id, actor.userId));
			if (!member || member.hidden_at) {
				continue;
			}
			rooms.push({ ...room });
		}
		return rooms.sort((left, right) =>
			(right.last_message_at ?? right.updated_at).localeCompare(
				left.last_message_at ?? left.updated_at,
			),
		);
	}

	getRoom(roomId: string, actor: ChatActor): StoredRoom {
		this.requireMember(roomId, actor);
		const room = this.#state.rooms.get(roomId);
		if (!room) {
			throw chatNotFound("Chat room not found.");
		}
		return { ...room };
	}

	createRoom(
		actor: ChatActor,
		input: { kind: AthenaChatRoomKind; member_user_ids?: string[]; title?: string | null },
	): StoredRoom {
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
		return { ...room };
	}

	resolveDirect(actor: ChatActor, participantUserIds: [string, string]): StoredRoom {
		const [left, right] = participantUserIds;
		if (!left || !right || left === right) {
			throw chatBadRequest("Direct rooms require two distinct participants.");
		}
		if (actor.userId !== left && actor.userId !== right) {
			throw chatForbidden("Caller must be a direct-room participant.");
		}
		const key = canonicalDirectKey(actor.organizationId, left, right);
		const existingId = this.#state.directs.get(key);
		if (existingId) {
			return this.getRoom(existingId, actor);
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
		return { ...room };
	}

	updateRoom(roomId: string, actor: ChatActor, title?: string | null): StoredRoom {
		const member = this.requireMember(roomId, actor);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can update this room.");
		}
		const room = this.#state.rooms.get(roomId);
		if (!room) {
			throw chatNotFound("Chat room not found.");
		}
		room.title = title ?? room.title;
		room.updated_at = nowIso();
		room.version += 1;
		return { ...room };
	}

	archiveRoom(roomId: string, actor: ChatActor): StoredRoom {
		const member = this.requireMember(roomId, actor);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can archive this room.");
		}
		const room = this.#state.rooms.get(roomId);
		if (!room) {
			throw chatNotFound("Chat room not found.");
		}
		room.archived_at = nowIso();
		room.updated_at = room.archived_at;
		room.version += 1;
		return { ...room };
	}

	listMembers(roomId: string, actor: ChatActor): StoredMember[] {
		this.requireMember(roomId, actor);
		return [...this.#state.members.values()]
			.filter((member) => member.room_id === roomId && !member.hidden_at)
			.map((member) => ({ ...member }));
	}

	addMembers(
		roomId: string,
		actor: ChatActor,
		userIds: string[],
		role: AthenaChatMemberRole = "member",
	): StoredMember[] {
		const member = this.requireMember(roomId, actor);
		if (member.role === "member") {
			throw chatForbidden("Only owners and admins can add members.");
		}
		const joinedAt = nowIso();
		for (const userId of userIds) {
			this.#putMember(roomId, userId, role, joinedAt);
		}
		return this.listMembers(roomId, actor);
	}

	removeMember(roomId: string, actor: ChatActor, userId: string): void {
		const member = this.requireMember(roomId, actor);
		if (actor.userId !== userId && member.role === "member") {
			throw chatForbidden("Only owners and admins can remove members.");
		}
		const target = this.#state.members.get(memberKey(roomId, userId));
		if (!target) {
			throw chatNotFound("Chat member not found.");
		}
		target.hidden_at = nowIso();
	}

	listMessages(
		roomId: string,
		actor: ChatActor,
		query?: { after_seq?: number; before_seq?: number; limit?: number },
	): AthenaChatMessage[] {
		this.requireMember(roomId, actor);
		const limit = query?.limit ?? 50;
		let items = [...this.#state.messages.values()].filter(
			(message) => message.room_id === roomId && !message.deleted_at,
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
		return items.slice(-limit).map((message) => hydrateMessage(this.#state, message, actor.userId));
	}

	sendMessage(
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
	): { event: ChatDomainEvent; message: AthenaChatMessage } {
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
		return {
			event: {
				kind: "chat.message.created",
				message: hydrated,
				roomId,
				roomSeq: nextSeq,
			},
			message: hydrated,
		};
	}

	updateMessage(
		roomId: string,
		messageId: string,
		actor: ChatActor,
		input: {
			body_json?: Record<string, unknown> | null;
			body_text?: string | null;
			metadata_json?: Record<string, unknown> | null;
		},
	): { event: ChatDomainEvent; message: AthenaChatMessage } {
		this.requireMember(roomId, actor);
		const message = this.#state.messages.get(messageId);
		if (!message || message.room_id !== roomId || message.deleted_at) {
			throw chatNotFound("Chat message not found.");
		}
		if (message.sender_id !== actor.userId) {
			throw chatForbidden("Only the sender can edit this message.");
		}
		message.body_json = input.body_json ?? message.body_json;
		message.body_text = input.body_text ?? message.body_text;
		message.metadata_json = input.metadata_json ?? message.metadata_json;
		message.edited_at = nowIso();
		const hydrated = hydrateMessage(this.#state, message, actor.userId);
		return {
			event: {
				kind: "chat.message.updated",
				message: hydrated,
				roomId,
				roomSeq: message.room_seq,
			},
			message: hydrated,
		};
	}

	deleteMessage(roomId: string, messageId: string, actor: ChatActor): void {
		this.requireMember(roomId, actor);
		const message = this.#state.messages.get(messageId);
		if (!message || message.room_id !== roomId) {
			throw chatNotFound("Chat message not found.");
		}
		if (message.sender_id !== actor.userId) {
			throw chatForbidden("Only the sender can delete this message.");
		}
		message.deleted_at = nowIso();
	}

	addReaction(messageId: string, actor: ChatActor, emoji: string): AthenaChatReactionCount[] {
		const message = this.#state.messages.get(messageId);
		if (!message || message.deleted_at) {
			throw chatNotFound("Chat message not found.");
		}
		this.requireMember(message.room_id, actor);
		const exists = this.#state.reactions.some(
			(reaction) =>
				reaction.messageId === messageId &&
				reaction.userId === actor.userId &&
				reaction.emoji === emoji,
		);
		if (!exists) {
			this.#state.reactions.push({ emoji, messageId, userId: actor.userId });
		}
		return reactionsFor(this.#state, messageId, actor.userId);
	}

	removeReaction(messageId: string, actor: ChatActor, emoji: string): AthenaChatReactionCount[] {
		const message = this.#state.messages.get(messageId);
		if (!message || message.deleted_at) {
			throw chatNotFound("Chat message not found.");
		}
		this.requireMember(message.room_id, actor);
		this.#state.reactions = this.#state.reactions.filter(
			(reaction) =>
				!(
					reaction.messageId === messageId &&
					reaction.userId === actor.userId &&
					reaction.emoji === emoji
				),
		);
		return reactionsFor(this.#state, messageId, actor.userId);
	}

	search(
		actor: ChatActor,
		input: { query: string; room_id?: string | null; limit?: number | null },
	): { message: AthenaChatMessage; room_id: string }[] {
		const query = input.query.trim();
		if (!query) {
			throw chatBadRequest("Search query is required.");
		}
		const limit = input.limit ?? 20;
		const hits: { message: AthenaChatMessage; room_id: string }[] = [];
		for (const message of this.#state.messages.values()) {
			if (message.deleted_at) {
				continue;
			}
			if (input.room_id && message.room_id !== input.room_id) {
				continue;
			}
			try {
				this.requireMember(message.room_id, actor);
			} catch {
				continue;
			}
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
		return hits;
	}

	markRead(
		roomId: string,
		actor: ChatActor,
		input?: { message_id?: string | null; seq?: number | null },
	): { last_read_message_id?: string | null; last_read_seq: number } {
		const member = this.requireMember(roomId, actor);
		let seq = input?.seq ?? member.last_read_seq;
		let messageId = input?.message_id ?? member.last_read_message_id ?? null;
		if (input?.message_id) {
			const message = this.#state.messages.get(input.message_id);
			if (!message || message.room_id !== roomId) {
				throw chatNotFound("Chat message not found.");
			}
			seq = message.room_seq;
			messageId = message.id;
		}
		member.last_read_seq = seq;
		member.last_read_message_id = messageId;
		return {
			last_read_message_id: member.last_read_message_id,
			last_read_seq: member.last_read_seq,
		};
	}

	#putMember(
		roomId: string,
		userId: string,
		role: AthenaChatMemberRole,
		joinedAt: string,
	): void {
		const key = memberKey(roomId, userId);
		const existing = this.#state.members.get(key);
		if (existing) {
			existing.hidden_at = null;
			existing.role = role;
			return;
		}
		this.#state.members.set(key, {
			joined_at: joinedAt,
			last_read_seq: 0,
			muted: false,
			role,
			room_id: roomId,
			user_id: userId,
		});
	}
}

export function createMemoryChatStore(): MemoryChatStore {
	return new MemoryChatStore();
}
