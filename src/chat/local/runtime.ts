import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaPrincipalResolver } from "../../runtime/data/principal.ts";
import { LOCAL_CHAT_CAPABILITIES } from "../capabilities.ts";
import type { AthenaChatRuntime } from "../runtime.ts";
import type {
	AthenaChatCallOptions,
	AthenaChatConnectOptions,
	AthenaChatRealtimeInfoResponse,
} from "../types.ts";
import type { AthenaChatDatabase } from "./database.ts";
import { resolveChatActor } from "./principal.ts";
import { createPostgresChatStore } from "./postgres-store.ts";
import {
	createInProcessRealtimeConnection,
	InProcessChatRealtimeBus,
} from "./realtime.ts";
import type { MemoryChatStore } from "./store.ts";

export type LocalChatRuntimeDeps = {
	database?: AthenaChatDatabase;
	resolvePrincipal: AthenaPrincipalResolver;
	store?: MemoryChatStore;
};

function resolveLocalChatStore(deps: LocalChatRuntimeDeps) {
	if (deps.store) {
		return deps.store;
	}
	if (deps.database) {
		return createPostgresChatStore(deps.database);
	}
	throw new AthenaConfigurationError(
		"ATHENA_CHAT_LOCAL_DATABASE_REQUIRED",
		"Local Chat requires a borrowed AthenaChatDatabase or an explicit test store.",
		"chat",
	);
}

export function createLocalChatRuntime(
	deps: LocalChatRuntimeDeps,
): AthenaChatRuntime {
	const store = resolveLocalChatStore(deps);
	const database = deps.database;
	const bus = new InProcessChatRealtimeBus();

	const actorOf = (options?: AthenaChatCallOptions) =>
		resolveChatActor(deps.resolvePrincipal, options);

	const runtime: AthenaChatRuntime = {
		capabilities: LOCAL_CHAT_CAPABILITIES,
		message: {
			reaction: {
				async add(messageId, input, options) {
					const actor = await actorOf(options);
					const reactions = await store.transaction((next) =>
						Promise.resolve(next.addReaction(messageId, actor, input.emoji)),
					);
					return { message_id: messageId, reactions };
				},
				async remove(messageId, emoji, options) {
					const actor = await actorOf(options);
					const reactions = await store.transaction((next) =>
						Promise.resolve(next.removeReaction(messageId, actor, emoji)),
					);
					return { message_id: messageId, reactions };
				},
			},
			async search(input, options) {
				const actor = await actorOf(options);
				const items = await store.search(actor, input);
				return { items };
			},
		},
		realtime: {
			connect(options?: AthenaChatConnectOptions) {
				return createInProcessRealtimeConnection(bus, options);
			},
			async info(): Promise<AthenaChatRealtimeInfoResponse> {
				return {
					data: {
						actions: ["subscribe", "resume"],
						path: database?.ownership ?? "memory",
						transport: "in-process",
					},
					message: "Local Chat realtime is in-process.",
					status: "success",
				};
			},
		},
		room: {
			async archive(roomId, options) {
				const actor = await actorOf(options);
				return store.transaction(async (next) => next.archiveRoom(roomId, actor));
			},
			async create(input, options) {
				const actor = await actorOf(options);
				const data = await store.transaction(async (next) => next.createRoom(actor, input));
				return { data, message: "Room created", status: "success" };
			},
			async get(roomId, options) {
				const actor = await actorOf(options);
				return store.getRoom(roomId, actor);
			},
			async list(query, options) {
				const actor = await actorOf(options);
				return { items: await store.listRooms(actor, query?.include_archived) };
			},
			member: {
				async add(roomId, input, options) {
					const actor = await actorOf(options);
					return store.transaction(async (next) =>
						next.addMembers(roomId, actor, input.user_ids, input.role ?? "member"),
					);
				},
				async list(roomId, options) {
					const actor = await actorOf(options);
					return store.listMembers(roomId, actor);
				},
				async remove(roomId, userId, options) {
					const actor = await actorOf(options);
					await store.transaction(async (next) => {
						await next.removeMember(roomId, actor, userId);
					});
					return { ok: true, user_id: userId };
				},
			},
			message: {
				async delete(roomId, messageId, options) {
					const actor = await actorOf(options);
					await store.transaction(async (next) => {
						await next.deleteMessage(roomId, messageId, actor);
					});
					return { message_id: messageId, ok: true };
				},
				async list(roomId, query, options) {
					const actor = await actorOf(options);
					const items = await store.listMessages(roomId, actor, query);
					return { items };
				},
				async send(roomId, input, options) {
					const actor = await actorOf(options);
					const result = await store.transaction(async (next) =>
						next.sendMessage(roomId, actor, input),
					);
					bus.publish(result.event);
					return { data: result.message, message: "Message sent", status: "success" };
				},
				async update(roomId, messageId, input, options) {
					const actor = await actorOf(options);
					const result = await store.transaction(async (next) =>
						next.updateMessage(roomId, messageId, actor, input),
					);
					bus.publish(result.event);
					return result.message;
				},
			},
			readCursor: {
				async upTo(roomId, input, options) {
					const actor = await actorOf(options);
					const cursor = await store.transaction(async (next) =>
						next.markRead(roomId, actor, input),
					);
					return {
						last_read_message_id: cursor.last_read_message_id,
						last_read_seq: cursor.last_read_seq,
						room_id: roomId,
						user_id: actor.userId,
					};
				},
			},
			async resolveDirect(input, options) {
				const actor = await actorOf(options);
				return store.transaction(async (next) =>
					next.resolveDirect(actor, input.participant_user_ids),
				);
			},
			async update(roomId, input, options) {
				const actor = await actorOf(options);
				return store.transaction(async (next) =>
					next.updateRoom(roomId, actor, input.title),
				);
			},
		},
	};

	return runtime;
}
