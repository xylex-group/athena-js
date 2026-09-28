import type {
  AthenaMutationEvent,
  AthenaMutationRequestLog,
  AthenaMutationResultData,
  AthenaMutationState,
  AthenaQueryClientConfig,
  AthenaResponseLike,
  AthenaRuntimeEvent,
  AthenaUnsubscribe,
  QueryKey,
} from "../types.ts";
import {
  normalizeAthenaError,
  normalizeAthenaResult,
  runWithRetry,
  safeSerializeQueryKey,
} from "../utils.ts";
import { shouldUseMemoryCache } from "./query-store.ts";

export interface ExecuteMutationInput<TVariables, TMutationFnData, TData> {
  mutationFn: (
    variables: TVariables
  ) => Promise<TMutationFnData | AthenaResponseLike<TMutationFnData>>;
  mutationKey?: QueryKey;
  mutationKeyToken: string;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: TMutationFnData) => TData;
  variables: TVariables;
}

export interface MutationEntry {
  activeRequestId: number;
  gcTimer?: ReturnType<typeof setTimeout>;
  key: string;
  listeners: Set<() => void>;
  state: AthenaMutationState<unknown, unknown>;
}

export interface MutationStoreHost {
  config: AthenaQueryClientConfig;
  emitEvent(event: AthenaRuntimeEvent): void;
  nextRequestId(): number;
}

export function createInitialMutationState<
  TVariables,
  TData,
>(): AthenaMutationState<TVariables, TData> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    lastResponse: undefined,
    lastVariables: undefined,
    status: "idle",
    updatedAt: undefined,
  };
}

export class MutationStore {
  private readonly entries = new Map<string, MutationEntry>();

  constructor(private readonly host: MutationStoreHost) {}

  token(mutationKey?: QueryKey): string {
    if (mutationKey === undefined || mutationKey === null) {
      return "__mutation__default__";
    }
    return safeSerializeQueryKey(mutationKey as QueryKey);
  }

  ensure(key: string): MutationEntry {
    let entry = this.entries.get(key);
    if (entry) {
      return entry;
    }

    entry = {
      activeRequestId: 0,
      key,
      listeners: new Set(),
      state: createInitialMutationState(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  getState<TVariables = unknown, TData = unknown>(
    key: string
  ): AthenaMutationState<TVariables, TData> {
    return this.ensure(key).state as AthenaMutationState<TVariables, TData>;
  }

  subscribe(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensure(key);
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    entry.listeners.add(listener);
    return () => {
      const current = this.entries.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.scheduleGc(current);
      }
    };
  }

  reset(mutationKey?: QueryKey): void {
    const key = this.token(mutationKey);
    const entry = this.ensure(key);
    entry.activeRequestId = this.host.nextRequestId();
    this.setState(entry, createInitialMutationState(), "mutation_reset");
  }

  async execute<TVariables, TMutationFnData, TData = TMutationFnData>(
    input: ExecuteMutationInput<TVariables, TMutationFnData, TData>
  ): Promise<AthenaMutationResultData<TData>> {
    const entry = this.ensure(input.mutationKeyToken);
    const requestId = this.host.nextRequestId();
    entry.activeRequestId = requestId;

    const startRequestLog: AthenaMutationRequestLog<TVariables> = {
      attempt: 1,
      mutationKey: input.mutationKey,
      mutationKeyToken: input.mutationKeyToken,
      requestId,
      startedAt: Date.now(),
      variables: input.variables,
    };

    this.setState(
      entry,
      {
        ...entry.state,
        error: null,
        isLoading: true,
        lastRequest: startRequestLog,
        lastVariables: input.variables,
        status: "loading",
      },
      "mutation_updated"
    );

    try {
      const result = await runWithRetry(
        async (attempt) => {
          const attemptRequestLog: AthenaMutationRequestLog<TVariables> = {
            ...startRequestLog,
            attempt,
          };

          if (entry.activeRequestId === requestId) {
            this.setState(
              entry,
              {
                ...entry.state,
                isLoading: true,
                lastRequest: attemptRequestLog,
              },
              "mutation_updated"
            );
          }

          const rawResult = await input.mutationFn(input.variables);
          const normalized = normalizeAthenaResult<TMutationFnData, TData>(
            rawResult,
            input.select
          );
          if (normalized.error) {
            throw Object.assign(new Error("athena.mutation.normalized"), {
              __athenaNormalizedError: normalized.error,
              __athenaRaw: normalized.raw,
              __athenaResponse: rawResult,
              __athenaStatus: normalized.status,
            });
          }

          return {
            attempt,
            normalized,
            response: rawResult,
          };
        },
        {
          retry: input.retry,
          retryDelay: input.retryDelay,
        }
      );

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now();
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          attempt: result.attempt,
          endedAt: finishedAt,
        };
        this.setState(
          entry,
          {
            ...entry.state,
            data: result.normalized.data,
            error: null,
            isLoading: false,
            lastRequest: doneRequestLog,
            lastResponse: result.response,
            lastVariables: input.variables,
            status: "success",
            updatedAt: finishedAt,
          },
          "mutation_updated"
        );
      }

      return result.normalized;
    } catch (error) {
      const wrapped =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)
          : undefined;
      const normalizedError = wrapped?.__athenaNormalizedError
        ? (wrapped.__athenaNormalizedError as ReturnType<
            typeof normalizeAthenaError
          >)
        : normalizeAthenaError(error);

      const status =
        typeof wrapped?.__athenaStatus === "number"
          ? (wrapped.__athenaStatus as number)
          : (normalizedError.status ?? 500);
      const raw = wrapped?.__athenaRaw ?? normalizedError.raw ?? null;
      const response = wrapped?.__athenaResponse ?? raw;

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now();
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          attempt:
            entry.state.lastRequest?.requestId === requestId
              ? entry.state.lastRequest.attempt
              : startRequestLog.attempt,
          endedAt: finishedAt,
        };

        this.setState(
          entry,
          {
            ...entry.state,
            error: normalizedError,
            isLoading: false,
            lastRequest: doneRequestLog,
            lastResponse: response,
            lastVariables: input.variables,
            status: "error",
            updatedAt: finishedAt,
          },
          "mutation_updated"
        );
      }

      return {
        data: undefined,
        error: normalizedError,
        raw,
        status,
      };
    }
  }

  private setState(
    entry: MutationEntry,
    state: AthenaMutationState<unknown, unknown>,
    eventType: AthenaMutationEvent["type"]
  ): void {
    entry.state = state;
    for (const listener of entry.listeners) {
      listener();
    }

    this.host.emitEvent({
      key: entry.key,
      state,
      timestamp: Date.now(),
      type: eventType,
    });
  }

  private scheduleGc(entry: MutationEntry): void {
    const gcTime = shouldUseMemoryCache(this.host.config)
      ? Math.max(0, this.host.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.host.config.cache?.gcTime ?? 0);

    entry.gcTimer = setTimeout(() => {
      const current = this.entries.get(entry.key);
      if (!current || current.listeners.size > 0) {
        return;
      }
      this.entries.delete(entry.key);
    }, gcTime);
  }
}
