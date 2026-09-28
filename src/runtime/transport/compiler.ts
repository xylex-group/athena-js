import type { AthenaRuntimeDiscoveryDocument } from "../../gateway/discovery-types.ts";
import { ATHENA_AUTH_PATH } from "../../utils/athena-auth-url.ts";
import type { AthenaTransportDomain } from "./domain.ts";
import type {
  AthenaHttpCredentialsMode,
  AthenaHttpOriginMode,
  AthenaHttpTransportIR,
} from "./http/ir.ts";
import { parseDiscoveryTransports } from "./parser.ts";
import type { AthenaRuntimeTopologyIR } from "./topology.ts";

function httpTransport(
  domain: AthenaTransportDomain,
  path: string,
  origin?: AthenaHttpOriginMode
): AthenaHttpTransportIR {
  const trimmed = path.trim();
  const resolvedOrigin: AthenaHttpOriginMode =
    origin ?? (/^https?:\/\//i.test(trimmed) ? "remote" : "same-origin");
  const credentials: AthenaHttpCredentialsMode =
    resolvedOrigin === "remote" ? "none" : "same-origin";
  return {
    basePath: trimmed,
    credentials,
    domain,
    encoding: "json",
    kind: "http",
    origin: resolvedOrigin,
  };
}

function authAvailable(
  document: AthenaRuntimeDiscoveryDocument
): { origin: AthenaHttpOriginMode; path: string } | undefined {
  const authCap = document.capabilities.auth;
  const authObject =
    authCap && typeof authCap === "object" ? authCap : undefined;
  const advertised =
    document.runtime === "next-local" &&
    authObject?.available === true &&
    (authObject.transport === "same-origin" ||
      authObject.transport === "remote" ||
      authObject.transport === undefined);
  if (!advertised) {
    return;
  }
  const endpoint = document.endpoints?.auth;
  const path =
    typeof endpoint === "string" && endpoint.trim()
      ? endpoint.trim()
      : ATHENA_AUTH_PATH;
  return {
    origin: authObject.transport === "remote" ? "remote" : "same-origin",
    path,
  };
}

function compileLegacyDiscovery(
  document: AthenaRuntimeDiscoveryDocument
): AthenaRuntimeTopologyIR {
  const dataPath = document.endpoints?.data?.trim() || "/api/athena";
  const auth = authAvailable(document);
  const storagePath = document.endpoints?.storage?.trim();
  const billingPath = document.endpoints?.billing?.trim();
  const storageOn =
    document.capabilities.storage === true && Boolean(storagePath);
  const billingOn =
    document.capabilities.billing === true && Boolean(billingPath);
  return {
    protocol: document.protocol,
    transports: {
      data: httpTransport("data", dataPath),
      ...(auth ? { auth: httpTransport("auth", auth.path, auth.origin) } : {}),
      ...(storageOn && storagePath
        ? { storage: httpTransport("storage", storagePath) }
        : {}),
      ...(billingOn && billingPath
        ? { billing: httpTransport("billing", billingPath) }
        : {}),
    },
    version: 1,
  };
}

export function compileDiscoveryToTransportTopology(
  document: AthenaRuntimeDiscoveryDocument
): AthenaRuntimeTopologyIR {
  return parseDiscoveryTransports(document) ?? compileLegacyDiscovery(document);
}
