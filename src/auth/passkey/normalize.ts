import { resolvePasskeyAuthenticatorDisplay } from "./metadata/index.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthQueryValue,
  AthenaAuthResult,
  AthenaPasskeyAuthenticationOptions,
  AthenaPasskeyDeviceType,
  AthenaPasskeyRecord,
  AthenaPasskeyRegistrationOptions,
} from "../types.ts";

export function extractPasskeyFetchOptions<
  T extends AthenaAuthFetchCompatibleInput | undefined,
>(input: T) {
  if (!input) {
    return {
      fetchOptions: undefined,
      payload: undefined,
    };
  }

  const { fetchOptions, ...rest } = input;
  const hasPayloadKeys = Object.keys(rest).length > 0;
  return {
    fetchOptions,
    payload: hasPayloadKeys ? rest : undefined,
  };
}

export function extractPasskeyQuery(
  input?: AthenaAuthFetchCompatibleInput
): Record<string, AthenaAuthQueryValue> | undefined {
  const { payload } = extractPasskeyFetchOptions(input);
  const query = (payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined)
    ?.query;
  if (!query || typeof query !== "object") {
    return undefined;
  }
  return query;
}

/** Wire-shape identity — registration options stay `AthenaPasskeyOptionsResponse`. */
export function normalizePasskeyRegistrationOptions(
  value: AthenaPasskeyRegistrationOptions
): AthenaPasskeyRegistrationOptions {
  return value;
}

/** Wire-shape identity — authentication options share the same DTO. */
export function normalizePasskeyAuthenticationOptions(
  value: AthenaPasskeyAuthenticationOptions
): AthenaPasskeyAuthenticationOptions {
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asTransportList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0,
        );
      }
    } catch {
      return [value];
    }
  }
  return [];
}

/**
 * Map embedded or remote wire into the public passkey DTO.
 * Drops publicKey / credentialID / challenge / attestation.
 */
export function normalizePasskeyRecord(
  value: AthenaPasskeyRecord | Record<string, unknown>,
): AthenaPasskeyRecord {
  const record = asRecord(value) ?? {};
  const nested = asRecord(record.authenticator);
  const deviceType: AthenaPasskeyDeviceType =
    nested?.deviceType === "multiDevice" || record.deviceType === "multiDevice"
      ? "multiDevice"
      : "singleDevice";
  const backedUp = Boolean(nested?.backedUp ?? record.backedUp);
  const transports = asTransportList(
    nested?.transports ?? record.transports,
  );
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name
      : record.name === null
        ? null
        : null;
  const residentKey =
    nested?.residentKey === true
      ? true
      : nested?.residentKey === false
        ? false
        : null;
  const resolved = resolvePasskeyAuthenticatorDisplay({
    aaguid: typeof nested?.aaguid === "string" ? nested.aaguid : null,
    backedUp,
    deviceType,
    name,
    residentKey,
    transports,
  });
  const authenticator: AthenaPasskeyRecord["authenticator"] = {
    backedUp,
    deviceType,
    displayName:
      typeof nested?.displayName === "string"
        ? nested.displayName
        : resolved.displayName,
    residentKey,
    transports,
  };
  if (typeof nested?.vendor === "string") {
    authenticator.vendor = nested.vendor;
  } else if (resolved.vendor) {
    authenticator.vendor = resolved.vendor;
  }
  if (typeof nested?.model === "string") {
    authenticator.model = nested.model;
  } else if (resolved.model) {
    authenticator.model = resolved.model;
  }
  const createdAt =
    typeof record.createdAt === "string"
      ? record.createdAt
      : new Date().toISOString();
  const view: AthenaPasskeyRecord = {
    authenticator,
    createdAt,
    id: typeof record.id === "string" ? record.id : "",
    name,
    userId: typeof record.userId === "string" ? record.userId : "",
  };
  if (typeof record.updatedAt === "string") {
    view.updatedAt = record.updatedAt;
  }
  return view;
}

export function normalizePasskeyResult<T>(
  result: AthenaAuthResult<T>
): AthenaAuthResult<T> {
  return result;
}

export function mergePasskeyCallOptions(
  fetchOptions?: AthenaAuthCallOptions,
  options?: AthenaAuthCallOptions
): AthenaAuthCallOptions | undefined {
  if (!fetchOptions) {
    return options;
  }
  if (!options) {
    return fetchOptions;
  }
  return { ...fetchOptions, ...options };
}
