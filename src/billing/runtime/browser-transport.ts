import { DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT } from "../../runtime/data/discovery-document.ts";
import { executeAthenaHttpTransport } from "../../runtime/transport/http/client.ts";
import type { AthenaHttpTransportIR } from "../../runtime/transport/http/ir.ts";
import { createAthenaHttpTransportIR } from "../../runtime/transport/http.ts";
import type { AthenaRuntimeTopologyIR } from "../../runtime/transport/topology.ts";
import { AthenaBillingError } from "../errors.ts";
import type { BillingExecutionTarget } from "../types.ts";
import type { BillingCapabilities } from "./capabilities.ts";
import { billingErrorFromTransport } from "./http-error.ts";
import type {
  BillingCatalogPort,
  BillingPricePort,
  BillingProductPort,
  BillingRelationPort,
  BillingSelfPort,
} from "./types.ts";

export function resolveBrowserBillingEndpoint(endpoints?: {
  billing?: string;
}): string {
  const advertised = endpoints?.billing?.trim();
  if (!advertised) {
    return DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT;
  }
  if (/^https?:\/\//i.test(advertised)) {
    return DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT;
  }
  return advertised.startsWith("/")
    ? advertised
    : DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT;
}

function billingHttpSuccessData(
  body: unknown,
  enveloped: boolean | undefined
): unknown {
  if (enveloped === false) {
    return;
  }
  if (body === null || Array.isArray(body)) {
    return body;
  }
  if (body && typeof body === "object") {
    const leftover = body as { data?: unknown; ok?: unknown };
    if (typeof leftover.ok === "boolean") {
      return "data" in leftover ? leftover.data : undefined;
    }
  }
  return body;
}

function asExecutorTransport(
  ir: ReturnType<typeof createAthenaHttpTransportIR>
): AthenaHttpTransportIR {
  return {
    basePath: ir.basePath,
    credentials: ir.credentials,
    domain: ir.domain,
    encoding: "json",
    kind: "http",
    origin: ir.origin === "absolute" ? "remote" : ir.origin,
  };
}

function sameOriginBillingTransport(
  advertised: AthenaHttpTransportIR
): AthenaHttpTransportIR | undefined {
  if (advertised.origin !== "same-origin") {
    return;
  }
  if (/^https?:\/\//i.test(advertised.basePath)) {
    return;
  }
  return advertised;
}

interface BrowserBillingTransportOptions {
  endpoints?: { billing?: string };
  resolveTopology?: () => Promise<AthenaRuntimeTopologyIR>;
  topology?: AthenaRuntimeTopologyIR;
}

async function resolveBillingTransport(
  options?: BrowserBillingTransportOptions
): Promise<AthenaHttpTransportIR | undefined> {
  const explicit = options?.endpoints?.billing?.trim();
  if (explicit) {
    return asExecutorTransport(
      createAthenaHttpTransportIR({
        basePath: resolveBrowserBillingEndpoint({ billing: explicit }),
        domain: "billing",
        origin: "same-origin",
      })
    );
  }
  const topology =
    options?.topology ??
    (options?.resolveTopology ? await options.resolveTopology() : undefined);
  if (topology) {
    const advertised = topology.transports.billing;
    if (advertised?.kind === "http") {
      return (
        sameOriginBillingTransport(advertised) ??
        asExecutorTransport(
          createAthenaHttpTransportIR({
            basePath: DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT,
            domain: "billing",
            origin: "same-origin",
          })
        )
      );
    }
    return;
  }
  return asExecutorTransport(
    createAthenaHttpTransportIR({
      basePath: DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT,
      domain: "billing",
      origin: "same-origin",
    })
  );
}

/** Browser billing client: catalog, subject-self, and capability probe only. */
export interface AthenaBrowserBillingTransport {
  catalog: BillingCatalogPort;
  getCapabilities: (
    input: BillingExecutionTarget
  ) => Promise<BillingCapabilities>;
  self: BillingSelfPort;
}

function billingRequestHeaders(options?: {
  appUrl?: string;
  headers?: Record<string, string>;
}): Record<string, string> | undefined {
  const origin =
    typeof globalThis.window !== "undefined" &&
    typeof globalThis.window.location?.origin === "string" &&
    globalThis.window.location.origin.length > 0
      ? globalThis.window.location.origin
      : options?.appUrl?.trim()
        ? new URL(options.appUrl).origin
        : undefined;
  const headers = {
    ...(options?.headers ?? {}),
    ...(origin ? { origin } : {}),
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function createBrowserBillingTransport(options?: {
  appUrl?: string;
  baseUrl?: string;
  endpoints?: { billing?: string };
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  resolveTopology?: () => Promise<AthenaRuntimeTopologyIR>;
  topology?: AthenaRuntimeTopologyIR;
}): AthenaBrowserBillingTransport {
  let pending: Promise<AthenaHttpTransportIR | undefined> | undefined;
  const loadTransport = () => {
    pending ??= resolveBillingTransport(options);
    return pending;
  };

  async function call(operation: string, payload: unknown): Promise<unknown> {
    const transport = await loadTransport();
    if (!transport) {
      throw new AthenaBillingError({
        body: undefined,
        code: "ATHENA_BILLING_PROVIDER_NOT_CONFIGURED",
        endpoint: "",
        message: "billing runtime is not configured",
        method: "POST",
        status: 503,
      });
    }
    const result = await executeAthenaHttpTransport({
      fetch: options?.fetch ?? fetch,
      headers: billingRequestHeaders(options),
      invocation: {
        domain: "billing",
        operation,
        payload,
      },
      root: options?.baseUrl,
      transport,
    });
    if (!result.ok) {
      const details = result.error.details;
      const envelope =
        details && typeof details === "object"
          ? (details as Record<string, unknown>)
          : {};
      const envelopeStatus =
        typeof envelope.status === "number" ? envelope.status : undefined;
      const nested =
        envelope.error && typeof envelope.error === "object"
          ? (envelope.error as Record<string, unknown>)
          : undefined;
      const rawWire =
        typeof envelope.code === "string"
          ? envelope.code
          : typeof nested?.code === "string"
            ? nested.code
            : undefined;
      const wireCode =
        rawWire && !rawWire.startsWith("ATHENA_TRANSPORT_HTTP_")
          ? rawWire
          : undefined;
      const transportCode = result.error.code;
      const code =
        wireCode ??
        (typeof transportCode === "string" &&
        !transportCode.startsWith("ATHENA_TRANSPORT_HTTP_")
          ? transportCode
          : undefined);
      throw billingErrorFromTransport({
        ...envelope,
        ...(nested ?? {}),
        ...(code === undefined ? {} : { code }),
        errorNumber:
          typeof nested?.errorNumber === "number"
            ? nested.errorNumber
            : result.error.errorNumber,
        message: result.error.message,
        missing: nested?.missing ?? envelope.missing,
        operation:
          typeof nested?.operation === "string"
            ? nested.operation
            : envelope.operation,
        ...(envelopeStatus === undefined ? {} : { status: envelopeStatus }),
      });
    }
    return billingHttpSuccessData(result.data, result.enveloped);
  }

  const self: BillingSelfPort = {
    checkout: {
      create: (input) => call("self.checkout.create", input) as never,
      resume: (input) => call("self.checkout.resume", input) as never,
    },
    customer: {
      get: () => call("self.customer.get", {}) as never,
    },
    entitlements: () => call("self.entitlements", {}) as never,
    invoices: {
      get: (input) => call("self.invoices.get", input) as never,
      list: (input) => call("self.invoices.list", input) as never,
    },
    payments: {
      get: (input) => call("self.payments.get", input) as never,
      list: (input) => call("self.payments.list", input) as never,
    },
    subscription: {
      cancel: (input) => call("self.subscription.cancel", input) as never,
      change: (input) => call("self.subscription.change", input) as never,
      enroll: (input) => call("self.subscription.enroll", input) as never,
      get: (input) => call("self.subscription.get", input) as never,
      getChangeOperation: (input) =>
        call("self.subscription.get", input) as never,
    },
  };
  const products: BillingProductPort = {
    list: (input) => call("products.list", input) as never,
  };
  const prices: BillingPricePort = {
    list: (input) => call("prices.list", input) as never,
  };
  const relations: BillingRelationPort = {
    list: (input) => call("relations.list", input) as never,
  };

  return {
    catalog: { prices, products, relations },
    getCapabilities: (input) =>
      call("getCapabilities", input) as Promise<BillingCapabilities>,
    self,
  };
}
