import type {
  AthenaPostgresClient,
  AthenaPostgresPool,
  QueryResult,
  QueryResultRow,
} from "../driver.ts";
import {
  ATHENA_POSTGRES_POOL_DEFAULTS,
  createPostgresPool,
  postgresPoolDiagnostics,
} from "../driver.ts";
import { PostgresDeadline, type PostgresTimeoutPhase } from "./deadline.ts";
import {
  createPostgresLease,
  destroyUnclaimedPostgresClient,
  type PostgresLease,
  type PostgresTarget,
  type PostgresWorkload,
} from "./lease.ts";
import { classifyPostgresClientPoison } from "./poison.ts";

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export interface PostgresAcquireRequest {
  deadline: PostgresDeadline;
  target: PostgresTarget;
  traceId?: string;
  workload: PostgresWorkload;
}

export type PostgresWorkloadCounts = Partial<
  Record<PostgresWorkload, { active: number }>
>;

export type PostgresTimeoutCounts = Partial<
  Record<PostgresTimeoutPhase, number>
>;

export interface PostgresPoolSnapshot {
  acquireP50: number;
  acquireP95: number;
  byWorkload: PostgresWorkloadCounts;
  destroyedConnections: number;
  idleCount: number;
  max: number;
  pendingAcquires: number;
  queueUtilization: number;
  timeoutsByPhase: PostgresTimeoutCounts;
  totalCount: number;
  utilization: number;
  waitingCount: number;
}

export interface PostgresPoolHealth {
  snapshot: PostgresPoolSnapshot;
  status: "healthy" | "saturated";
}

export interface PostgresPoolManager {
  acquire(request: PostgresAcquireRequest): Promise<PostgresLease>;
  close(): Promise<void>;
  closeAll(): Promise<void>;
  getPool(): Promise<AthenaPostgresPool>;
  health(): Promise<PostgresPoolHealth>;
  inspect(): Promise<PostgresPoolSnapshot>;
  query<T extends QueryResultRow = QueryResultRow>(
    request: PostgresAcquireRequest,
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  snapshot(): Promise<PostgresPoolSnapshot>;
}

export class PostgresDeadlineExceededError extends Error {
  readonly code = "ATHENA_POSTGRES_DEADLINE_EXCEEDED";

  constructor(
    readonly phase: PostgresTimeoutPhase,
    readonly elapsedMs: number,
    readonly deadlineMs: number,
    readonly target: PostgresTarget,
    readonly workload: PostgresWorkload
  ) {
    super(
      `PostgreSQL deadline exceeded during ${phase} (${Math.round(elapsedMs)}ms of ${Math.round(deadlineMs)}ms); connection timeout exceeded`
    );
    this.name = "PostgresDeadlineExceededError";
  }
}

export class PostgresAdmissionError extends Error {
  readonly code = "ATHENA_POSTGRES_ADMISSION_REJECTED";

  constructor() {
    super("PostgreSQL admission queue is full");
    this.name = "PostgresAdmissionError";
  }
}

export async function connectPostgresPoolWithDeadline(
  pool: AthenaPostgresPool,
  deadlineMs: number
): Promise<AthenaPostgresClient> {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error("connection timeout exceeded");
  }
  const deadline = PostgresDeadline.after(deadlineMs);
  const request: PostgresAcquireRequest = {
    deadline,
    target: "pooled",
    workload: "query",
  };
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connecting = pool.connect().then((client) => {
    if (timedOut) {
      destroyUnclaimedPostgresClient(client);
      throw deadlineError(request, "acquire");
    }
    return client;
  });
  connecting.catch(() => undefined);
  try {
    return await Promise.race([
      connecting,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(deadlineError(request, "acquire"));
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface CreatePostgresPoolManagerOptions {
  connectionString?: string;
  getPool?: () => Promise<AthenaPostgresPool>;
  maxPendingAcquires?: number;
  ownership?: "owned" | "borrowed";
  pool?: AthenaPostgresPool;
}

const ACQUIRE_SAMPLE_LIMIT = 128;

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

function poolMax(pool: AthenaPostgresPool): number {
  const options = (pool as { options?: { max?: number } }).options;
  const max = options?.max;
  return typeof max === "number" && max > 0
    ? max
    : ATHENA_POSTGRES_POOL_DEFAULTS.max;
}

export function createPostgresPoolManager(
  options: CreatePostgresPoolManagerOptions
): PostgresPoolManager {
  const connectionString = options.connectionString?.trim();
  if (!(options.getPool || options.pool || connectionString)) {
    throw new Error(
      "PostgresPoolManager requires a connection string or an existing pool."
    );
  }
  const maxPendingAcquires = options.maxPendingAcquires ?? 100;
  if (!Number.isInteger(maxPendingAcquires) || maxPendingAcquires < 1) {
    throw new RangeError("maxPendingAcquires must be a positive integer");
  }
  const ownsPool =
    (options.ownership ?? (options.pool ? "borrowed" : "owned")) === "owned";
  let poolPromise: Promise<AthenaPostgresPool> | undefined;
  let resolvedPool: AthenaPostgresPool | undefined;
  let pendingAcquires = 0;
  let closed = false;
  let destroyedConnections = 0;
  const timeoutsByPhase: PostgresTimeoutCounts = {};
  const activeByWorkload: Partial<Record<PostgresWorkload, number>> = {};
  const acquireSamples: number[] = [];

  const noteTimeout = (phase: PostgresTimeoutPhase): void => {
    timeoutsByPhase[phase] = (timeoutsByPhase[phase] ?? 0) + 1;
  };

  const noteDestroy = (): void => {
    destroyedConnections += 1;
  };

  const noteAcquireSample = (durationMs: number): void => {
    acquireSamples.push(durationMs);
    if (acquireSamples.length > ACQUIRE_SAMPLE_LIMIT) {
      acquireSamples.shift();
    }
  };

  const adjustWorkload = (workload: PostgresWorkload, delta: number): void => {
    activeByWorkload[workload] = Math.max(
      0,
      (activeByWorkload[workload] ?? 0) + delta
    );
  };

  const wrapLease = (lease: PostgresLease): PostgresLease => {
    adjustWorkload(lease.workload, 1);
    let settled = false;
    const settleWorkload = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      adjustWorkload(lease.workload, -1);
    };
    return {
      ...lease,
      destroy(reason) {
        if (!settled) {
          noteDestroy();
        }
        settleWorkload();
        lease.destroy(reason);
      },
      release() {
        settleWorkload();
        lease.release();
      },
    };
  };

  const getPool = async (): Promise<AthenaPostgresPool> => {
    if (closed) {
      throw new Error("PostgreSQL pool manager is closed");
    }
    if (options.pool) {
      resolvedPool = options.pool;
      return options.pool;
    }
    if (options.getPool) {
      poolPromise ??= options.getPool().catch((error: unknown) => {
        poolPromise = undefined;
        throw error;
      });
      resolvedPool = await poolPromise;
      return resolvedPool;
    }
    poolPromise ??= createPostgresPool(connectionString as string);
    resolvedPool = await poolPromise;
    return resolvedPool;
  };

  const connectWithDeadline = async (
    pool: AthenaPostgresPool,
    request: PostgresAcquireRequest
  ): Promise<AthenaPostgresClient> => {
    const remainingMs = request.deadline.remainingMs();
    if (remainingMs <= 0) {
      noteTimeout("acquire");
      throw deadlineError(request, "acquire");
    }
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connecting = pool.connect().then((client) => {
      if (timedOut) {
        noteDestroy();
        destroyUnclaimedPostgresClient(client);
        noteTimeout("acquire");
        throw deadlineError(request, "acquire");
      }
      return client;
    });
    connecting.catch(() => undefined);
    try {
      return await Promise.race([
        connecting,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            noteTimeout("acquire");
            reject(deadlineError(request, "acquire"));
          }, remainingMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };

  const acquire = async (
    request: PostgresAcquireRequest
  ): Promise<PostgresLease> => {
    if (closed) {
      throw new Error("PostgreSQL pool manager is closed");
    }
    if (request.deadline.expired()) {
      noteTimeout("queue");
      throw deadlineError(request, "queue");
    }
    if (pendingAcquires >= maxPendingAcquires) {
      throw new PostgresAdmissionError();
    }
    pendingAcquires += 1;
    const startedAt = monotonicNow();
    try {
      const client = await connectWithDeadline(await getPool(), request);
      if (closed) {
        noteDestroy();
        destroyUnclaimedPostgresClient(client);
        throw new Error("PostgreSQL pool manager is closed");
      }
      const durationMs = monotonicNow() - startedAt;
      noteAcquireSample(durationMs);
      return wrapLease(
        createPostgresLease({
          acquireDurationMs: durationMs,
          acquiredAt: Date.now(),
          client,
          target: request.target,
          workload: request.workload,
        })
      );
    } finally {
      pendingAcquires -= 1;
    }
  };

  const inspect = async (): Promise<PostgresPoolSnapshot> => {
    const pool = await getPool();
    const diagnostics = postgresPoolDiagnostics(pool);
    const max = poolMax(pool);
    const byWorkload: PostgresWorkloadCounts = {};
    for (const [workload, active] of Object.entries(activeByWorkload) as [
      PostgresWorkload,
      number,
    ][]) {
      if (active > 0) {
        byWorkload[workload] = { active };
      }
    }
    return {
      acquireP50: percentile(acquireSamples, 0.5),
      acquireP95: percentile(acquireSamples, 0.95),
      byWorkload,
      destroyedConnections,
      idleCount: diagnostics.idleCount,
      max,
      pendingAcquires,
      queueUtilization: pendingAcquires / maxPendingAcquires,
      timeoutsByPhase: { ...timeoutsByPhase },
      totalCount: diagnostics.totalCount,
      utilization: max > 0 ? diagnostics.totalCount / max : 0,
      waitingCount: diagnostics.waitingCount,
    };
  };
  const health = async (): Promise<PostgresPoolHealth> => {
    const snapshot = await inspect();
    const saturated =
      snapshot.waitingCount > 0 ||
      snapshot.queueUtilization >= 1 ||
      (snapshot.utilization >= 1 && snapshot.pendingAcquires > 0);
    return {
      snapshot,
      status: saturated ? "saturated" : "healthy",
    };
  };

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (!ownsPool) {
      return;
    }
    const pool = resolvedPool ?? (await poolPromise?.catch(() => undefined));
    poolPromise = undefined;
    if (pool) {
      await pool.end();
    }
  };

  return {
    acquire,
    close,
    closeAll: close,
    getPool,
    health,
    inspect,
    async query<T extends QueryResultRow = QueryResultRow>(
      request: PostgresAcquireRequest,
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<T>> {
      const lease = await acquire(request);
      let timedOut = false;
      let settled = false;
      let resettingStatementTimeout = false;
      const onTimeout = (error: PostgresDeadlineExceededError): void => {
        timedOut = true;
        noteTimeout("statement");
        lease.destroy(error);
      };
      try {
        if (request.workload === "auth") {
          const timeoutMs = remainingStatementTimeoutMs(request);
          await queryPostgresClientWithDeadline(
            lease.client,
            request,
            `SET statement_timeout = '${timeoutMs}ms'`,
            undefined,
            onTimeout
          );
        }
        const result = await queryPostgresClientWithDeadline<T>(
          lease.client,
          request,
          text,
          values,
          onTimeout
        );
        if (request.workload === "auth") {
          resettingStatementTimeout = true;
          await queryPostgresClientWithDeadline(
            lease.client,
            request,
            "SET statement_timeout = 0",
            undefined,
            onTimeout
          );
        }
        return result;
      } catch (error) {
        if (!timedOut) {
          settled = true;
          if (
            resettingStatementTimeout ||
            classifyPostgresClientPoison(error) === "destroy"
          ) {
            lease.destroy(error);
          } else {
            lease.release();
          }
        }
        throw error;
      } finally {
        if (!(timedOut || settled)) {
          lease.release();
        }
      }
    },
    snapshot: inspect,
  };
}

export async function queryPostgresClientWithDeadline<
  T extends QueryResultRow = QueryResultRow,
>(
  client: AthenaPostgresClient,
  request: PostgresAcquireRequest,
  text: string,
  values?: unknown[],
  onTimeout?: (error: PostgresDeadlineExceededError) => void,
  phase: PostgresTimeoutPhase = "statement"
): Promise<QueryResult<T>> {
  const remainingMs = request.deadline.remainingMs();
  if (remainingMs <= 0) {
    const error = deadlineError(request, phase);
    onTimeout?.(error);
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = client.query<T>(text, values);
  query.catch(() => undefined);
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = deadlineError(request, phase);
          onTimeout?.(error);
          reject(error);
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function remainingStatementTimeoutMs(request: PostgresAcquireRequest): number {
  return Math.max(1, Math.trunc(request.deadline.remainingMs()));
}

function deadlineError(
  request: PostgresAcquireRequest,
  phase: PostgresTimeoutPhase
): PostgresDeadlineExceededError {
  return new PostgresDeadlineExceededError(
    phase,
    request.deadline.elapsedMs(),
    request.deadline.durationMs,
    request.target,
    request.workload
  );
}

export { ATHENA_POSTGRES_POOL_DEFAULTS };
