import type {
  AthenaAuthCapabilitiesResult,
  AthenaAuthCapabilitiesStore,
} from "../capabilities.ts";
import {
  isCapabilityEnabled,
  isSocialCapabilityEnabled,
} from "../capabilities.ts";
import type {
  AthenaAuthEndpointPath,
  AthenaAuthMethod,
  AthenaAuthResult,
} from "../types.ts";

export function capabilityDisabled(
  feature: string,
  endpoint: AthenaAuthEndpointPath,
  method: AthenaAuthMethod = "POST"
): AthenaAuthResult<never> {
  return {
    data: null,
    error: `${feature} is not enabled on this Athena Auth runtime`,
    errorDetails: {
      code: "ATHENA_AUTH_CAPABILITY_DISABLED",
      endpoint,
      hint: feature,
      message: `${feature} is not enabled on this Athena Auth runtime`,
      method,
      status: 501,
    },
    ok: false,
    raw: {
      error: {
        code: "ATHENA_AUTH_CAPABILITY_DISABLED",
        feature,
        status: 501,
      },
    },
    status: 501,
  };
}

export function gateCapability<T>(
  denied: AthenaAuthResult<never> | null,
  run: () => Promise<AthenaAuthResult<T>>
): Promise<AthenaAuthResult<T>> {
  return denied ? Promise.resolve(denied as AthenaAuthResult<T>) : run();
}

export function denySocial(
  snapshot: AthenaAuthCapabilitiesResult,
  endpoint: AthenaAuthEndpointPath
): AthenaAuthResult<never> | null {
  if (isSocialCapabilityEnabled(snapshot)) {
    return null;
  }
  if (snapshot.status !== "known") {
    return null;
  }
  return capabilityDisabled("social", endpoint);
}

export function denyPasskeys(
  snapshot: AthenaAuthCapabilitiesResult,
  endpoint: AthenaAuthEndpointPath,
  method: AthenaAuthMethod = "POST"
): AthenaAuthResult<never> | null {
  if (
    snapshot.status !== "known" ||
    isCapabilityEnabled(snapshot, "passkeys")
  ) {
    return null;
  }
  return capabilityDisabled("passkeys", endpoint, method);
}

export function createCapabilityGates(store: AthenaAuthCapabilitiesStore) {
  return {
    denyPasskeys(
      endpoint: AthenaAuthEndpointPath,
      method: AthenaAuthMethod = "POST"
    ) {
      return denyPasskeys(store.getSnapshot(), endpoint, method);
    },
    denySocial(endpoint: AthenaAuthEndpointPath) {
      return denySocial(store.getSnapshot(), endpoint);
    },
    gateCapability,
  };
}

export type AuthCapabilityGates = ReturnType<typeof createCapabilityGates>;
