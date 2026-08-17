/**
 * Admin backup surface exposed under `client.storage.backup.*`.
 *
 * Routes live at `/admin/backups*` (admin / elevated key). Archives land in the
 * server-configured S3 or R2 profile (`ATHENA_BACKUP_S3_*` including provider + account_id).
 *
 * HTTP transport is injected from `module.ts` (`callStorageEndpoint`) so backup
 * failures share real {@link AthenaStorageError}, request ids, and `onError`.
 */

import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaGatewayMethod } from "../gateway/types.ts";
import { appendHttpQuery } from "../http/append-query.ts";
import { createAthenaStorageError } from "./errors.ts";
import type {
  AthenaStorageCallOptions,
  AthenaStorageClientConfig,
} from "./module.ts";

export type BackupRecoveryStrategy = "none" | "repair_missing_role_oids";

export interface StorageBackupRecord {
  client_name: string;
  completed_at: string;
  execution_daemon_id?: string | null;
  job_id: number;
  /** Alias of s3_key for convenience */
  key: string;
  label?: string | null;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
}

export interface StorageBackupListPage {
  backups: StorageBackupRecord[];
  next_cursor: string | null;
}

export interface StorageBackupListQuery {
  client_name?: string;
  cursor?: string | null;
  limit?: number;
}

export interface StorageBackupCreateRequest {
  client_name: string;
  label?: string;
  pg_uri?: string;
  recovery_strategy?: BackupRecoveryStrategy;
}

export interface StorageBackupQueuedJob {
  client_name: string;
  job_id: number;
  key?: string;
  status: string;
}

export interface StorageBackupRestoreRequest {
  client_name: string;
  pg_uri?: string;
}

export interface StorageBackupJob {
  client_name?: string | null;
  completed_at?: string | null;
  created_at?: string;
  error_message?: string | null;
  id: number;
  job_type: string;
  label?: string | null;
  progress_pct?: number | null;
  progress_stage?: string | null;
  s3_bucket?: string | null;
  s3_key?: string | null;
  status: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface StorageBackupSchedule {
  client_name: string;
  enabled?: boolean;
  frequency?: string;
  id: number;
  label?: string | null;
  [key: string]: unknown;
}

export interface StorageBackupScheduleCreateRequest {
  client_name: string;
  day_of_month?: number;
  day_of_week?: number;
  enabled?: boolean;
  execution_daemon_id?: string;
  frequency: string;
  label?: string;
  time_of_day?: string;
  [key: string]: unknown;
}

export interface AthenaStorageBackupNamespace {
  /** `POST /admin/backups` — queue a backup job */
  create: (
    input: StorageBackupCreateRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBackupQueuedJob>;
  /** `DELETE /admin/backups/{key}` */
  delete: (key: string, options?: AthenaStorageCallOptions) => Promise<void>;
  /** Build a browser download URL for `GET /admin/backups/{key}/download` */
  downloadUrl: (key: string, options?: { apiKey?: string }) => string;
  jobs: {
    list: (
      query?: { limit?: number; status?: string; client_name?: string },
      options?: AthenaStorageCallOptions
    ) => Promise<StorageBackupJob[]>;
    get: (
      jobId: number | string,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageBackupJob>;
    cancel: (
      jobId: number | string,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    delete: (
      jobId: number | string,
      options?: AthenaStorageCallOptions
    ) => Promise<void>;
    /** Presigned/console open link for the job archive object (S3 or R2) */
    openObjectUrl: (
      jobId: number | string,
      options?: AthenaStorageCallOptions
    ) => Promise<string>;
  };
  /** `GET /admin/backups` */
  list: (
    query?: StorageBackupListQuery,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBackupListPage>;
  /** `POST /admin/backups/{key}/restore` */
  restore: (
    key: string,
    input: StorageBackupRestoreRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBackupQueuedJob>;
  schedules: {
    list: (
      options?: AthenaStorageCallOptions
    ) => Promise<StorageBackupSchedule[]>;
    create: (
      input: StorageBackupScheduleCreateRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageBackupSchedule>;
    update: (
      id: number | string,
      input: Partial<StorageBackupScheduleCreateRequest>,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageBackupSchedule>;
    delete: (
      id: number | string,
      options?: AthenaStorageCallOptions
    ) => Promise<void>;
  };
}

/**
 * Shared JSON caller injected by `createStorageModule` — typically
 * `callStorageEndpoint` with envelope `"raw"`. Avoids a parallel fetch stack
 * and circular imports with `module.ts`.
 */
export type StorageBackupJsonCaller = <T>(
  path: string,
  method: AthenaGatewayMethod,
  payload: unknown | undefined,
  options: AthenaStorageCallOptions | undefined
) => Promise<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function appendQuery(path: string, query?: object): string {
  return appendHttpQuery(path, query, { skipEmptyString: true });
}

/** Soft-unwrap Athena `{ data }` envelopes while accepting raw admin payloads. */
function unwrapAthenaData<T>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function requireKey(key: string, method: AthenaGatewayMethod): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    throw createAthenaStorageError({
      code: "HTTP_ERROR",
      endpoint: "/admin/backups/{key}",
      message: "Backup object key is required",
      method,
      status: 400,
    });
  }
  return trimmed;
}

/**
 * Create the `storage.backup` namespace bound to an Athena gateway client.
 *
 * @param callJson - Shared storage JSON transport (from `callStorageEndpoint`).
 */
export function createStorageBackupModule(
  gateway: AthenaGatewayClient,
  _runtimeOptions: AthenaStorageClientConfig | undefined,
  callJson: StorageBackupJsonCaller
): AthenaStorageBackupNamespace {
  const resolvedBaseUrl = () =>
    String(gateway.baseUrl ?? "").replace(/\/+$/, "");

  /** Product-level unwrap only — HTTP/error path is the injected shared caller. */
  async function callAdminJson<T>(
    path: string,
    method: AthenaGatewayMethod,
    payload: unknown | undefined,
    options: AthenaStorageCallOptions | undefined
  ): Promise<T> {
    const parsed = await callJson<unknown>(path, method, payload, options);
    return unwrapAthenaData<T>(parsed);
  }

  return {
    async create(input, options) {
      const data = await callAdminJson<{
        job_id?: number;
        client_name?: string;
        status?: string;
      }>("/admin/backups", "POST", input, options);
      return {
        client_name: String(data?.client_name ?? input.client_name),
        job_id: Number(data?.job_id ?? 0),
        status: String(data?.status ?? "pending"),
      };
    },

    async delete(key, options) {
      const backupKey = requireKey(key, "DELETE");
      await callAdminJson(
        `/admin/backups/${encodeURIComponent(backupKey)}`,
        "DELETE",
        undefined,
        options
      );
    },

    downloadUrl(key, options) {
      const backupKey = requireKey(key, "GET");
      const base = `${resolvedBaseUrl()}/admin/backups/${encodeURIComponent(backupKey)}/download`;
      return options?.apiKey
        ? `${base}?api_key=${encodeURIComponent(options.apiKey)}`
        : base;
    },

    jobs: {
      async cancel(jobId, options) {
        return callAdminJson(
          `/admin/backups/jobs/${encodeURIComponent(String(jobId))}/cancel`,
          "POST",
          {},
          options
        );
      },
      async delete(jobId, options) {
        await callAdminJson(
          `/admin/backups/jobs/${encodeURIComponent(String(jobId))}`,
          "DELETE",
          undefined,
          options
        );
      },
      async get(jobId, options) {
        return callAdminJson(
          `/admin/backups/jobs/${encodeURIComponent(String(jobId))}`,
          "GET",
          undefined,
          options
        );
      },
      async list(query, options) {
        const path = appendQuery("/admin/backups/jobs", query ?? {});
        const data = await callAdminJson<
          StorageBackupJob[] | { jobs?: StorageBackupJob[] }
        >(path, "GET", undefined, options);
        if (Array.isArray(data)) {
          return data;
        }
        if (isRecord(data) && Array.isArray(data.jobs)) {
          return data.jobs;
        }
        return [];
      },
      async openObjectUrl(jobId, options) {
        const data = await callAdminJson<{ url?: string }>(
          `/admin/backups/jobs/${encodeURIComponent(String(jobId))}/s3-open`,
          "GET",
          undefined,
          options
        );
        return String(data?.url ?? "");
      },
    },
    async list(query, options) {
      const path = appendQuery("/admin/backups", {
        client_name: query?.client_name,
        cursor: query?.cursor ?? undefined,
        limit: query?.limit ?? 10,
      });
      const data = await callAdminJson<{
        backups?: Array<Omit<StorageBackupRecord, "key"> & { key?: string }>;
        next_cursor?: string | null;
      }>(path, "GET", undefined, options);

      const backups = (data?.backups ?? []).map((row) => ({
        ...row,
        key: row.key ?? row.s3_key,
      }));
      return {
        backups,
        next_cursor: data?.next_cursor ?? null,
      };
    },

    async restore(key, input, options) {
      const backupKey = requireKey(key, "POST");
      const path = `/admin/backups/${encodeURIComponent(backupKey)}/restore`;
      const data = await callAdminJson<{
        job_id?: number;
        key?: string;
        client_name?: string;
        status?: string;
      }>(path, "POST", input, options);
      return {
        client_name: String(data?.client_name ?? input.client_name),
        job_id: Number(data?.job_id ?? 0),
        key: String(data?.key ?? backupKey),
        status: String(data?.status ?? "pending"),
      };
    },

    schedules: {
      async create(input, options) {
        return callAdminJson(
          "/admin/backups/schedules",
          "POST",
          input,
          options
        );
      },
      async delete(id, options) {
        await callAdminJson(
          `/admin/backups/schedules/${encodeURIComponent(String(id))}`,
          "DELETE",
          undefined,
          options
        );
      },
      async list(options) {
        const data = await callAdminJson<
          StorageBackupSchedule[] | { schedules?: StorageBackupSchedule[] }
        >("/admin/backups/schedules", "GET", undefined, options);
        if (Array.isArray(data)) {
          return data;
        }
        if (isRecord(data) && Array.isArray(data.schedules)) {
          return data.schedules;
        }
        return [];
      },
      async update(id, input, options) {
        return callAdminJson(
          `/admin/backups/schedules/${encodeURIComponent(String(id))}`,
          "PATCH",
          input,
          options
        );
      },
    },
  };
}
