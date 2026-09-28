import type { MollieSdkClientOptions } from "../../src/billing/providers/types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function requestJson(input: {
  body?: unknown;
  idempotencyKey?: string;
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  secret: string;
  serverURL: string;
  testmode?: boolean;
}): Promise<unknown> {
  const url = new URL(`${input.serverURL.replace(/\/+$/, "")}${input.path}`);
  const query = { ...input.query };
  let body = input.body;
  if (input.testmode === true) {
    if (
      input.method === "GET" ||
      (input.method === "DELETE" && body === undefined)
    ) {
      query.testmode = "true";
    } else {
      body = isRecord(body) ? { ...body, testmode: true } : { testmode: true };
    }
  }
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${input.secret}`,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (input.idempotencyKey != null && input.idempotencyKey.length > 0) {
    headers["idempotency-key"] = input.idempotencyKey;
  }
  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method: input.method,
  });
  const text = await response.text();
  const parsed =
    text.trim().length === 0 ? undefined : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const error = new Error(`Mollie HTTP ${response.status}`);
    Object.assign(error, { body: parsed, status: response.status });
    throw error;
  }
  return parsed;
}

function secretFrom(options?: MollieSdkClientOptions): string {
  return (
    options?.security?.apiKey ??
    options?.security?.advancedAccessToken ??
    options?.security?.oAuth ??
    ""
  );
}

export class FetchMollieSdk {
  constructor(private readonly options: MollieSdkClientOptions = {}) {}

  private call(input: {
    body?: unknown;
    idempotencyKey?: string;
    method: string;
    path: string;
    query?: Record<string, string | number | undefined>;
  }): Promise<unknown> {
    return requestJson({
      ...input,
      secret: secretFrom(this.options),
      serverURL: this.options.serverURL ?? "https://api.mollie.com",
      testmode: this.options.testmode,
    });
  }

  payments = {
    cancel: (request: { paymentId: string }) =>
      this.call({
        body: {},
        method: "DELETE",
        path: `/v2/payments/${encodeURIComponent(request.paymentId)}`,
      }),
    create: (request: {
      idempotencyKey?: string;
      paymentRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.paymentRequest ?? {},
        idempotencyKey: request.idempotencyKey,
        method: "POST",
        path: "/v2/payments",
      }),
    get: (request: { paymentId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/payments/${encodeURIComponent(request.paymentId)}`,
      }),
    list: (request: { from?: string; limit?: number; profileId?: string }) =>
      this.call({
        method: "GET",
        path: "/v2/payments",
        query: {
          from: request.from,
          limit: request.limit,
          profileId: request.profileId,
        },
      }),
  };

  customers = {
    create: (request: {
      customerRequest?: Record<string, unknown>;
      idempotencyKey?: string;
    }) =>
      this.call({
        body: request.customerRequest ?? {},
        idempotencyKey: request.idempotencyKey,
        method: "POST",
        path: "/v2/customers",
      }),
    delete: (request: { customerId: string }) =>
      this.call({
        body: {},
        method: "DELETE",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}`,
      }),
    get: (request: { customerId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}`,
      }),
    list: (request: { from?: string; limit?: number }) =>
      this.call({
        method: "GET",
        path: "/v2/customers",
        query: { from: request.from, limit: request.limit },
      }),
    update: (request: {
      customerId: string;
      customerRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.customerRequest ?? {},
        method: "PATCH",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}`,
      }),
  };

  refunds = {
    cancel: (request: { paymentId: string; refundId: string }) =>
      this.call({
        method: "DELETE",
        path: `/v2/payments/${encodeURIComponent(request.paymentId)}/refunds/${encodeURIComponent(request.refundId)}`,
      }),
    create: (request: {
      idempotencyKey?: string;
      paymentId: string;
      refundRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.refundRequest ?? {},
        idempotencyKey: request.idempotencyKey,
        method: "POST",
        path: `/v2/payments/${encodeURIComponent(request.paymentId)}/refunds`,
      }),
    get: (request: { paymentId: string; refundId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/payments/${encodeURIComponent(request.paymentId)}/refunds/${encodeURIComponent(request.refundId)}`,
      }),
    list: (request: { from?: string; limit?: number; profileId?: string }) =>
      this.call({
        method: "GET",
        path: "/v2/refunds",
        query: {
          from: request.from,
          limit: request.limit,
          profileId: request.profileId,
        },
      }),
  };

  paymentLinks = {
    create: (request: {
      idempotencyKey?: string;
      paymentLinkRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.paymentLinkRequest ?? {},
        idempotencyKey: request.idempotencyKey,
        method: "POST",
        path: "/v2/payment-links",
      }),
    delete: (request: { paymentLinkId: string }) =>
      this.call({
        body: {},
        method: "DELETE",
        path: `/v2/payment-links/${encodeURIComponent(request.paymentLinkId)}`,
      }),
    get: (request: { paymentLinkId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/payment-links/${encodeURIComponent(request.paymentLinkId)}`,
      }),
    list: (request: { from?: string; limit?: number }) =>
      this.call({
        method: "GET",
        path: "/v2/payment-links",
        query: { from: request.from, limit: request.limit },
      }),
    update: (request: {
      paymentLinkId: string;
      paymentLinkRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.paymentLinkRequest ?? {},
        method: "PATCH",
        path: `/v2/payment-links/${encodeURIComponent(request.paymentLinkId)}`,
      }),
  };

  webhooks = {
    delete: (request: {
      requestBody?: Record<string, unknown>;
      webhookId: string;
    }) =>
      this.call({
        body: request.requestBody,
        method: "DELETE",
        path: `/v2/webhooks/${encodeURIComponent(request.webhookId)}`,
      }),
    list: (request: { from?: string; limit?: number; testmode?: boolean }) =>
      this.call({
        method: "GET",
        path: "/v2/webhooks",
        query: {
          from: request.from,
          limit: request.limit,
          testmode: request.testmode,
        },
      }),
  };

  subscriptions = {
    cancel: (request: { customerId: string; subscriptionId: string }) =>
      this.call({
        body: {},
        method: "DELETE",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}/subscriptions/${encodeURIComponent(request.subscriptionId)}`,
      }),
    create: (request: {
      customerId: string;
      idempotencyKey?: string;
      subscriptionRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.subscriptionRequest ?? {},
        idempotencyKey: request.idempotencyKey,
        method: "POST",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}/subscriptions`,
      }),
    get: (request: { customerId: string; subscriptionId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}/subscriptions/${encodeURIComponent(request.subscriptionId)}`,
      }),
    list: (request: {
      customerId?: string;
      from?: string;
      limit?: number;
      profileId?: string;
    }) =>
      this.call({
        method: "GET",
        path:
          request.customerId != null && request.customerId.length > 0
            ? `/v2/customers/${encodeURIComponent(request.customerId)}/subscriptions`
            : "/v2/subscriptions",
        query: {
          from: request.from,
          limit: request.limit,
          profileId: request.profileId,
        },
      }),
    update: (request: {
      customerId: string;
      subscriptionId: string;
      subscriptionRequest?: Record<string, unknown>;
    }) =>
      this.call({
        body: request.subscriptionRequest ?? {},
        method: "PATCH",
        path: `/v2/customers/${encodeURIComponent(request.customerId)}/subscriptions/${encodeURIComponent(request.subscriptionId)}`,
      }),
  };

  salesInvoices = {
    get: (request: { invoiceId: string }) =>
      this.call({
        method: "GET",
        path: `/v2/sales-invoices/${encodeURIComponent(request.invoiceId)}`,
      }),
    list: (request: { from?: string; limit?: number }) =>
      this.call({
        method: "GET",
        path: "/v2/sales-invoices",
        query: { from: request.from, limit: request.limit },
      }),
  };
}
