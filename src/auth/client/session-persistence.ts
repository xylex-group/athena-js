export type AthenaAuthSessionPersistenceOperation = "clear" | "persist";

export interface InternalAuthSessionPersistence {
  clearSession(): Promise<void>;
  persistSessionToken(token: string): Promise<void>;
}

export interface InternalAuthSessionPersistenceAuthority {
  advanceGeneration(): void;
  beginAuthMutation(): void;
  beginSignOutInvalidation(): void;
  clearSession(): Promise<void>;
  clearSessionAtGeneration(generation: number): Promise<void>;
  getGeneration(): number;
  hasActiveAuthMutations(): boolean;
  hasActiveSignOutInvalidations(): boolean;
  persistSessionToken(token: string): Promise<void>;
  persistSessionTokenAtGeneration(
    token: string,
    generation: number
  ): Promise<void>;
  endAuthMutation(): void;
  releaseSignOutInvalidation(): void;
}

export class AthenaAuthSessionPersistenceError extends Error {
  readonly code = "ATHENA_AUTH_SESSION_PERSISTENCE_FAILED";
  readonly operation: AthenaAuthSessionPersistenceOperation;

  constructor(operation: AthenaAuthSessionPersistenceOperation) {
    super(`Failed to ${operation} the durable Auth session.`);
    this.name = "AthenaAuthSessionPersistenceError";
    this.operation = operation;
  }
}

export function createAuthSessionPersistenceAuthority(
  persistence: InternalAuthSessionPersistence | undefined
): InternalAuthSessionPersistenceAuthority | undefined {
  if (!persistence) {
    return;
  }

  let generation = 0;
  let tail = Promise.resolve();
  let activeSignOutInvalidations = 0;
  let activeAuthMutations = 0;

  const enqueue = (
    operation: AthenaAuthSessionPersistenceOperation,
    action: () => Promise<void>,
    expectedGeneration = generation
  ) => {
    const operationGeneration = expectedGeneration;
    const next = tail.then(async () => {
      if (operationGeneration !== generation) {
        return;
      }
      try {
        await action();
      } catch {
        throw new AthenaAuthSessionPersistenceError(operation);
      }
    });
    tail = next.catch(() => undefined);
    return next;
  };

  return {
    advanceGeneration() {
      generation += 1;
    },
    beginAuthMutation() {
      activeAuthMutations += 1;
    },
    beginSignOutInvalidation() {
      activeSignOutInvalidations += 1;
    },
    clearSession() {
      return enqueue("clear", () => persistence.clearSession());
    },
    clearSessionAtGeneration(expectedGeneration) {
      return enqueue("clear", () => persistence.clearSession(), expectedGeneration);
    },
    getGeneration() {
      return generation;
    },
    hasActiveAuthMutations() {
      return activeAuthMutations > 0;
    },
    hasActiveSignOutInvalidations() {
      return activeSignOutInvalidations > 0;
    },
    persistSessionToken(token) {
      return enqueue("persist", () => persistence.persistSessionToken(token));
    },
    persistSessionTokenAtGeneration(token, expectedGeneration) {
      return enqueue(
        "persist",
        () => persistence.persistSessionToken(token),
        expectedGeneration
      );
    },
    endAuthMutation() {
      activeAuthMutations = Math.max(0, activeAuthMutations - 1);
    },
    releaseSignOutInvalidation() {
      activeSignOutInvalidations = Math.max(
        0,
        activeSignOutInvalidations - 1
      );
    },
  };
}

export async function persistAuthSessionToken(
  persistence: InternalAuthSessionPersistence | undefined,
  token: string
): Promise<void> {
  if (!persistence) {
    return;
  }
  try {
    await persistence.persistSessionToken(token);
  } catch {
    throw new AthenaAuthSessionPersistenceError("persist");
  }
}

export async function clearPersistedAuthSession(
  persistence: InternalAuthSessionPersistence | undefined
): Promise<void> {
  if (!persistence) {
    return;
  }
  try {
    await persistence.clearSession();
  } catch {
    throw new AthenaAuthSessionPersistenceError("clear");
  }
}

export function readAuthSessionToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as {
    session?: { token?: unknown };
    token?: unknown;
  };
  if (typeof record.token === "string" && record.token.length > 0) {
    return record.token;
  }
  if (
    record.session &&
    typeof record.session.token === "string" &&
    record.session.token.length > 0
  ) {
    return record.session.token;
  }
}
