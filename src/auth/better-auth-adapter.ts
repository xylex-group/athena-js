/**
 * Better Auth compatibility over the canonical Athena Auth API.
 *
 * Product contract remains `createClient().auth` / `AthenaAuthBindings`.
 * Flat methods, frozen-property recovery, and throw-mode belong here — not in
 * Auth UI generic client construction.
 */

type RecordLike = Record<string, unknown>;
type AnyFunction = (...args: unknown[]) => unknown;

const BETTER_AUTH_FLAT_METHOD_PATHS = {
	linkSocial: ["social", "link"],
	listAccounts: ["account", "list"],
	listSessions: ["session", "list"],
	revokeOtherSessions: ["session", "revokeOther"],
	revokeSession: ["session", "revoke"],
	unlinkAccount: ["account", "unlink"],
	updateUser: ["user", "update"],
} as const;

type BetterAuthFlatMethodName = keyof typeof BETTER_AUTH_FLAT_METHOD_PATHS;

export type BetterAuthCompatibilityAdapter<T = unknown> = T;

function asRecord(value: unknown): RecordLike | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as RecordLike;
}

function isFrozenDataProperty(target: object, prop: PropertyKey): boolean {
	const desc = Object.getOwnPropertyDescriptor(target, prop);
	return Boolean(
		desc && !desc.configurable && "value" in desc && desc.writable === false,
	);
}

function resolveNestedFunction(
	root: RecordLike,
	path: readonly string[],
): { owner: RecordLike; fn: AnyFunction } | null {
	let owner: RecordLike = root;

	for (let index = 0; index < path.length - 1; index += 1) {
		const key = path.at(index);
		if (key === undefined) {
			return null;
		}
		const next = asRecord(owner[key]);
		if (!next) {
			return null;
		}
		owner = next;
	}

	const methodName = path.at(-1);
	if (methodName === undefined) {
		return null;
	}
	const fn = owner[methodName];
	if (typeof fn !== "function") {
		return null;
	}

	return { fn: fn as AnyFunction, owner };
}

function installBetterAuthFlatMethods(target: RecordLike) {
	for (const [aliasName, path] of Object.entries(
		BETTER_AUTH_FLAT_METHOD_PATHS,
	) as [BetterAuthFlatMethodName, readonly string[]][]) {
		if (typeof target[aliasName] === "function") {
			continue;
		}

		const resolved = resolveNestedFunction(target, path);
		if (!resolved) {
			continue;
		}

		target[aliasName] = (...args: unknown[]) =>
			resolved.fn.apply(resolved.owner, args);
	}

	if (typeof target.deleteUser !== "function") {
		const user = asRecord(target.user);
		const deleteFn =
			typeof user?.delete === "function" ? (user.delete as AnyFunction) : null;
		const namespace = asRecord(target.deleteUser);

		if (deleteFn) {
			const flatDelete = (...args: unknown[]) => deleteFn.apply(user, args);
			if (namespace) {
				Object.assign(flatDelete, namespace);
			}
			target.deleteUser = flatDelete;
		}
	}
}

function withBetterAuthFlatMethodSurface<T>(client: T): T {
	if (!client || (typeof client !== "object" && typeof client !== "function")) {
		return client;
	}

	const root = client as RecordLike;
	installBetterAuthFlatMethods(root);

	return new Proxy(client as object, {
		get(target, prop, receiver) {
			if (isFrozenDataProperty(target, prop)) {
				return Reflect.get(target, prop, receiver);
			}

			if (
				typeof prop === "string" &&
				prop in BETTER_AUTH_FLAT_METHOD_PATHS &&
				typeof Reflect.get(target, prop, receiver) !== "function"
			) {
				const path =
					BETTER_AUTH_FLAT_METHOD_PATHS[prop as BetterAuthFlatMethodName];
				const resolved = resolveNestedFunction(target as RecordLike, path);
				if (resolved) {
					return (...args: unknown[]) =>
						resolved.fn.apply(resolved.owner, args);
				}
			}

			if (
				prop === "deleteUser" &&
				typeof Reflect.get(target, prop, receiver) !== "function"
			) {
				const user = asRecord((target as RecordLike).user);
				if (typeof user?.delete === "function") {
					return (...args: unknown[]) =>
						(user.delete as AnyFunction).apply(user, args);
				}
			}

			return Reflect.get(target, prop, receiver);
		},
	}) as T;
}

/**
 * Adapt frozen `AthenaAuthBindings` into a Better Auth-shaped surface.
 * Copies frozen namespaces so aliases can be installed.
 */
export function createBetterAuthCompatibilityAdapter<T>(
	authBindings: T,
): BetterAuthCompatibilityAdapter<T> {
	if (!authBindings || typeof authBindings !== "object") {
		return authBindings;
	}

	const mutableBindings = { ...(authBindings as object) } as T;
	return withBetterAuthFlatMethodSurface(mutableBindings);
}
