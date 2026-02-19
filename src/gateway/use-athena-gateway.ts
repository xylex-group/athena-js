import { useCallback, useMemo, useState } from "react";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallLog,
  AthenaGatewayCallOptions,
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayResponse,
  AthenaGatewayResponseLog,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "./types.js";
import { createAthenaGatewayClient } from "./client.js";

export function useAthenaGateway(
  config?: AthenaGatewayHookConfig,
): AthenaGatewayHookResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<AthenaGatewayCallLog | null>(
    null,
  );
  const [lastResponse, setLastResponse] =
    useState<AthenaGatewayResponseLog | null>(null);

  const client = useMemo(
    () =>
      createAthenaGatewayClient({
        client: config?.client,
        baseUrl: config?.baseUrl,
        apiKey: config?.apiKey,
        supabaseUrl: config?.supabaseUrl,
        supabaseKey: config?.supabaseKey,
        publishEvent: config?.publishEvent,
        stripNulls: config?.stripNulls,
        headers: config?.headers,
        userId: config?.userId,
        companyId: config?.companyId,
        organizationId: config?.organizationId,
      }),
    [
      config?.baseUrl,
      config?.client,
      config?.apiKey,
      config?.supabaseUrl,
      config?.supabaseKey,
      config?.publishEvent,
      config?.stripNulls,
      config?.headers,
      config?.userId,
      config?.companyId,
      config?.organizationId,
    ],
  );

  const callWithLifecycle = useCallback(
    async <T>(
      fn: () => Promise<AthenaGatewayResponse<T>>,
      metadata: {
        endpoint: string;
        method: string;
        payload: unknown;
        options?: AthenaGatewayCallOptions;
      },
    ): Promise<AthenaGatewayResponse<T>> => {
      const requestLog: AthenaGatewayCallLog = {
        endpoint: metadata.endpoint as any,
        method: metadata.method as any,
        payload: metadata.payload,
        headers: client.buildHeaders(metadata.options),
        timestamp: new Date().toISOString(),
      };

      setLastRequest(requestLog);
      setIsLoading(true);
      setError(null);

      let response: AthenaGatewayResponse<T> | undefined;
      try {
        response = await fn();
        setLastResponse({ ...response, timestamp: new Date().toISOString() });

        if (!response.ok) {
          const message =
            response.error ||
            `Athena gateway ${metadata.method} ${metadata.endpoint} failed`;
          setError(message);
          throw new Error(message);
        }

        return response;
      } catch (callError) {
        const message =
          callError instanceof Error ? callError.message : String(callError);
        setError(message);
        setLastResponse({
          timestamp: new Date().toISOString(),
          status: response?.status ?? 0,
          ok: false,
          data: null,
          raw: null,
          error: message,
        });
        throw callError;
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const normalizedConfigStripNulls = useMemo(
    () => config?.stripNulls ?? true,
    [config?.stripNulls],
  );

  const fetchGateway = useCallback(
    <T = unknown>(
      payload: AthenaFetchPayload,
      options?: AthenaGatewayCallOptions,
    ) => {
      const normalizedPayload: AthenaFetchPayload = {
        ...payload,
        conditions: payload.conditions ?? [],
        strip_nulls:
          payload.strip_nulls ??
          options?.stripNulls ??
          normalizedConfigStripNulls,
      };
      return callWithLifecycle<T>(
        () => client.fetchGateway<T>(normalizedPayload, options),
        {
          endpoint: "/gateway/fetch",
          method: "POST",
          payload: normalizedPayload,
          options,
        },
      );
    },
    [callWithLifecycle, client, normalizedConfigStripNulls],
  );

  const insertGateway = useCallback(
    <T = unknown>(
      payload: AthenaInsertPayload,
      options?: AthenaGatewayCallOptions,
    ) =>
      callWithLifecycle<T>(() => client.insertGateway<T>(payload, options), {
        endpoint: "/gateway/insert",
        method: "PUT",
        payload,
        options,
      }),
    [callWithLifecycle, client],
  );

  const updateGateway = useCallback(
    <T = unknown>(
      payload: AthenaUpdatePayload,
      options?: AthenaGatewayCallOptions,
    ) => {
      const normalizedPayload: AthenaUpdatePayload = {
        ...payload,
        conditions: payload.conditions ?? [],
        strip_nulls:
          payload.strip_nulls ??
          options?.stripNulls ??
          normalizedConfigStripNulls,
      };
      return callWithLifecycle<T>(
        () => client.updateGateway<T>(normalizedPayload, options),
        {
          endpoint: "/gateway/update",
          method: "POST",
          payload: normalizedPayload,
          options,
        },
      );
    },
    [callWithLifecycle, client, normalizedConfigStripNulls],
  );

  const deleteGateway = useCallback(
    <T = unknown>(
      payload: AthenaDeletePayload,
      options?: AthenaGatewayCallOptions,
    ) => {
      if (!payload.resource_id) {
        throw new Error(
          "deleteGateway requires resource_id (the unique identifier of the record to delete)",
        );
      }
      return callWithLifecycle<T>(
        () => client.deleteGateway<T>(payload, options),
        { endpoint: "/gateway/delete", method: "DELETE", payload, options },
      );
    },
    [callWithLifecycle, client],
  );

  return {
    fetchGateway,
    insertGateway,
    updateGateway,
    deleteGateway,
    isLoading,
    error,
    lastRequest,
    lastResponse,
    baseUrl: client.baseUrl,
  };
}
