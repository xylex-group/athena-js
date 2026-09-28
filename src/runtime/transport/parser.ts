import type { AthenaRuntimeDiscoveryDocument } from "../../gateway/discovery-types.ts";
import type { AthenaTransportDomain } from "./domain.ts";
import type { AthenaHttpTransportIR } from "./http/ir.ts";
import type { AthenaRuntimeTopologyIR } from "./topology.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
}

function parseHttpAdvertisement(
  domain: AthenaTransportDomain,
  value: unknown
): AthenaHttpTransportIR | undefined {
  const record = asRecord(value);
  if (record?.kind !== "http") {
    return;
  }
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!path) {
    return;
  }
  const origin =
    record.origin === "remote" || /^https?:\/\//i.test(path)
      ? "remote"
      : "same-origin";
  const advertisedCredentials =
    record.credentials === "none" || record.credentials === "omit"
      ? "none"
      : record.credentials === "same-origin" || record.credentials === "include"
        ? "same-origin"
        : undefined;
  const credentials =
    advertisedCredentials ?? (origin === "remote" ? "none" : "same-origin");
  return {
    basePath: path,
    credentials,
    domain,
    encoding: "json",
    kind: "http",
    origin,
  };
}

export function parseDiscoveryTransports(
  document: AthenaRuntimeDiscoveryDocument
): AthenaRuntimeTopologyIR | undefined {
  const advertised = document.transports;
  if (!advertised) {
    return;
  }
  const data = parseHttpAdvertisement("data", advertised.data);
  const auth = parseHttpAdvertisement("auth", advertised.auth);
  const storage = parseHttpAdvertisement("storage", advertised.storage);
  const billing = parseHttpAdvertisement("billing", advertised.billing);
  return {
    protocol: document.protocol,
    transports: {
      ...(data ? { data } : {}),
      ...(auth ? { auth } : {}),
      ...(storage ? { storage } : {}),
      ...(billing ? { billing } : {}),
    },
    version: 1,
  };
}
