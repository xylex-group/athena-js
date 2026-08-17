import {
  type AthenaTableCatalogQueryClient,
  type FetchAthenaTableCatalogOptions,
  fetchAthenaTableCatalog,
  hasAthenaTableSchemaCredentials,
  isAthenaTableSchemaConfig,
} from "./catalog.ts";
import type {
  AthenaTableCatalogResponse,
  AthenaTableSchemaConfig,
} from "./types.ts";

/** Default path for the table schema catalog App Router route. */
export const ATHENA_TABLE_SCHEMA_ROUTE = "/api/tables/schema";

export interface AthenaTableSchemaHandlerOptions
  extends FetchAthenaTableCatalogOptions {
  /**
   * Optional transform after a valid config is parsed (e.g. fill defaults from
   * server env). Return `null` to reject with 400.
   */
  resolveConfig?: (
    config: AthenaTableSchemaConfig,
    request: Request
  ) => AthenaTableSchemaConfig | null | Promise<AthenaTableSchemaConfig | null>;
}

/**
 * Build a JSON `Response` with optional status and headers.
 *
 * @internal
 */
function json(
  body: unknown,
  init?: {
    status?: number;
    headers?: HeadersInit;
  }
): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), {
    headers,
    status: init?.status ?? 200,
  });
}

/**
 * Handle `POST /api/tables/schema` — introspect gateway table metadata.
 *
 * Expected body: `{ "config": AthenaTableSchemaConfig }`.
 *
 * @returns `200` catalog JSON, `400` for invalid config, `500` on failure
 */
export async function handleAthenaTableSchemaPost(
  request: Request,
  options?: AthenaTableSchemaHandlerOptions
): Promise<Response> {
  const payload = (await request.json().catch(() => null)) as {
    config?: unknown;
  } | null;
  let config: AthenaTableSchemaConfig | null = isAthenaTableSchemaConfig(
    payload?.config
  )
    ? payload.config
    : null;

  if (config && options?.resolveConfig) {
    config = await options.resolveConfig(config, request);
  }

  if (!(config && isAthenaTableSchemaConfig(config))) {
    return json(
      {
        error: "The Athena tables showcase config is invalid.",
      },
      { status: 400 }
    );
  }

  if (!hasAthenaTableSchemaCredentials(config)) {
    return json(
      {
        error:
          "Gateway URL, API key, and database are required for schema introspection.",
      },
      { status: 400 }
    );
  }

  try {
    const response: AthenaTableCatalogResponse = await fetchAthenaTableCatalog(
      config,
      {
        client: options?.client,
      }
    );

    return json(response);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Athena schema introspection failed.",
      },
      { status: 500 }
    );
  }
}

/**
 * Create App Router handlers for the table schema catalog route.
 *
 * Drop into a route file with no additional wiring:
 *
 * @example
 * ```ts
 * // app/api/tables/schema/route.ts
 * import { createAthenaTableSchemaHandlers } from '@xylex-group/athena'
 *
 * export const dynamic = 'force-dynamic'
 * export const { POST } = createAthenaTableSchemaHandlers()
 * ```
 *
 * @param options - Optional client injection or config resolution
 * @returns Object with a `POST` route handler
 */
export function createAthenaTableSchemaHandlers(
  options?: AthenaTableSchemaHandlerOptions
) {
  return {
    POST: (request: Request) => handleAthenaTableSchemaPost(request, options),
  };
}

export type { AthenaTableCatalogQueryClient };
