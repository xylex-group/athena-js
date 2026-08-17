/**
 * Gateway admin HTTP helpers for the athena-js CLI.
 *
 * Targets static-admin-key routes:
 * - `GET/POST /admin/api-keys`
 * - `GET/POST /admin/api-key-rights`
 * - `GET /admin/rights/catalog`
 *
 * Auth: `X-Athena-Key` with `ATHENA_KEY_12` / `ATHENA_P12_KEY` / `ATHENA_ADMIN_KEY`
 * (same gate as other Athena admin surfaces). This is **not** the runtime
 * gateway app key (`ATHENA_API_KEY`) and not Auth `POST /api-key/create`.
 */

import { normalizeAthenaGatewayBaseUrl } from "../gateway/url.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import { loadProjectEnv } from "./project-env.ts";

export const ADMIN_KEY_ENV_KEYS = [
  "ATHENA_KEY_12",
  "ATHENA_P12_KEY",
  "ATHENA_ADMIN_KEY",
] as const;

export const ADMIN_URL_ENV_KEYS = [
  "ATHENA_URL",
  "ATHENA_GATEWAY_URL",
  "ATHENA_GENERATOR_URL",
  "NEXT_PUBLIC_ATHENA_URL",
] as const;

export class GatewayAdminError extends Error {
  readonly body: unknown;
  readonly endpoint: string;
  readonly method: string;
  readonly status: number;

  constructor(input: {
    body: unknown;
    endpoint: string;
    message: string;
    method: string;
    status: number;
  }) {
    super(input.message);
    this.name = "GatewayAdminError";
    this.body = input.body;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.status = input.status;
  }
}

export interface GatewayAdminCredentials {
  adminKey: string;
  adminKeySource: string;
  baseUrl: string;
  urlSource: string;
}

export interface ResolveGatewayAdminOptions {
  adminKey?: string;
  baseUrl?: string;
  cwd?: string;
  processEnv?: Record<string, string | undefined>;
}

function pickEnv(
  values: Map<string, { value: string; sourceKey: string }>,
  keys: readonly string[]
): { sourceKey: string; value: string } | undefined {
  for (const key of keys) {
    const hit = values.get(key);
    if (hit?.value) {
      return { sourceKey: key, value: hit.value };
    }
  }
  return undefined;
}

/**
 * Resolve gateway base URL + static admin key from flags / project env / process.
 */
export function resolveGatewayAdminCredentials(
  options: ResolveGatewayAdminOptions = {}
): GatewayAdminCredentials {
  const loaded = loadProjectEnv({
    cwd: options.cwd,
    processEnv: options.processEnv,
  });

  const values = new Map<string, { sourceKey: string; value: string }>();
  for (const [key, entry] of loaded.values.entries()) {
    values.set(key, { sourceKey: entry.sourceKey, value: entry.value });
  }

  const urlHit = options.baseUrl?.trim()
    ? { sourceKey: "--url", value: options.baseUrl.trim() }
    : pickEnv(values, ADMIN_URL_ENV_KEYS);

  const keyHit = options.adminKey?.trim()
    ? { sourceKey: "--admin-key", value: options.adminKey.trim() }
    : pickEnv(values, ADMIN_KEY_ENV_KEYS);

  if (!urlHit) {
    throw new Error(
      `Missing Athena gateway URL. Set ${ADMIN_URL_ENV_KEYS[0]} (or pass --url).`
    );
  }
  if (!keyHit) {
    throw new Error(
      `Missing static admin key. Set ${ADMIN_KEY_ENV_KEYS.join(" / ")} (or pass --admin-key). ` +
        "This is the server admin secret (ATHENA_KEY_12), not ATHENA_API_KEY."
    );
  }

  const baseUrl = normalizeAthenaGatewayBaseUrl(urlHit.value, {
    label: "Athena gateway URL",
  }).replace(/\/+$/, "");

  return {
    adminKey: keyHit.value,
    adminKeySource: keyHit.sourceKey,
    baseUrl,
    urlSource: urlHit.sourceKey,
  };
}

export interface GatewayAdminClientOptions extends GatewayAdminCredentials {
  fetchImpl?: typeof fetch;
}

export interface GatewayApiKeyRecord {
  client_name?: string | null;
  created_at?: string;
  description?: string | null;
  expires_at?: string | null;
  id?: string;
  is_active?: boolean;
  last_used_at?: string | null;
  name?: string;
  public_id?: string;
  rights?: string[];
  updated_at?: string;
}

export interface GatewayApiKeyRightRecord {
  created_at?: string;
  description?: string | null;
  id?: string;
  name: string;
  updated_at?: string;
}

export interface CreateGatewayApiKeyInput {
  client_name?: string | null;
  description?: string | null;
  expires_at?: string | null;
  name: string;
  rights?: string[];
}

export interface CreateGatewayApiKeyResult {
  api_key?: string;
  record?: GatewayApiKeyRecord;
  /** Raw envelope when shape differs. */
  raw: unknown;
}

export interface RightsCatalogEntry {
  action?: string;
  description?: string | null;
  id?: string;
  isPattern?: boolean;
  key: string;
  kind?: string;
  resource?: string;
  source?: string;
}

export interface RightsCatalogData {
  apiKeyRightsStatus?: string;
  counts?: {
    dynamicApiKeyRights?: number;
    native?: number;
    total?: number;
  };
  dynamicApiKeyRights?: RightsCatalogEntry[];
  nativeRights?: RightsCatalogEntry[];
  sources?: Record<string, string>;
}

function unwrapData(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }
  const record = body as Record<string, unknown>;
  if ("data" in record) {
    return record.data;
  }
  return body;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as { message?: unknown }).message === "string"
  ) {
    return String((record.error as { message: string }).message);
  }
  return fallback;
}

export async function gatewayAdminRequest(
  options: GatewayAdminClientOptions & {
    body?: unknown;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
  }
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "fetch is not available in this runtime. Use Node.js 18+ or provide fetchImpl."
    );
  }

  const url = `${options.baseUrl}${options.path.startsWith("/") ? "" : "/"}${options.path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `athena-js-cli/${PACKAGE_VERSION}`,
    "X-Athena-Key": options.adminKey,
    apikey: options.adminKey,
  };

  const response = await fetchImpl(url, {
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method,
  });

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new GatewayAdminError({
      body: parsed,
      endpoint: options.path,
      message: extractErrorMessage(
        parsed,
        `Gateway admin ${options.method} ${options.path} failed (${response.status})`
      ),
      method: options.method,
      status: response.status,
    });
  }

  return parsed;
}

export async function listGatewayApiKeys(
  options: GatewayAdminClientOptions
): Promise<GatewayApiKeyRecord[]> {
  const body = await gatewayAdminRequest({
    ...options,
    method: "GET",
    path: "/admin/api-keys",
  });
  const data = unwrapData(body);
  if (Array.isArray(data)) {
    return data as GatewayApiKeyRecord[];
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.api_keys)) {
      return record.api_keys as GatewayApiKeyRecord[];
    }
    if (Array.isArray(record.keys)) {
      return record.keys as GatewayApiKeyRecord[];
    }
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.api_keys)) {
      return record.api_keys as GatewayApiKeyRecord[];
    }
  }
  return [];
}

export async function createGatewayApiKey(
  options: GatewayAdminClientOptions & { input: CreateGatewayApiKeyInput }
): Promise<CreateGatewayApiKeyResult> {
  const body = await gatewayAdminRequest({
    ...options,
    body: {
      client_name: options.input.client_name ?? undefined,
      description: options.input.description ?? undefined,
      expires_at: options.input.expires_at ?? undefined,
      name: options.input.name,
      rights: options.input.rights ?? [],
    },
    method: "POST",
    path: "/admin/api-keys",
  });

  const data = unwrapData(body);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    return {
      api_key:
        typeof record.api_key === "string"
          ? record.api_key
          : typeof record.key === "string"
            ? record.key
            : undefined,
      raw: body,
      record:
        record.record && typeof record.record === "object"
          ? (record.record as GatewayApiKeyRecord)
          : undefined,
    };
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    return {
      api_key:
        typeof record.api_key === "string" ? record.api_key : undefined,
      raw: body,
      record:
        record.record && typeof record.record === "object"
          ? (record.record as GatewayApiKeyRecord)
          : undefined,
    };
  }

  return { raw: body };
}

export async function listGatewayApiKeyRights(
  options: GatewayAdminClientOptions
): Promise<GatewayApiKeyRightRecord[]> {
  const body = await gatewayAdminRequest({
    ...options,
    method: "GET",
    path: "/admin/api-key-rights",
  });
  const data = unwrapData(body);
  if (Array.isArray(data)) {
    return data as GatewayApiKeyRightRecord[];
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.rights)) {
      return record.rights as GatewayApiKeyRightRecord[];
    }
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.rights)) {
      return record.rights as GatewayApiKeyRightRecord[];
    }
  }
  return [];
}

export async function createGatewayApiKeyRight(
  options: GatewayAdminClientOptions & {
    input: { description?: string | null; name: string };
  }
): Promise<GatewayApiKeyRightRecord> {
  const body = await gatewayAdminRequest({
    ...options,
    body: {
      description: options.input.description ?? undefined,
      name: options.input.name,
    },
    method: "POST",
    path: "/admin/api-key-rights",
  });
  const data = unwrapData(body);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (record.right && typeof record.right === "object") {
      return record.right as GatewayApiKeyRightRecord;
    }
    if (typeof record.name === "string") {
      return data as GatewayApiKeyRightRecord;
    }
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (record.right && typeof record.right === "object") {
      return record.right as GatewayApiKeyRightRecord;
    }
  }
  return { name: options.input.name };
}

export async function listGatewayRightsCatalog(
  options: GatewayAdminClientOptions
): Promise<RightsCatalogData> {
  const body = await gatewayAdminRequest({
    ...options,
    method: "GET",
    path: "/admin/rights/catalog",
  });
  const data = unwrapData(body);
  if (data && typeof data === "object") {
    return data as RightsCatalogData;
  }
  return {};
}

export function formatApiKeyRecords(records: GatewayApiKeyRecord[]): string {
  if (records.length === 0) {
    return "No API keys found.";
  }
  const lines = [
    `API keys (${records.length})`,
    "name\tpublic_id\tactive\tclient\trights",
  ];
  for (const row of records) {
    const rights = Array.isArray(row.rights) ? row.rights.join(",") : "-";
    lines.push(
      [
        row.name ?? "-",
        row.public_id ?? row.id ?? "-",
        row.is_active === false ? "no" : "yes",
        row.client_name ?? "-",
        rights || "-",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

export function formatApiKeyRights(
  rights: GatewayApiKeyRightRecord[]
): string {
  if (rights.length === 0) {
    return "No API key rights found in the auth store.";
  }
  const lines = [`API key rights (${rights.length})`, "name\tdescription\tid"];
  for (const right of rights) {
    lines.push(
      [
        right.name,
        right.description?.replace(/\s+/g, " ") ?? "-",
        right.id ?? "-",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

export function formatRightsCatalog(catalog: RightsCatalogData): string {
  const native = catalog.nativeRights ?? [];
  const dynamic = catalog.dynamicApiKeyRights ?? [];
  const lines = [
    "Athena rights catalog",
    `counts: native=${catalog.counts?.native ?? native.length} dynamic=${catalog.counts?.dynamicApiKeyRights ?? dynamic.length} total=${catalog.counts?.total ?? native.length + dynamic.length}`,
    `apiKeyRightsStatus: ${catalog.apiKeyRightsStatus ?? "unknown"}`,
    "",
    `Native rights (${native.length})`,
    "key\tsource\tkind\tpattern\tdescription",
  ];
  for (const entry of native) {
    lines.push(
      [
        entry.key,
        entry.source ?? "-",
        entry.kind ?? "-",
        entry.isPattern ? "yes" : "no",
        (entry.description ?? "-").replace(/\s+/g, " "),
      ].join("\t")
    );
  }
  lines.push("", `Dynamic API key rights (${dynamic.length})`, "key\tsource\tid");
  for (const entry of dynamic) {
    lines.push(
      [entry.key, entry.source ?? "-", entry.id ?? "-"].join("\t")
    );
  }
  return lines.join("\n");
}

export function formatCreatedApiKey(result: CreateGatewayApiKeyResult): string {
  const lines = ["Created gateway API key"];
  if (result.api_key) {
    lines.push(`plaintext (shown once): ${result.api_key}`);
  } else {
    lines.push("plaintext: (not present in response)");
  }
  if (result.record) {
    lines.push(
      `record: name=${result.record.name ?? "-"} public_id=${result.record.public_id ?? result.record.id ?? "-"} client=${result.record.client_name ?? "-"} rights=${(result.record.rights ?? []).join(",") || "-"}`
    );
  }
  lines.push(
    "Store the plaintext secret now — it cannot be retrieved again from the API."
  );
  return lines.join("\n");
}