/**
 * Structural Cloudflare binding types used by the edge-local adapter.
 * Avoids a hard dependency on `@cloudflare/workers-types`.
 */

import type { AthenaTransactionCapabilities } from "../db/transaction/types.ts";

export interface D1PreparedStatementLike {
  /**
   * Non-generic statement results keep mock bindings assignable under strict
   * function types. Callers narrow `results` as needed.
   */
  all: () => Promise<D1ResultLike>;
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = Record<string, unknown>>(colName?: string) => Promise<T | null>;
  run: () => Promise<D1ResultLike>;
}

export interface D1ResultLike<T = Record<string, unknown>> {
  error?: string;
  meta?: {
    duration?: number;
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    [key: string]: unknown;
  };
  results?: T[];
  success?: boolean;
}

export interface D1ExecResultLike {
  count: number;
  duration: number;
}

export interface D1SessionLike {
  /**
   * Batch statements. Non-generic return keeps Worker/mocks assignable under
   * strict function types (real D1 is heterogeneous per statement).
   */
  batch: (statements: D1PreparedStatementLike[]) => Promise<D1ResultLike[]>;
  /** Sessions may not expose exec (Wrangler D1DatabaseSession). */
  exec?: (query: string) => Promise<D1ExecResultLike>;
  getBookmark: () => string | null;
  prepare: (query: string) => D1PreparedStatementLike;
}

export interface D1DatabaseLike {
  /**
   * Batch statements. Non-generic return keeps Worker/mocks assignable under
   * strict function types (real D1 is heterogeneous per statement).
   */
  batch: (statements: D1PreparedStatementLike[]) => Promise<D1ResultLike[]>;
  exec: (query: string) => Promise<D1ExecResultLike>;
  prepare: (query: string) => D1PreparedStatementLike;
  withSession?: (constraintOrBookmark: string) => D1SessionLike;
}

export interface R2ObjectBodyLike {
  arrayBuffer: () => Promise<ArrayBuffer>;
  blob: () => Promise<Blob>;
  customMetadata?: Record<string, string>;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: { contentType?: string; [key: string]: unknown };
  json: <T = unknown>() => Promise<T>;
  key: string;
  size: number;
  text: () => Promise<string>;
  uploaded?: Date;
}

export interface R2ObjectsListLike {
  cursor?: string;
  delimitedPrefixes?: string[];
  objects: Array<{
    key: string;
    size: number;
    etag?: string;
    uploaded?: Date;
  }>;
  truncated: boolean;
}

export interface R2BucketLike {
  delete: (keys: string | string[]) => Promise<void>;
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  list: (options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }) => Promise<R2ObjectsListLike>;
  put: (
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
    options?: {
      httpMetadata?: { contentType?: string; [key: string]: unknown };
      customMetadata?: Record<string, string>;
    }
  ) => Promise<unknown>;
}

export type AthenaClientCapabilitiesMode = "gateway" | "cloudflare-edge";

export interface AthenaDbLayerCapabilities {
  findManyAst: boolean;
  flatCrud: boolean;
  query: boolean;
  relations: boolean;
  rpc: boolean;
}

export interface AthenaDbCapabilities {
  engine: "postgresql" | "cloudflare-d1" | "unknown";
  layers: AthenaDbLayerCapabilities;
  local: boolean;
  transactions: AthenaTransactionCapabilities;
}

export interface AthenaStorageCapabilities {
  backups: boolean;
  catalogs: boolean;
  local: boolean;
  objects: boolean;
}

export interface AthenaAuthCapabilities {
  remote: boolean;
}

export interface AthenaClientCapabilities {
  auth: AthenaAuthCapabilities;
  db: AthenaDbCapabilities;
  mode: AthenaClientCapabilitiesMode;
  storage: AthenaStorageCapabilities;
}

export const CLOUDFLARE_EDGE_BASE_URL = "https://athena.local/cloudflare-edge";
export const CLOUDFLARE_EDGE_API_KEY = "cloudflare-edge-local";
