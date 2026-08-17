/**
 * Athena billing HTTP client for live `/billing/v1/*`, `/admin/billing/*`,
 * provider webhook, and `/debug/billing` routes.
 *
 * Methods map 1:1 onto the registered Actix handlers. Auth uses the static
 * Athena admin key (`X-Athena-Key` / configured API key) matching the server
 * `authorize_static_admin_key` gate.
 *
 * Contract spine: `billingSdkManifest` METHOD+path entries must match the
 * permanent Rust inventory `athena_billing::LIVE_HTTP_ROUTES`
 * (exported as `./live-http-routes.json`). Export with
 * `cargo run -p athena-billing --bin billing-contract-spine -- --write`.
 */

import { normalizeAthenaGatewayBaseUrl } from "../gateway/url.ts";
import { buildSdkHeaderValue } from "../sdk-version.ts";
import {
  buildAthenaRequestHeaders,
  hasHeaderIgnoreCase,
} from "../utils/athena-request-headers.ts";

const SDK_NAME = "xylex-group/athena-billing";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);

export type AthenaBillingHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type AthenaBillingJson =
  | null
  | boolean
  | number
  | string
  | AthenaBillingJson[]
  | { [key: string]: AthenaBillingJson };

export interface AthenaBillingCallOptions {
  apiKey?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AthenaBillingClientConfig {
  apiKey: string;
  baseUrl: string;
  client?: string | null;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export interface AthenaBillingEnvelope<T = unknown> {
  data: T;
  message?: string;
  status?: string;
}

export class AthenaBillingError extends Error {
  status: number;
  endpoint: string;
  method: string;
  body: unknown;

  constructor(input: {
    message: string;
    status: number;
    endpoint: string;
    method: string;
    body: unknown;
  }) {
    super(input.message);
    this.name = "AthenaBillingError";
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.body = input.body;
  }
}

export interface BillingConnectionRefInput {
  clientName?: string;
  connectionId: string;
}

export interface BillingListQuery extends BillingConnectionRefInput {
  cursor?: string;
  limit?: number;
  offset?: number;
  source?: "provider" | "persistence" | string;
}

export interface BillingEnsureCustomerInput extends BillingConnectionRefInput {
  email?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, AthenaBillingJson>;
  name?: string | null;
}

export interface BillingUpdateCustomerInput extends BillingConnectionRefInput {
  email?: string | null;
  name?: string | null;
}

export interface BillingCreateConnectionInput {
  config?: Record<string, AthenaBillingJson>;
  credentialKind?: string;
  metadata?: Record<string, AthenaBillingJson>;
  mode?: string;
  ownerId: string;
  ownerKind: string;
  provider: string;
  providerAccountId: string;
  providerProfileId?: string | null;
  scopes?: string[];
  status?: string;
}

export interface BillingUpdateConnectionInput {
  config?: Record<string, AthenaBillingJson>;
  credentialKind?: string;
  metadata?: Record<string, AthenaBillingJson>;
  mode?: string;
  providerAccountId?: string;
  providerProfileId?: string | null;
  scopes?: string[];
  status?: string;
}

export interface BillingReconcileInput {
  customerId?: string | null;
  resourceId: string;
  resourceKind: string;
}

export interface BillingProvisionSinksInput {
  instance?: string;
  targetSchema?: string;
}

export const billingSdkManifest = {
  envelopeKind: "athena",
  methods: [
    {
      method: "GET",
      name: "getCapabilities",
      path: "/billing/v1/capabilities",
    },
    { method: "POST", name: "createCheckout", path: "/billing/v1/checkouts" },
    { method: "GET", name: "listProducts", path: "/billing/v1/products" },
    { method: "GET", name: "listPrices", path: "/billing/v1/prices" },
    { method: "GET", name: "listCustomers", path: "/billing/v1/customers" },
    { method: "POST", name: "createCustomer", path: "/billing/v1/customers" },
    { method: "GET", name: "getCustomer", path: "/billing/v1/customers/{id}" },
    {
      method: "PATCH",
      name: "updateCustomer",
      path: "/billing/v1/customers/{id}",
    },
    {
      method: "DELETE",
      name: "deleteCustomer",
      path: "/billing/v1/customers/{id}",
    },
    { method: "GET", name: "listPayments", path: "/billing/v1/payments" },
    { method: "POST", name: "createPayment", path: "/billing/v1/payments" },
    { method: "GET", name: "getPayment", path: "/billing/v1/payments/{id}" },
    {
      method: "POST",
      name: "cancelPayment",
      path: "/billing/v1/payments/{id}/cancel",
    },
    {
      method: "GET",
      name: "listPaymentLinks",
      path: "/billing/v1/payment-links",
    },
    {
      method: "POST",
      name: "createPaymentLink",
      path: "/billing/v1/payment-links",
    },
    {
      method: "GET",
      name: "getPaymentLink",
      path: "/billing/v1/payment-links/{id}",
    },
    {
      method: "PATCH",
      name: "updatePaymentLink",
      path: "/billing/v1/payment-links/{id}",
    },
    {
      method: "DELETE",
      name: "deletePaymentLink",
      path: "/billing/v1/payment-links/{id}",
    },
    { method: "GET", name: "listRefunds", path: "/billing/v1/refunds" },
    { method: "POST", name: "createRefund", path: "/billing/v1/refunds" },
    { method: "GET", name: "getRefund", path: "/billing/v1/refunds/{id}" },
    {
      method: "POST",
      name: "cancelRefund",
      path: "/billing/v1/refunds/{id}/cancel",
    },
    {
      method: "GET",
      name: "listSubscriptions",
      path: "/billing/v1/subscriptions",
    },
    {
      method: "POST",
      name: "createSubscription",
      path: "/billing/v1/subscriptions",
    },
    {
      method: "GET",
      name: "getSubscription",
      path: "/billing/v1/subscriptions/{id}",
    },
    {
      method: "PATCH",
      name: "updateSubscription",
      path: "/billing/v1/subscriptions/{id}",
    },
    {
      method: "POST",
      name: "cancelSubscription",
      path: "/billing/v1/subscriptions/{id}/cancel",
    },
    { method: "GET", name: "listInvoices", path: "/billing/v1/invoices" },
    { method: "GET", name: "getInvoice", path: "/billing/v1/invoices/{id}" },
    { method: "GET", name: "listWebhooks", path: "/billing/v1/webhooks" },
    { method: "POST", name: "createWebhook", path: "/billing/v1/webhooks" },
    { method: "GET", name: "getWebhook", path: "/billing/v1/webhooks/{id}" },
    {
      method: "PATCH",
      name: "updateWebhook",
      path: "/billing/v1/webhooks/{id}",
    },
    {
      method: "DELETE",
      name: "deleteWebhook",
      path: "/billing/v1/webhooks/{id}",
    },
    {
      method: "POST",
      name: "testWebhook",
      path: "/billing/v1/webhooks/{id}/test",
    },
    {
      method: "GET",
      name: "listConnections",
      path: "/admin/billing/clients/{client_name}/connections",
    },
    {
      method: "POST",
      name: "createConnection",
      path: "/admin/billing/clients/{client_name}/connections",
    },
    {
      method: "GET",
      name: "getConnection",
      path: "/admin/billing/clients/{client_name}/connections/{connection_id}",
    },
    {
      method: "PATCH",
      name: "updateConnection",
      path: "/admin/billing/clients/{client_name}/connections/{connection_id}",
    },
    {
      method: "DELETE",
      name: "deleteConnection",
      path: "/admin/billing/clients/{client_name}/connections/{connection_id}",
    },
    {
      method: "POST",
      name: "reconcileDocument",
      path: "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile",
    },
    {
      method: "GET",
      name: "listWebhookEvents",
      path: "/admin/billing/clients/{client_name}/webhook-events",
    },
    {
      method: "POST",
      name: "provisionWebhookSinks",
      path: "/admin/billing/clients/{client_name}/webhook-sinks/provision",
    },
    { method: "GET", name: "listGrants", path: "/admin/billing/grants" },
    { method: "GET", name: "listProviders", path: "/admin/billing/providers" },
    {
      method: "GET",
      name: "listSinkHelpers",
      path: "/admin/webhook-sinks/helpers/billing",
    },
    {
      method: "POST",
      name: "ingestProviderWebhook",
      path: "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook",
    },
    { method: "GET", name: "getDebugBilling", path: "/debug/billing" },
  ],
  namespace: "billing",
} as const;

function withPathParam(path: string, name: string, value: string): string {
  return path.replace(`{${name}}`, encodeURIComponent(value));
}

function appendQuery(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

function connectionQuery(
  input: BillingListQuery | BillingConnectionRefInput
): Record<string, string> {
  const query: Record<string, string> = {
    connectionId: input.connectionId,
  };
  if (input.clientName) {
    query.clientName = input.clientName;
  }
  if ("cursor" in input && input.cursor) {
    query.cursor = input.cursor;
  }
  if ("source" in input && input.source) {
    query.source = input.source;
  }
  if ("limit" in input && input.limit !== undefined) {
    query.limit = String(input.limit);
  }
  if ("offset" in input && input.offset !== undefined) {
    query.offset = String(input.offset);
  }
  return query;
}

function parseEnvelopeData<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as AthenaBillingEnvelope<T>).data;
  }
  return body as T;
}

export interface AthenaBillingModule {
  cancelPayment: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  cancelRefund: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  cancelSubscription: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createCheckout: (
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createConnection: (
    clientName: string,
    input: BillingCreateConnectionInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createCustomer: (
    input: BillingEnsureCustomerInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createPayment: (
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createPaymentLink: (
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createRefund: (
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createSubscription: (
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  createWebhook: (
    input: BillingConnectionRefInput,
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  deleteConnection: (
    clientName: string,
    connectionId: string,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  deleteCustomer: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  deletePaymentLink: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  deleteWebhook: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getCapabilities: (
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getConnection: (
    clientName: string,
    connectionId: string,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getCustomer: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getDebugBilling: (
    jwtSecret: string,
    options?: AthenaBillingCallOptions
  ) => Promise<string>;
  getInvoice: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getPayment: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getPaymentLink: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getRefund: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getSubscription: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  getWebhook: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  ingestProviderWebhook: (
    input: {
      provider: string;
      clientName: string;
      connectionId: string;
      body: BodyInit | Record<string, unknown> | string;
      signatureHeaders?: Record<string, string>;
    },
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listConnections: (
    clientName: string,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listCustomers: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listGrants: (options?: AthenaBillingCallOptions) => Promise<unknown>;
  listInvoices: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listPaymentLinks: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listPayments: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listPrices: (
    input: BillingConnectionRefInput & { productId?: string },
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listProducts: (
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listProviders: (options?: AthenaBillingCallOptions) => Promise<unknown>;
  listRefunds: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listSinkHelpers: (
    query?: { targetSchema?: string; instance?: string },
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listSubscriptions: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listWebhookEvents: (
    clientName: string,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  listWebhooks: (
    input: BillingListQuery,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  provisionWebhookSinks: (
    clientName: string,
    input?: BillingProvisionSinksInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  reconcileDocument: (
    clientName: string,
    connectionId: string,
    input: BillingReconcileInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  testWebhook: (
    id: string,
    input: BillingConnectionRefInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  updateConnection: (
    clientName: string,
    connectionId: string,
    input: BillingUpdateConnectionInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  updateCustomer: (
    id: string,
    input: BillingUpdateCustomerInput,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  updatePaymentLink: (
    id: string,
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  updateSubscription: (
    id: string,
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
  updateWebhook: (
    id: string,
    input: BillingConnectionRefInput,
    body: Record<string, unknown>,
    options?: AthenaBillingCallOptions
  ) => Promise<unknown>;
}

/**
 * @deprecated Prefer `createClient(...).billing` (root Athena client).
 * This factory remains for internal composition and legacy call sites.
 */
export function createBillingModule(
  config: AthenaBillingClientConfig
): AthenaBillingModule {
  const baseUrl = normalizeAthenaGatewayBaseUrl(config.baseUrl, {
    label: "Athena billing base URL",
  });
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function call<T>(
    method: AthenaBillingHttpMethod,
    path: string,
    body?: unknown,
    options?: AthenaBillingCallOptions,
    responseType: "json" | "text" = "json"
  ): Promise<T> {
    const headers = buildAthenaRequestHeaders({
      apiKey: options?.apiKey ?? config.apiKey,
      callHeaders: options?.headers,
      client: config.client,
      configHeaders: {
        ...(config.headers ?? {}),
      },
      contentType: "application/json",
      profile: "gateway",
      sdkHeaderValue: SDK_HEADER_VALUE,
    });

    let requestBody: BodyInit | undefined;
    if (body !== undefined && body !== null) {
      if (
        typeof body === "string" ||
        body instanceof Blob ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        body instanceof FormData ||
        body instanceof URLSearchParams
      ) {
        requestBody = body as BodyInit;
      } else {
        requestBody = JSON.stringify(body);
        if (!hasHeaderIgnoreCase(headers, "Content-Type")) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const targetUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetchImpl(targetUrl, {
      body: requestBody,
      headers,
      method,
      signal: options?.signal,
    });

    if (responseType === "text") {
      const text = await response.text();
      if (!response.ok) {
        throw new AthenaBillingError({
          body: text,
          endpoint: path,
          message: `Billing request failed (${response.status})`,
          method,
          status: response.status,
        });
      }
      return text as T;
    }

    const rawText = await response.text();
    let parsed: unknown = rawText;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = rawText;
      }
    } else {
      parsed = null;
    }

    if (!response.ok) {
      const message =
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : `Billing request failed (${response.status})`;
      throw new AthenaBillingError({
        body: parsed,
        endpoint: path,
        message,
        method,
        status: response.status,
      });
    }

    return parseEnvelopeData<T>(parsed);
  }

  return {
    cancelPayment(id, input, options) {
      return call(
        "POST",
        appendQuery(
          withPathParam("/billing/v1/payments/{id}/cancel", "id", id),
          connectionQuery(input)
        ),
        {},
        options
      );
    },
    cancelRefund(id, input, options) {
      return call(
        "POST",
        appendQuery(
          withPathParam("/billing/v1/refunds/{id}/cancel", "id", id),
          connectionQuery(input)
        ),
        {},
        options
      );
    },
    cancelSubscription(id, input, options) {
      return call(
        "POST",
        appendQuery(
          withPathParam("/billing/v1/subscriptions/{id}/cancel", "id", id),
          connectionQuery(input)
        ),
        {},
        options
      );
    },
    createCheckout(body, options) {
      return call("POST", "/billing/v1/checkouts", body, options);
    },
    createConnection(clientName, input, options) {
      return call(
        "POST",
        withPathParam(
          "/admin/billing/clients/{client_name}/connections",
          "client_name",
          clientName
        ),
        {
          config: input.config,
          credentialKind: input.credentialKind,
          metadata: input.metadata,
          mode: input.mode,
          ownerId: input.ownerId,
          ownerKind: input.ownerKind,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          providerProfileId: input.providerProfileId,
          scopes: input.scopes,
          status: input.status,
        },
        options
      );
    },
    createCustomer(input, options) {
      return call(
        "POST",
        "/billing/v1/customers",
        {
          clientName: input.clientName,
          connectionId: input.connectionId,
          email: input.email,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
          name: input.name,
        },
        options
      );
    },
    createPayment(body, options) {
      return call("POST", "/billing/v1/payments", body, options);
    },
    createPaymentLink(body, options) {
      return call("POST", "/billing/v1/payment-links", body, options);
    },
    createRefund(body, options) {
      return call("POST", "/billing/v1/refunds", body, options);
    },
    createSubscription(body, options) {
      return call("POST", "/billing/v1/subscriptions", body, options);
    },
    createWebhook(input, body, options) {
      return call(
        "POST",
        appendQuery("/billing/v1/webhooks", connectionQuery(input)),
        body,
        options
      );
    },
    deleteConnection(clientName, connectionId, options) {
      return call(
        "DELETE",
        withPathParam(
          withPathParam(
            "/admin/billing/clients/{client_name}/connections/{connection_id}",
            "client_name",
            clientName
          ),
          "connection_id",
          connectionId
        ),
        undefined,
        options
      );
    },
    deleteCustomer(id, input, options) {
      return call(
        "DELETE",
        appendQuery(
          withPathParam("/billing/v1/customers/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    deletePaymentLink(id, input, options) {
      return call(
        "DELETE",
        appendQuery(
          withPathParam("/billing/v1/payment-links/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    deleteWebhook(id, input, options) {
      return call(
        "DELETE",
        appendQuery(
          withPathParam("/billing/v1/webhooks/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getCapabilities(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/capabilities", connectionQuery(input)),
        undefined,
        options
      );
    },
    getConnection(clientName, connectionId, options) {
      return call(
        "GET",
        withPathParam(
          withPathParam(
            "/admin/billing/clients/{client_name}/connections/{connection_id}",
            "client_name",
            clientName
          ),
          "connection_id",
          connectionId
        ),
        undefined,
        options
      );
    },
    getCustomer(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/customers/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getDebugBilling(jwtSecret, options) {
      return call(
        "GET",
        appendQuery("/debug/billing", { jwt_secret: jwtSecret }),
        undefined,
        options,
        "text"
      );
    },
    getInvoice(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/invoices/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getPayment(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/payments/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getPaymentLink(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/payment-links/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getRefund(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/refunds/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getSubscription(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/subscriptions/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    getWebhook(id, input, options) {
      return call(
        "GET",
        appendQuery(
          withPathParam("/billing/v1/webhooks/{id}", "id", id),
          connectionQuery(input)
        ),
        undefined,
        options
      );
    },
    ingestProviderWebhook(input, options) {
      const path = withPathParam(
        withPathParam(
          withPathParam(
            "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook",
            "provider",
            input.provider
          ),
          "client_name",
          input.clientName
        ),
        "connection_id",
        input.connectionId
      );
      return call("POST", path, input.body, {
        ...options,
        headers: {
          ...(options?.headers ?? {}),
          ...(input.signatureHeaders ?? {}),
        },
      });
    },
    listConnections(clientName, options) {
      return call(
        "GET",
        withPathParam(
          "/admin/billing/clients/{client_name}/connections",
          "client_name",
          clientName
        ),
        undefined,
        options
      );
    },
    listCustomers(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/customers", connectionQuery(input)),
        undefined,
        options
      );
    },
    listGrants(options) {
      return call("GET", "/admin/billing/grants", undefined, options);
    },
    listInvoices(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/invoices", connectionQuery(input)),
        undefined,
        options
      );
    },
    listPaymentLinks(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/payment-links", connectionQuery(input)),
        undefined,
        options
      );
    },
    listPayments(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/payments", connectionQuery(input)),
        undefined,
        options
      );
    },
    listPrices(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/prices", {
          ...connectionQuery(input),
          ...(input.productId ? { productId: input.productId } : {}),
        }),
        undefined,
        options
      );
    },
    listProducts(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/products", connectionQuery(input)),
        undefined,
        options
      );
    },
    listProviders(options) {
      return call("GET", "/admin/billing/providers", undefined, options);
    },
    listRefunds(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/refunds", connectionQuery(input)),
        undefined,
        options
      );
    },
    listSinkHelpers(query, options) {
      return call(
        "GET",
        appendQuery("/admin/webhook-sinks/helpers/billing", {
          instance: query?.instance,
          targetSchema: query?.targetSchema,
        }),
        undefined,
        options
      );
    },
    listSubscriptions(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/subscriptions", connectionQuery(input)),
        undefined,
        options
      );
    },
    listWebhookEvents(clientName, options) {
      return call(
        "GET",
        withPathParam(
          "/admin/billing/clients/{client_name}/webhook-events",
          "client_name",
          clientName
        ),
        undefined,
        options
      );
    },
    listWebhooks(input, options) {
      return call(
        "GET",
        appendQuery("/billing/v1/webhooks", connectionQuery(input)),
        undefined,
        options
      );
    },
    provisionWebhookSinks(clientName, input, options) {
      return call(
        "POST",
        appendQuery(
          withPathParam(
            "/admin/billing/clients/{client_name}/webhook-sinks/provision",
            "client_name",
            clientName
          ),
          {
            instance: input?.instance,
            targetSchema: input?.targetSchema,
          }
        ),
        {},
        options
      );
    },
    reconcileDocument(clientName, connectionId, input, options) {
      return call(
        "POST",
        withPathParam(
          withPathParam(
            "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile",
            "client_name",
            clientName
          ),
          "connection_id",
          connectionId
        ),
        {
          customerId: input.customerId,
          resourceId: input.resourceId,
          resourceKind: input.resourceKind,
        },
        options
      );
    },
    testWebhook(id, input, options) {
      return call(
        "POST",
        appendQuery(
          withPathParam("/billing/v1/webhooks/{id}/test", "id", id),
          connectionQuery(input)
        ),
        {},
        options
      );
    },
    updateConnection(clientName, connectionId, input, options) {
      return call(
        "PATCH",
        withPathParam(
          withPathParam(
            "/admin/billing/clients/{client_name}/connections/{connection_id}",
            "client_name",
            clientName
          ),
          "connection_id",
          connectionId
        ),
        input,
        options
      );
    },
    updateCustomer(id, input, options) {
      return call(
        "PATCH",
        withPathParam("/billing/v1/customers/{id}", "id", id),
        {
          clientName: input.clientName,
          connectionId: input.connectionId,
          email: input.email,
          name: input.name,
        },
        options
      );
    },
    updatePaymentLink(id, body, options) {
      return call(
        "PATCH",
        withPathParam("/billing/v1/payment-links/{id}", "id", id),
        body,
        options
      );
    },
    updateSubscription(id, body, options) {
      return call(
        "PATCH",
        withPathParam("/billing/v1/subscriptions/{id}", "id", id),
        body,
        options
      );
    },
    updateWebhook(id, input, body, options) {
      return call(
        "PATCH",
        appendQuery(
          withPathParam("/billing/v1/webhooks/{id}", "id", id),
          connectionQuery(input)
        ),
        body,
        options
      );
    },
  };
}
