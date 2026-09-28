import { randomUUID } from "node:crypto";
import type {
  AthenaChatMessage,
  AthenaChatReactionSummary,
  AthenaChatRoom,
  AthenaChatWsServerEvent,
} from "./types.ts";

export type ChatEventPayload =
  | {
      room: AthenaChatRoom;
      type: "chat.room.created";
    }
  | {
      room: AthenaChatRoom;
      type: "chat.room.updated";
    }
  | {
      room: AthenaChatRoom;
      type: "chat.room.archived";
    }
  | {
      message: AthenaChatMessage;
      type: "chat.message.created";
    }
  | {
      message: AthenaChatMessage;
      type: "chat.message.updated";
    }
  | {
      message_id: string;
      type: "chat.message.deleted";
    }
  | {
      type: "chat.members.updated";
      version: number;
    }
  | {
      read_seq: number;
      type: "chat.read.updated";
      user_id: string;
    }
  | {
      summary: AthenaChatReactionSummary;
      type: "chat.reaction.updated";
    };

export interface ChatEventEnvelope {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly payload: ChatEventPayload;
  readonly roomId: string;
  readonly roomSeq: number | null;
  readonly traceId?: string;
}

export interface ChatMutationCommit<T> {
  event?: ChatEventEnvelope;
  value: T;
}

export function createChatEvent(input: {
  payload: ChatEventPayload;
  roomId: string;
  roomSeq?: number | null;
  traceId?: string;
}): ChatEventEnvelope {
  return Object.freeze({
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: Object.freeze(input.payload),
    roomId: input.roomId,
    roomSeq: input.roomSeq ?? null,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  });
}

function eventMetadata(event: ChatEventEnvelope): {
  event_id: string;
  occurred_at: string;
  trace_id?: string;
} {
  return {
    event_id: event.eventId,
    occurred_at: event.occurredAt,
    ...(event.traceId ? { trace_id: event.traceId } : {}),
  };
}

export function chatEventToWsEvent(
  event: ChatEventEnvelope
): AthenaChatWsServerEvent {
  const metadata = eventMetadata(event);
  switch (event.payload.type) {
    case "chat.room.created":
    case "chat.room.updated":
    case "chat.room.archived":
      return {
        ...metadata,
        room: event.payload.room,
        room_id: event.roomId,
        type: event.payload.type,
      };
    case "chat.message.created":
    case "chat.message.updated":
      return {
        ...metadata,
        message: event.payload.message,
        room_id: event.roomId,
        seq: event.roomSeq ?? event.payload.message.room_seq,
        type: event.payload.type,
      };
    case "chat.message.deleted":
      return {
        ...metadata,
        message_id: event.payload.message_id,
        room_id: event.roomId,
        seq: event.roomSeq ?? 0,
        type: event.payload.type,
      };
    case "chat.members.updated":
      return {
        ...metadata,
        room_id: event.roomId,
        seq: event.roomSeq,
        type: event.payload.type,
        version: event.payload.version,
      };
    case "chat.read.updated":
      return {
        ...metadata,
        read_cursor: {
          last_read_seq: event.payload.read_seq,
          room_id: event.roomId,
          user_id: event.payload.user_id,
        },
        read_seq: event.payload.read_seq,
        room_id: event.roomId,
        seq: event.roomSeq ?? event.payload.read_seq,
        user_id: event.payload.user_id,
        type: event.payload.type,
      };
    case "chat.reaction.updated":
      return {
        ...metadata,
        room_id: event.roomId,
        seq: event.roomSeq,
        summary: event.payload.summary,
        type: event.payload.type,
      };
  }
}
