import type {
	AthenaChatConnectOptions,
	AthenaChatRealtimeConnection,
	AthenaChatResumeRoomCursor,
	AthenaChatWebSocketLike,
	AthenaChatWsClientCommand,
} from "../types.ts";
import { chatCapabilityUnsupported } from "./errors.ts";
import type { ChatDomainEvent } from "./store.ts";

type Subscriber = {
	fromSeq: number;
	onEvent: (event: ChatDomainEvent) => void;
};

export class InProcessChatRealtimeBus {
	readonly #rooms = new Map<string, Set<Subscriber>>();

	publish(event: ChatDomainEvent): void {
		const subscribers = this.#rooms.get(event.roomId);
		if (!subscribers) {
			return;
		}
		for (const subscriber of subscribers) {
			if (event.roomSeq > subscriber.fromSeq) {
				subscriber.onEvent(event);
			}
		}
	}

	subscribe(roomId: string, fromSeq: number, onEvent: (event: ChatDomainEvent) => void): () => void {
		const subscriber: Subscriber = { fromSeq, onEvent };
		const bucket = this.#rooms.get(roomId) ?? new Set<Subscriber>();
		bucket.add(subscriber);
		this.#rooms.set(roomId, bucket);
		return () => {
			bucket.delete(subscriber);
		};
	}
}

class InProcessSocket implements AthenaChatWebSocketLike {
	readyState = 1;
	readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

	addEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void {
		const bucket = this.#listeners.get(type) ?? new Set<(event: unknown) => void>();
		bucket.add(listener);
		this.#listeners.set(type, bucket);
	}

	removeEventListener?(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void {
		this.#listeners.get(type)?.delete(listener);
	}

	send(): void {
		throw chatCapabilityUnsupported("websocket");
	}

	close(code?: number, reason?: string): void {
		this.readyState = 3;
		for (const listener of this.#listeners.get("close") ?? []) {
			listener({ code, reason });
		}
	}

	emit(event: unknown): void {
		for (const listener of this.#listeners.get("message") ?? []) {
			listener({ data: JSON.stringify(event) });
		}
	}
}

export function createInProcessRealtimeConnection(
	bus: InProcessChatRealtimeBus,
	options?: AthenaChatConnectOptions,
): AthenaChatRealtimeConnection {
	const socket = new InProcessSocket();
	const unsubscribers = new Map<string, () => void>();

	const deliver = (event: ChatDomainEvent): void => {
		const payload = {
			message: event.message,
			room_id: event.roomId,
			room_seq: event.roomSeq,
			type: event.kind,
		};
		options?.onMessage?.(payload);
		socket.emit(payload);
	};

	const subscribe = (roomId: string, fromSeq?: number | null): void => {
		unsubscribers.get(roomId)?.();
		unsubscribers.set(
			roomId,
			bus.subscribe(roomId, fromSeq ?? 0, deliver),
		);
	};

	const resume = (rooms: AthenaChatResumeRoomCursor[]): void => {
		// Live cursor only: future in-process events with roomSeq > last_seq.
		// Does not replay persisted outbox/history (replayPersisted: false).
		for (const room of rooms) {
			subscribe(room.room_id, room.last_seq ?? 0);
		}
	};

	const send = (command: AthenaChatWsClientCommand): void => {
		switch (command.type) {
			case "chat.subscribe":
				subscribe(command.room_id, command.from_seq);
				return;
			case "chat.unsubscribe":
				unsubscribers.get(command.room_id)?.();
				unsubscribers.delete(command.room_id);
				return;
			case "chat.resume":
				resume(command.rooms);
				return;
			case "auth.hello":
				throw chatCapabilityUnsupported("hello");
			case "ping":
				throw chatCapabilityUnsupported("ping");
			case "chat.typing.start":
			case "chat.typing.stop":
				throw chatCapabilityUnsupported("typing");
			case "chat.presence.heartbeat":
				throw chatCapabilityUnsupported("presence");
			case "chat.read.up_to":
				throw chatCapabilityUnsupported("readUpTo");
			default:
				throw chatCapabilityUnsupported("websocket");
		}
	};

	return {
		close(code, reason) {
			for (const stop of unsubscribers.values()) {
				stop();
			}
			unsubscribers.clear();
			socket.close(code, reason);
		},
		hello() {
			throw chatCapabilityUnsupported("hello");
		},
		ping() {
			throw chatCapabilityUnsupported("ping");
		},
		presenceHeartbeat() {
			throw chatCapabilityUnsupported("presence");
		},
		readUpTo() {
			throw chatCapabilityUnsupported("readUpTo");
		},
		resume,
		send,
		socket,
		subscribe,
		typingStart() {
			throw chatCapabilityUnsupported("typing");
		},
		typingStop() {
			throw chatCapabilityUnsupported("typing");
		},
		unsubscribe(roomId) {
			unsubscribers.get(roomId)?.();
			unsubscribers.delete(roomId);
		},
	};
}
