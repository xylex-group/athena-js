import type { AthenaAuthImplementedDomainEvent } from "./events.ts";
import type {
	AthenaAuthAfterHookPayload,
	AthenaAuthBeforeHookPayload,
	AthenaAuthHookErrorInput,
} from "./types.ts";

type AthenaAuthHooksInput = {
	after?: {
		[K in AthenaAuthImplementedDomainEvent]?: (
			payload: AthenaAuthAfterHookPayload<K>,
		) => void;
	};
	before?: {
		[K in AthenaAuthImplementedDomainEvent]?: (
			payload: AthenaAuthBeforeHookPayload<K>,
		) => void;
	};
	onError?: (input: AthenaAuthHookErrorInput) => void;
};

/**
 * Identity helper so hook callbacks are contextually typed per event.
 * Returning `AthenaAuthHooks` would contextual-type arguments as
 * `handler | handler[]` and make destructured params implicit `any`.
 */
export function defineAthenaAuthHooks<T extends AthenaAuthHooksInput>(
	hooks: T,
): T {
	return hooks;
}
