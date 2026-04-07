import { useCallback, useMemo, useState } from "react";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallLog,
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayMethod,
  AthenaGatewayResponse,
  AthenaGatewayResponseLog,
  AthenaInsertPayload,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "./types.js";
import { createAthenaGatewayClient } from "./client.js";
import { AthenaGatewayError } from "./errors.ts";

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
        backend: config?.backend,
        publishEvent: config?.publishEvent,
        headers: config?.headers,
        userId: config?.userId,
        organizationId: config?.organizationId,
      }),
    [
      config?.baseUrl,
      config?.client,
      config?.apiKey,
      config?.backend,
      config?.publishEvent,
      config?.headers,
      config?.userId,
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
        endpoint: metadata.endpoint as AthenaGatewayEndpointPath,
        method: metadata.method as AthenaGatewayMethod,
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
          const failure = AthenaGatewayError.fromResponse(response, {
            endpoint: metadata.endpoint as AthenaGatewayEndpointPath,
            method: metadata.method as AthenaGatewayMethod,
          });
          setError(failure.message);
          throw failure;
        }

        return response;
      } catch (callError) {
        const message =
          callError instanceof Error ? callError.message : String(callError);
        const typedError =
          callError instanceof AthenaGatewayError
            ? callError
            : new AthenaGatewayError({
                code: "UNKNOWN_ERROR",
                message,
                endpoint: metadata.endpoint as AthenaGatewayEndpointPath,
                method: metadata.method as AthenaGatewayMethod,
                cause: message,
              });
        setError(message);
        setLastResponse({
          timestamp: new Date().toISOString(),
          status: typedError.status || response?.status || 0,
          ok: false,
          data: null,
          raw: null,
          error: typedError.message,
          errorDetails: typedError.toDetails(),
        });
        throw typedError;
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const defaultStripNulls = true;

  const fetchGateway = useCallback(
    <T = unknown>(
      payload: AthenaFetchPayload,
      options?: AthenaGatewayCallOptions,
    ) => {
      const normalizedPayload: AthenaFetchPayload = {
        ...payload,
        conditions: payload.conditions ?? [],
        strip_nulls:
          payload.strip_nulls ?? options?.stripNulls ?? defaultStripNulls,
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
    [callWithLifecycle, client],
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
          payload.strip_nulls ?? options?.stripNulls ?? defaultStripNulls,
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
    [callWithLifecycle, client],
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

  const rpcGateway = useCallback(
    <T = unknown>(payload: AthenaRpcPayload, options?: AthenaRpcCallOptions) =>
      callWithLifecycle<T>(() => client.rpcGateway<T>(payload, options), {
        endpoint: options?.get ? `/rpc/${payload.function}` : "/gateway/rpc",
        method: options?.get ? "GET" : "POST",
        payload,
        options,
      }),
    [callWithLifecycle, client],
  );

  return {
    fetchGateway,
    insertGateway,
    updateGateway,
    deleteGateway,
    rpcGateway,
    isLoading,
    error,
    lastRequest,
    lastResponse,
    baseUrl: client.baseUrl,
  };
}
