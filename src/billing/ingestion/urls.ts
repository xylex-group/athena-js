import { AthenaConfigurationError } from "../../config/errors.ts";
import type { ResolvedBillingIngressEndpoints } from "./types.ts";

export const BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH =
  "/api/athena/billing/webhook/mollie/classic";
export const BILLING_MOLLIE_EVENTS_WEBHOOK_PATH =
  "/api/athena/billing/webhook/mollie/events";
export const BILLING_WEBHOOK_COMPAT_PATH = "/api/athena/billing/webhook";

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

export function billingWebhookUrlIsLoopback(value: string): boolean {
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isHttpsPublicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function resolveBillingPublicBaseUrl(input: {
  appUrl?: string | null;
  publicBaseUrl?: string | null;
}): string | undefined {
  const candidate = input.publicBaseUrl?.trim() || input.appUrl?.trim();
  if (!candidate) {
    return;
  }
  return trimTrailingSlash(candidate);
}

export function resolveBillingIngressEndpoints(input: {
  appUrl?: string | null;
  publicBaseUrl?: string | null;
  webhookIngressToken?: string;
}): ResolvedBillingIngressEndpoints | undefined {
  const base = resolveBillingPublicBaseUrl(input);
  if (!base) {
    return;
  }
  const token = input.webhookIngressToken?.trim();
  const suffix =
    token != null && WEBHOOK_INGRESS_BINDING_TOKEN.test(token)
      ? `/${token}`
      : "";
  const classic = `${base}${BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH}${suffix}`;
  const nextGen = `${base}${BILLING_MOLLIE_EVENTS_WEBHOOK_PATH}${suffix}`;
  return {
    classic,
    classicUrl: classic,
    eventsUrl: nextGen,
    nextGen,
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function assertStableHttpsBillingPublicUrl(input: {
  appUrl?: string | null;
  live?: boolean;
  management: "automatic" | "manual";
  publicBaseUrl?: string | null;
  webhooksEnabled: boolean;
}): string | undefined {
  if (!input.webhooksEnabled || input.management !== "automatic") {
    return resolveBillingPublicBaseUrl(input);
  }
  const base = resolveBillingPublicBaseUrl(input);
  const live = input.live === true;
  if (!(base && isAbsoluteHttpUrl(base)) || (live && !isHttpsPublicUrl(base))) {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_INGESTION_PUBLIC_URL_REQUIRED",
      "Automatic billing webhook management requires billing.ingestion.webhooks.publicBaseUrl or app.url as a stable public origin (HTTPS when live). Host and X-Forwarded-Host are never used.",
      "billing"
    );
  }
  return base;
}

const WEBHOOK_INGRESS_BINDING_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function isBillingWebhookIngressBindingToken(value: string): boolean {
  return WEBHOOK_INGRESS_BINDING_TOKEN.test(value.trim());
}

function normalizeWebhookPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

export function billingWebhookPathKind(
  pathname: string
): "classic" | "events" | "compat" {
  const normalized = normalizeWebhookPathname(pathname);
  if (
    normalized === BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH ||
    normalized.startsWith(`${BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH}/`)
  ) {
    return "classic";
  }
  if (
    normalized === BILLING_MOLLIE_EVENTS_WEBHOOK_PATH ||
    normalized.startsWith(`${BILLING_MOLLIE_EVENTS_WEBHOOK_PATH}/`)
  ) {
    return "events";
  }
  return "compat";
}

/** Opaque ingress binding from `/classic/<token>` or `/events/<token>`. */
export function billingWebhookIngressBindingToken(
  pathname: string
): string | undefined {
  const normalized = normalizeWebhookPathname(pathname);
  const kind = billingWebhookPathKind(normalized);
  const prefix =
    kind === "classic"
      ? BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH
      : kind === "events"
        ? BILLING_MOLLIE_EVENTS_WEBHOOK_PATH
        : undefined;
  if (prefix == null || normalized === prefix) {
    return;
  }
  const rest = normalized.slice(prefix.length + 1);
  if (rest.includes("/") || !isBillingWebhookIngressBindingToken(rest)) {
    return;
  }
  return rest;
}

export function billingWebhookUrlTemplate(value: string): string {
  try {
    const parsed = new URL(value);
    const token = billingWebhookIngressBindingToken(parsed.pathname);
    if (token == null) {
      return value;
    }
    parsed.pathname = `${parsed.pathname.slice(0, -token.length)}<binding-token>`;
    return parsed.toString().replaceAll("%3Cbinding-token%3E", "<binding-token>");
  } catch {
    return "[invalid webhook URL]";
  }
}
