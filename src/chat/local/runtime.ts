import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaPrincipalResolver } from "../../runtime/data/principal.ts";
import {
  authorizeChatOperation,
  CHAT_AUTHORIZATION_DEFAULT_MODE,
  type ChatOperation,
} from "../authorization.ts";
import { LOCAL_CHAT_CAPABILITIES } from "../capabilities.ts";
import type { ChatMutationCommit } from "../events.ts";
import { emitChatExecutionEvent } from "../observability.ts";
import { createChatRealtimeSession } from "../realtime/session.ts";
import type { AthenaChatRuntime } from "../runtime.ts";
import type {
  AthenaChatCallOptions,
  AthenaChatConnectOptions,
  AthenaChatRealtimeInfoResponse,
} from "../types.ts";
import type { AthenaChatDatabase } from "./database.ts";
import { createChatMutationExecutor } from "./mutation.ts";
import { createPostgresChatStore } from "./postgres-store.ts";
import { resolveChatContext } from "./principal.ts";
import {
  createInProcessRealtimeConnection,
  InProcessChatRealtimeBus,
} from "./realtime.ts";
import type { MemoryChatStore } from "./store.ts";

export interface LocalChatRuntimeDeps {
  authorization?: {
    mode?: "compatibility" | "enforce";
  };
  database?: AthenaChatDatabase;
  resolvePrincipal: AthenaPrincipalResolver;
  store?: MemoryChatStore;
}

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
    "chat"
  );
}

export function createLocalChatRuntime(
  deps: LocalChatRuntimeDeps
): AthenaChatRuntime {
  const store = resolveLocalChatStore(deps);
  const database = deps.database;
  const bus = new InProcessChatRealtimeBus();
  const executeMutation = createChatMutationExecutor(
    deps.authorization?.mode ?? CHAT_AUTHORIZATION_DEFAULT_MODE
  );
  const authorizationMode =
    deps.authorization?.mode ?? CHAT_AUTHORIZATION_DEFAULT_MODE;

  const actorOf = async (options?: AthenaChatCallOptions) => {
    const started = Date.now();
    try {
      return await resolveChatContext(deps.resolvePrincipal, options);
    } catch (error) {
      emitChatExecutionEvent({
        errorPhase: "principal",
        operation: "principal.resolve",
        outcome: "denied",
        principalAuthority: "anonymous",
        totalMs: Date.now() - started,
        traceId: options?.traceId,
        transactionSemantics: "atomic",
      });
      throw error;
    }
  };
  const authorizeRead = (
    context: Awaited<ReturnType<typeof actorOf>>,
    operation: ChatOperation
  ): void => {
    const started = Date.now();
    try {
      authorizeChatOperation(context, operation, authorizationMode);
    } catch (error) {
      emitChatExecutionEvent({
        correlationId: context.correlationId,
        errorPhase: "authorize",
        operation,
        organizationId: context.organizationId,
        outcome: "denied",
        principalAuthority: context.resolvedPrincipal.authority,
        requestId: context.requestId,
        totalMs: Date.now() - started,
        traceId: context.traceId,
        transactionSemantics: "atomic",
      });
      throw error;
    }
    emitChatExecutionEvent({
      correlationId: context.correlationId,
      operation,
      organizationId: context.organizationId,
      outcome: "success",
      principalAuthority: context.resolvedPrincipal.authority,
      requestId: context.requestId,
      totalMs: Date.now() - started,
      traceId: context.traceId,
      transactionSemantics: "atomic",
    });
  };
  const publish = <T>(commit: ChatMutationCommit<T>): void => {
    if (commit.event) {
      bus.publish(commit.event);
    }
  };
  const mutate = <T>(
    context: Awaited<ReturnType<typeof actorOf>>,
    operation: ChatOperation,
    callback: (next: typeof store) => Promise<ChatMutationCommit<T>>
  ) =>
    executeMutation({
      context,
      execute: () => store.transaction(callback),
      operation,
      publish,
    });

  const runtime: AthenaChatRuntime = {
    capabilities: LOCAL_CHAT_CAPABILITIES,
    message: {
      reaction: {
        async add(messageId, input, options) {
          const actor = await actorOf(options);
          const reactions = await mutate(actor, "reactions.write", (next) =>
            Promise.resolve(next.addReaction(messageId, actor, input.emoji))
          );
          return { message_id: messageId, reactions };
        },
        async remove(messageId, emoji, options) {
          const actor = await actorOf(options);
          const reactions = await mutate(actor, "reactions.write", (next) =>
            Promise.resolve(next.removeReaction(messageId, actor, emoji))
          );
          return { message_id: messageId, reactions };
        },
      },
      async search(input, options) {
        const actor = await actorOf(options);
        authorizeRead(actor, "search.read");
        return store.search(actor, input);
      },
    },
    realtime: {
      connect(options?: AthenaChatConnectOptions) {
        return createInProcessRealtimeConnection(bus, options);
      },
      createSession(options) {
        return createChatRealtimeSession(
          {
            async authorize(roomId) {
              const actor = await actorOf();
              authorizeRead(actor, "rooms.read");
              await Promise.resolve(store.requireMember(roomId, actor));
            },
            local: true,
            open(onEvent, onClose) {
              const connection = createInProcessRealtimeConnection(bus, {
                onMessage: (event) => onEvent(event),
              });
              return {
                ...connection,
                close(code, reason) {
                  connection.close(code, reason);
                  onClose();
                },
              };
            },
          },
          options
        );
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
        return mutate(actor, "rooms.admin", async (next) =>
          next.archiveRoom(roomId, actor)
        );
      },
      async create(input, options) {
        const actor = await actorOf(options);
        const data = await mutate(actor, "rooms.write", async (next) =>
          next.createRoom(actor, input)
        );
        return { data, message: "Room created", status: "success" };
      },
      async get(roomId, options) {
        const actor = await actorOf(options);
        authorizeRead(actor, "rooms.read");
        return store.getRoom(roomId, actor);
      },
      async list(query, options) {
        const actor = await actorOf(options);
        authorizeRead(actor, "rooms.read");
        return { items: await store.listRooms(actor, query) };
      },
      member: {
        async add(roomId, input, options) {
          const actor = await actorOf(options);
          return mutate(actor, "members.write", async (next) =>
            next.addMembers(
              roomId,
              actor,
              input.user_ids,
              input.role ?? "member"
            )
          );
        },
        async list(roomId, options) {
          const actor = await actorOf(options);
          authorizeRead(actor, "members.read");
          return store.listMembers(roomId, actor);
        },
        async remove(roomId, userId, options) {
          const actor = await actorOf(options);
          await mutate(actor, "members.write", async (next) =>
            Promise.resolve(next.removeMember(roomId, actor, userId))
          );
          return { ok: true, user_id: userId };
        },
        async updateRole(roomId, userId, role, options) {
          const actor = await actorOf(options);
          return mutate(actor, "members.write", async (next) =>
            next.updateMemberRole(roomId, actor, userId, role)
          );
        },
      },
      message: {
        async delete(roomId, messageId, options) {
          const actor = await actorOf(options);
          await mutate(actor, "messages.delete", async (next) =>
            Promise.resolve(next.deleteMessage(roomId, messageId, actor))
          );
          return { message_id: messageId, ok: true };
        },
        async list(roomId, query, options) {
          const actor = await actorOf(options);
          authorizeRead(actor, "messages.read");
          return store.listMessages(roomId, actor, query);
        },
        async send(roomId, input, options) {
          const actor = await actorOf(options);
          const result = await mutate(actor, "messages.write", async (next) =>
            next.sendMessage(roomId, actor, input)
          );
          return {
            data: result.message,
            message: "Message sent",
            status: "success",
          };
        },
        async update(roomId, messageId, input, options) {
          const actor = await actorOf(options);
          const result = await mutate(actor, "messages.write", async (next) =>
            next.updateMessage(roomId, messageId, actor, input)
          );
          return result.message;
        },
      },
      readCursor: {
        async upTo(roomId, input, options) {
          const actor = await actorOf(options);
          const cursor = await mutate(actor, "read.write", async (next) =>
            next.markRead(roomId, actor, input)
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
        return mutate(actor, "rooms.write", async (next) =>
          next.resolveDirect(actor, input.participant_user_ids)
        );
      },
      async update(roomId, input, options) {
        const actor = await actorOf(options);
        return mutate(actor, "rooms.admin", async (next) =>
          next.updateRoom(roomId, actor, input.title)
        );
      },
    },
  };

  return runtime;
}
